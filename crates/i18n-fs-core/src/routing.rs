//! Route canonicalisation and the middleware decision function.
//!
//! Everything here is a pure function of `(request, config)`. That is what makes
//! the infinite-loop guarantee testable: [`canonical_public_path`] is idempotent
//! (proven by property test), and [`decide`] only ever emits a redirect when the
//! incoming path differs from its own canonical form. A redirect therefore
//! always lands on a path that produces [`Action::Next`] or [`Action::Rewrite`],
//! never another redirect.
//!
//! This module is part of the `minimal` build consumed by the Edge middleware.

use crate::config::{I18nConfig, PrefixMode, Strategy};
use crate::locale::{negotiate, MatchKind};
use serde::{Deserialize, Serialize};

/// Everything the core needs to know about an incoming request.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestInfo {
	/// `nextUrl.pathname`, i.e. without `basePath`, query or hash.
	pub pathname: String,
	/// `Host` header, may include a port.
	#[serde(default)]
	pub host: Option<String>,
	/// Value of the locale cookie, if present.
	#[serde(default)]
	pub cookie_locale: Option<String>,
	/// Raw `Accept-Language` header.
	#[serde(default)]
	pub accept_language: Option<String>,
	/// Set when a previous middleware pass already resolved this request. This
	/// is the last-resort loop breaker; the logic below does not rely on it.
	#[serde(default)]
	pub already_resolved: bool,
}

/// What the middleware should do with the request.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Action {
	/// Pass through untouched.
	Next,
	/// Serve a different internal path without changing the visible URL.
	Rewrite {
		/// Internal path, always locale-prefixed so it hits `app/[locale]/...`.
		path: String,
	},
	/// Send the client to the canonical public path.
	///
	/// Always same-origin. Moving a visitor between locale domains is a
	/// deliberate user action, not something the middleware infers, so the
	/// locale switcher builds that URL from [`domain_for_locale`] instead.
	Redirect {
		/// Canonical public path.
		path: String,
		/// `true` for a 308, `false` for a 307.
		///
		/// Permanent only when the locale came from the URL itself, so the
		/// canonical form is the same for every visitor. A redirect that
		/// depends on a cookie, a hostname or `Accept-Language` varies per
		/// visitor and must never be cached as permanent.
		permanent: bool,
	},
}

/// The middleware decision.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Decision {
	/// Locale that is active for this request.
	pub locale: String,
	/// What to do with the request.
	pub action: Action,
	/// Whether the locale cookie should be written on the response.
	pub set_cookie: bool,
	/// How the locale was determined, for debugging.
	pub source: LocaleSource,
}

/// Where the active locale came from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum LocaleSource {
	/// Read from the URL path prefix.
	Path,
	/// Read from the hostname.
	Domain,
	/// Read from the cookie.
	Cookie,
	/// Negotiated from `Accept-Language`.
	Header,
	/// Nothing matched; the configured default was used.
	Default,
}

/// Paths the middleware must never touch.
///
/// The JavaScript `matcher` excludes these too; this is the belt to that braces,
/// so a mis-edited matcher cannot produce a redirect loop on an asset.
pub fn should_handle(pathname: &str) -> bool {
	if pathname.starts_with("/_next")
		|| pathname.starts_with("/api")
		|| pathname.starts_with("/__next")
		|| pathname == "/favicon.ico"
	{
		return false;
	}

	// Anything with a file extension in its last segment is a static asset.
	let last = pathname.rsplit('/').next().unwrap_or_default();
	!last.contains('.')
}

/// Split a path into segments, dropping empties produced by `//` or a trailing
/// slash.
fn segments(path: &str) -> Vec<&str> {
	path.split('/').filter(|s| !s.is_empty()).collect()
}

fn join(segments: &[&str]) -> String {
	if segments.is_empty() {
		"/".to_owned()
	} else {
		format!("/{}", segments.join("/"))
	}
}

/// The locale named by the first path segment, if any.
pub fn path_locale<'a>(config: &'a I18nConfig, pathname: &str) -> Option<&'a str> {
	segments(pathname)
		.first()
		.and_then(|first| config.canonical_locale(first))
}

/// Remove every leading locale segment and normalise the result.
///
/// The loop matters: stripping only one segment would make
/// [`canonical_public_path`] non-idempotent for inputs such as `/fa/fa/about`
/// under [`PrefixMode::Never`], which is exactly the shape a redirect loop is
/// made of.
pub fn strip_locale(config: &I18nConfig, pathname: &str) -> String {
	let mut parts = segments(pathname);
	while let Some(first) = parts.first() {
		if config.canonical_locale(first).is_some() {
			parts.remove(0);
		} else {
			break;
		}
	}
	join(&parts)
}

/// The locale that goes unprefixed under [`PrefixMode::AsNeeded`].
///
/// Normally the configured default. Under [`Strategy::Domain`] it is the
/// locale the host itself serves: on `example.com` (English) the bare path
/// `/about` means English, whatever the global default happens to be.
///
/// Getting this wrong is not cosmetic. If `/about` is canonicalised against the
/// global default while the host resolves it to the domain locale, the two
/// disagree and the request bounces between `/about` and `/en/about`.
pub fn base_locale<'a>(config: &'a I18nConfig, host: Option<&str>) -> &'a str {
	if config.strategy == Strategy::Domain {
		if let Some(locale) = domain_locale(config, host) {
			return locale;
		}
	}
	&config.default_locale
}

/// Add the locale prefix to a locale-free path, honouring [`PrefixMode`].
///
/// `base` is the locale that goes unprefixed under [`PrefixMode::AsNeeded`];
/// see [`base_locale`].
pub fn add_locale(config: &I18nConfig, bare_path: &str, locale: &str, base: &str) -> String {
	let needs_prefix = match config.prefix {
		PrefixMode::Always => true,
		PrefixMode::AsNeeded => !locale.eq_ignore_ascii_case(base),
		PrefixMode::Never => false,
	};

	if !needs_prefix {
		return bare_path.to_owned();
	}

	let mut parts = vec![locale];
	parts.extend(segments(bare_path));
	join(&parts)
}

/// The canonical public path for `pathname` under `locale`.
///
/// `base` comes from [`base_locale`]; pass `&config.default_locale` when there
/// is no host in play.
///
/// Idempotent: `canonical_public_path(canonical_public_path(p)) ==
/// canonical_public_path(p)` for every input. This is asserted by property test
/// in `tests/routing_props.rs`, and the whole loop guarantee rests on it.
pub fn canonical_public_path(
	config: &I18nConfig,
	pathname: &str,
	locale: &str,
	base: &str,
) -> String {
	add_locale(config, &strip_locale(config, pathname), locale, base)
}

/// The internal path Next.js should route to.
///
/// Always locale-prefixed so it resolves against `app/[locale]/...`, even when
/// the public URL hides the locale.
pub fn internal_path(config: &I18nConfig, pathname: &str, locale: &str) -> String {
	let bare = strip_locale(config, pathname);
	let mut parts = vec![locale];
	parts.extend(segments(&bare));
	join(&parts)
}

/// Strip the port from a `Host` header value.
fn hostname(host: &str) -> &str {
	host.split(':').next().unwrap_or(host)
}

/// The locale bound to `host`, for [`Strategy::Domain`].
pub fn domain_locale<'a>(config: &'a I18nConfig, host: Option<&str>) -> Option<&'a str> {
	let host = hostname(host?);
	config
		.domains
		.iter()
		.find(|rule| rule.domain.eq_ignore_ascii_case(host))
		.map(|rule| rule.locale.as_str())
}

/// The hostname that serves `locale`, for building cross-domain switch URLs.
pub fn domain_for_locale<'a>(config: &'a I18nConfig, locale: &str) -> Option<&'a str> {
	config
		.domains
		.iter()
		.find(|rule| rule.locale.eq_ignore_ascii_case(locale))
		.map(|rule| rule.domain.as_str())
}

/// Whether `host` is allowed to serve `locale` under the domain strategy.
fn domain_allows(config: &I18nConfig, host: Option<&str>, locale: &str) -> bool {
	let Some(host) = host.map(hostname) else {
		return true;
	};

	match config
		.domains
		.iter()
		.find(|rule| rule.domain.eq_ignore_ascii_case(host))
	{
		Some(rule) => {
			rule.locale.eq_ignore_ascii_case(locale)
				|| rule.locales.iter().any(|l| l.eq_ignore_ascii_case(locale))
		}
		// Unknown host (preview deployments, localhost): do not fight it.
		None => true,
	}
}

/// Whether the hostname itself selects the locale for this request.
///
/// True only under [`Strategy::Domain`] *and* for a host that appears in the
/// domain table. Preview deployments and `localhost` are not in the table, so
/// there the domain selects nothing and the cookie takes over — otherwise a
/// locale chosen on localhost could not be persisted at all.
fn domain_selects(config: &I18nConfig, host: Option<&str>) -> bool {
	config.strategy == Strategy::Domain && domain_locale(config, host).is_some()
}

/// Resolve the active locale for a request, without deciding what to do yet.
///
/// Resolution order depends on the strategy, but the URL always wins where the
/// URL is authoritative, because a shared link must render the locale it names.
pub fn resolve_locale(config: &I18nConfig, request: &RequestInfo) -> (String, LocaleSource) {
	let cookie_locale = request
		.cookie_locale
		.as_deref()
		.and_then(|value| config.canonical_locale(value));

	// A path prefix may select a locale only in the modes where the canonical
	// URL keeps prefixes. Under `Never` the canonical form has no prefix, so
	// honouring one would mean resolving a locale that the very next redirect
	// strips out again — and the request would settle on a different locale
	// than the one it asked for.
	let from_path = if config.prefix == PrefixMode::Never {
		None
	} else {
		path_locale(config, &request.pathname)
	};
	let from_domain = domain_locale(config, request.host.as_deref());

	let ordered: [Option<(&str, LocaleSource)>; 3] = match config.strategy {
		Strategy::Path => [
			from_path.map(|l| (l, LocaleSource::Path)),
			cookie_locale.map(|l| (l, LocaleSource::Cookie)),
			None,
		],
		// The path comes first even here: a domain that lists extra `locales`
		// is explicitly opting into prefix-selected locales, and `domain_allows`
		// below rejects the prefix on domains that did not opt in.
		//
		// The cookie is consulted only when the host selects nothing. Reading a
		// cookie that `decide` refuses to write is how a request ends up
		// bouncing: the redirect drops the path prefix, then a stale cookie
		// names a different locale and asks for another redirect.
		Strategy::Domain => [
			from_path.map(|l| (l, LocaleSource::Path)),
			from_domain.map(|l| (l, LocaleSource::Domain)),
			if domain_selects(config, request.host.as_deref()) {
				None
			} else {
				cookie_locale.map(|l| (l, LocaleSource::Cookie))
			},
		],
		Strategy::Cookie => [
			cookie_locale.map(|l| (l, LocaleSource::Cookie)),
			from_path.map(|l| (l, LocaleSource::Path)),
			None,
		],
	};

	for candidate in ordered.into_iter().flatten() {
		if config.strategy != Strategy::Domain
			|| domain_allows(config, request.host.as_deref(), candidate.0)
		{
			return (candidate.0.to_owned(), candidate.1);
		}
	}

	if let Some(header) = request.accept_language.as_deref() {
		let negotiated = negotiate(header, &config.locales, &config.default_locale);
		if negotiated.kind != MatchKind::Default
			&& domain_allows(config, request.host.as_deref(), &negotiated.locale)
		{
			return (negotiated.locale, LocaleSource::Header);
		}
	}

	(config.default_locale.clone(), LocaleSource::Default)
}

/// Decide what the middleware should do with a request.
///
/// Loop safety, in order of application:
///
/// 1. Requests the middleware must not touch are passed through untouched.
/// 2. A request that a previous pass already resolved is passed through.
/// 3. A redirect is emitted only when `pathname` differs from its own canonical
///    form, and the canonical form is idempotent — so the redirect target is a
///    fixed point that cannot redirect again.
/// 4. Everything else is a rewrite, which does not change the URL and therefore
///    cannot loop.
pub fn decide(config: &I18nConfig, request: &RequestInfo) -> Decision {
	let (locale, source) = resolve_locale(config, request);

	let pass_through = |set_cookie: bool| Decision {
		locale: locale.clone(),
		action: Action::Next,
		set_cookie,
		source,
	};

	if !should_handle(&request.pathname) {
		return pass_through(false);
	}

	// The cookie is written exactly when it is read. It is what carries the
	// resolved locale across a redirect that strips the prefix from the URL, so
	// the follow-up request resolves the same locale instead of re-negotiating
	// into a different one.
	let cookie_matches = request
		.cookie_locale
		.as_deref()
		.is_some_and(|value| value.eq_ignore_ascii_case(&locale));
	let set_cookie = !domain_selects(config, request.host.as_deref()) && !cookie_matches;

	if request.already_resolved {
		return pass_through(set_cookie);
	}

	let base = base_locale(config, request.host.as_deref());
	let public = canonical_public_path(config, &request.pathname, &locale, base);

	if public != request.pathname {
		return Decision {
			locale,
			action: Action::Redirect {
				path: public,
				permanent: source == LocaleSource::Path,
			},
			set_cookie,
			source,
		};
	}

	let internal = internal_path(config, &request.pathname, &locale);
	if internal != request.pathname {
		return Decision {
			locale,
			action: Action::Rewrite { path: internal },
			set_cookie,
			source,
		};
	}

	pass_through(set_cookie)
}
