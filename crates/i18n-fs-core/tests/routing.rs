//! Route canonicalisation and middleware decisions, per strategy.

#![allow(clippy::unwrap_used, clippy::panic)]

use i18n_fs_core::config::{DomainRule, I18nConfig, PrefixMode, Strategy};
use i18n_fs_core::routing::{
	base_locale, canonical_public_path, decide, internal_path, should_handle, strip_locale, Action,
	Decision, LocaleSource, RequestInfo,
};

fn config(strategy: Strategy, prefix: PrefixMode) -> I18nConfig {
	I18nConfig {
		locales: vec!["fa".to_owned(), "en".to_owned()],
		default_locale: "fa".to_owned(),
		strategy,
		prefix,
		..I18nConfig::default()
	}
}

fn domain_config(prefix: PrefixMode) -> I18nConfig {
	I18nConfig {
		domains: vec![
			DomainRule {
				domain: "example.ir".to_owned(),
				locale: "fa".to_owned(),
				locales: Vec::new(),
			},
			DomainRule {
				domain: "example.com".to_owned(),
				locale: "en".to_owned(),
				locales: Vec::new(),
			},
		],
		..config(Strategy::Domain, prefix)
	}
}

fn request(pathname: &str) -> RequestInfo {
	RequestInfo {
		pathname: pathname.to_owned(),
		..RequestInfo::default()
	}
}

fn with_cookie(pathname: &str, locale: &str) -> RequestInfo {
	RequestInfo {
		cookie_locale: Some(locale.to_owned()),
		..request(pathname)
	}
}

fn with_host(pathname: &str, host: &str) -> RequestInfo {
	RequestInfo {
		host: Some(host.to_owned()),
		..request(pathname)
	}
}

fn redirect_target(decision: &Decision) -> &str {
	match &decision.action {
		Action::Redirect { path, .. } => path,
		other => panic!("expected a redirect, got {other:?}"),
	}
}

fn rewrite_target(decision: &Decision) -> &str {
	match &decision.action {
		Action::Rewrite { path } => path,
		other => panic!("expected a rewrite, got {other:?}"),
	}
}

#[test]
fn skips_assets_and_framework_paths() {
	for path in [
		"/_next/static/chunk.js",
		"/api/users",
		"/favicon.ico",
		"/logo.png",
		"/nested/file.svg",
	] {
		assert!(!should_handle(path), "{path} should be skipped");
	}

	for path in ["/", "/about", "/fa/docs/getting-started"] {
		assert!(should_handle(path), "{path} should be handled");
	}
}

#[test]
fn strip_locale_removes_every_leading_locale_segment() {
	let config = config(Strategy::Path, PrefixMode::Never);

	// One leading locale is the normal case.
	assert_eq!(strip_locale(&config, "/fa/about"), "/about");
	// Repeated ones are what a half-applied redirect leaves behind. Removing
	// only the first would break the idempotence the loop guarantee rests on.
	assert_eq!(strip_locale(&config, "/fa/en/fa/about"), "/about");
	assert_eq!(strip_locale(&config, "/fa"), "/");
	assert_eq!(strip_locale(&config, "/"), "/");
	// A locale name deeper in the path is a real route segment, not a prefix.
	assert_eq!(strip_locale(&config, "/blog/fa"), "/blog/fa");
}

#[test]
fn strip_locale_normalises_slashes() {
	let config = config(Strategy::Path, PrefixMode::Never);
	assert_eq!(strip_locale(&config, "/fa//about//"), "/about");
	assert_eq!(strip_locale(&config, ""), "/");
}

#[test]
fn canonical_path_respects_prefix_mode() {
	let always = config(Strategy::Path, PrefixMode::Always);
	assert_eq!(
		canonical_public_path(&always, "/about", "fa", "fa"),
		"/fa/about"
	);
	assert_eq!(
		canonical_public_path(&always, "/about", "en", "fa"),
		"/en/about"
	);
	assert_eq!(canonical_public_path(&always, "/", "fa", "fa"), "/fa");

	let as_needed = config(Strategy::Path, PrefixMode::AsNeeded);
	assert_eq!(
		canonical_public_path(&as_needed, "/about", "fa", "fa"),
		"/about"
	);
	assert_eq!(
		canonical_public_path(&as_needed, "/about", "en", "fa"),
		"/en/about"
	);

	let never = config(Strategy::Path, PrefixMode::Never);
	assert_eq!(
		canonical_public_path(&never, "/en/about", "en", "fa"),
		"/about"
	);
	assert_eq!(canonical_public_path(&never, "/", "en", "fa"), "/");
}

#[test]
fn as_needed_is_relative_to_the_domain_locale() {
	// On example.com the unprefixed path means English, even though the global
	// default is Persian. Canonicalising against the global default instead
	// would make /about and /en/about disagree and bounce between each other.
	let config = domain_config(PrefixMode::AsNeeded);
	let base = base_locale(&config, Some("example.com"));
	assert_eq!(base, "en");

	assert_eq!(
		canonical_public_path(&config, "/about", "en", base),
		"/about"
	);
	assert_eq!(
		canonical_public_path(&config, "/about", "fa", base),
		"/fa/about"
	);
}

#[test]
fn internal_path_is_always_prefixed() {
	let never = config(Strategy::Cookie, PrefixMode::Never);
	assert_eq!(internal_path(&never, "/about", "en"), "/en/about");
	assert_eq!(internal_path(&never, "/", "fa"), "/fa");
	assert_eq!(internal_path(&never, "/fa/about", "en"), "/en/about");
}

#[test]
fn path_strategy_as_needed_rewrites_the_default_locale() {
	let config = config(Strategy::Path, PrefixMode::AsNeeded);

	let decision = decide(&config, &request("/about"));
	assert_eq!(decision.locale, "fa");
	assert_eq!(decision.source, LocaleSource::Default);
	assert_eq!(rewrite_target(&decision), "/fa/about");
}

#[test]
fn path_strategy_passes_through_a_correctly_prefixed_url() {
	let config = config(Strategy::Path, PrefixMode::AsNeeded);

	let decision = decide(&config, &request("/en/about"));
	assert_eq!(decision.locale, "en");
	assert_eq!(decision.source, LocaleSource::Path);
	assert_eq!(decision.action, Action::Next);
}

#[test]
fn path_strategy_redirects_a_redundant_default_prefix() {
	let config = config(Strategy::Path, PrefixMode::AsNeeded);

	let decision = decide(&config, &request("/fa/about"));
	assert_eq!(decision.locale, "fa");
	assert_eq!(redirect_target(&decision), "/about");
}

#[test]
fn path_prefix_wins_over_the_cookie() {
	// A shared link must render the locale it names, whatever the visitor's
	// previous choice was.
	let config = config(Strategy::Path, PrefixMode::AsNeeded);

	let decision = decide(&config, &with_cookie("/en/about", "fa"));
	assert_eq!(decision.locale, "en");
	assert_eq!(decision.source, LocaleSource::Path);
	assert!(decision.set_cookie, "the new choice must be persisted");
}

#[test]
fn accept_language_is_used_when_nothing_else_resolves() {
	let config = config(Strategy::Path, PrefixMode::AsNeeded);
	let request = RequestInfo {
		accept_language: Some("en-GB,en;q=0.9".to_owned()),
		..request("/about")
	};

	let decision = decide(&config, &request);
	assert_eq!(decision.locale, "en");
	assert_eq!(decision.source, LocaleSource::Header);
	assert_eq!(redirect_target(&decision), "/en/about");
}

#[test]
fn always_mode_prefixes_the_default_locale_too() {
	let config = config(Strategy::Path, PrefixMode::Always);

	let decision = decide(&config, &request("/about"));
	assert_eq!(redirect_target(&decision), "/fa/about");

	let decision = decide(&config, &request("/fa/about"));
	assert_eq!(decision.action, Action::Next);
}

#[test]
fn never_mode_hides_the_locale_and_rewrites_internally() {
	let config = config(Strategy::Cookie, PrefixMode::Never);

	let decision = decide(&config, &with_cookie("/about", "en"));
	assert_eq!(decision.locale, "en");
	assert_eq!(decision.source, LocaleSource::Cookie);
	assert_eq!(rewrite_target(&decision), "/en/about");
	assert!(!decision.set_cookie, "the cookie already matches");
}

#[test]
fn never_mode_strips_a_locale_that_leaked_into_the_url() {
	let config = config(Strategy::Cookie, PrefixMode::Never);

	let decision = decide(&config, &with_cookie("/en/about", "en"));
	assert_eq!(redirect_target(&decision), "/about");
}

#[test]
fn never_mode_ignores_a_path_prefix_as_a_selector() {
	// The URL cannot express a locale in this mode, so a stray prefix is not a
	// request for that locale. Honouring it would resolve a locale that the
	// redirect immediately strips, landing the visitor somewhere else.
	let config = config(Strategy::Cookie, PrefixMode::Never);

	let decision = decide(&config, &with_cookie("/en/about", "fa"));
	assert_eq!(decision.locale, "fa");
	assert_eq!(decision.source, LocaleSource::Cookie);
	assert_eq!(redirect_target(&decision), "/about");
}

#[test]
fn domain_strategy_resolves_from_the_host() {
	let config = domain_config(PrefixMode::Never);

	let decision = decide(&config, &with_host("/about", "example.com"));
	assert_eq!(decision.locale, "en");
	assert_eq!(decision.source, LocaleSource::Domain);
	assert_eq!(rewrite_target(&decision), "/en/about");

	let decision = decide(&config, &with_host("/about", "example.ir"));
	assert_eq!(decision.locale, "fa");
	assert_eq!(rewrite_target(&decision), "/fa/about");
}

#[test]
fn domain_strategy_ignores_the_port() {
	let config = domain_config(PrefixMode::Never);

	let decision = decide(&config, &with_host("/about", "example.com:3000"));
	assert_eq!(decision.locale, "en");
}

#[test]
fn domain_strategy_beats_a_conflicting_cookie() {
	let config = domain_config(PrefixMode::Never);
	let request = RequestInfo {
		cookie_locale: Some("fa".to_owned()),
		..with_host("/about", "example.com")
	};

	let decision = decide(&config, &request);
	assert_eq!(decision.locale, "en");
	assert_eq!(decision.source, LocaleSource::Domain);
}

#[test]
fn domain_strategy_rejects_a_prefix_the_domain_does_not_serve() {
	// example.ir serves fa only. A stray /en prefix is not honoured; the
	// request is normalised back to the domain's own locale.
	let config = domain_config(PrefixMode::AsNeeded);

	let decision = decide(&config, &with_host("/en/about", "example.ir"));
	assert_eq!(decision.locale, "fa");
	assert_eq!(decision.source, LocaleSource::Domain);
	assert_eq!(redirect_target(&decision), "/about");
}

#[test]
fn domain_strategy_honours_a_prefix_the_domain_opted_into() {
	// A domain that lists extra `locales` is opting into prefix selection.
	let mut config = domain_config(PrefixMode::AsNeeded);
	if let Some(rule) = config
		.domains
		.iter_mut()
		.find(|r| r.domain == "example.com")
	{
		rule.locales = vec!["fa".to_owned()];
	}

	let decision = decide(&config, &with_host("/about", "example.com"));
	assert_eq!(decision.locale, "en");
	assert_eq!(decision.source, LocaleSource::Domain);

	// The prefix is already the canonical public form here, so the URL is
	// served as-is rather than rewritten.
	let decision = decide(&config, &with_host("/fa/about", "example.com"));
	assert_eq!(decision.locale, "fa");
	assert_eq!(decision.source, LocaleSource::Path);
	assert_eq!(decision.action, Action::Next);
}

#[test]
fn domain_strategy_does_not_write_a_cookie_for_a_known_host() {
	// The host is the selector, so a cookie would record a preference that is
	// never read back.
	let config = domain_config(PrefixMode::Never);

	let decision = decide(&config, &with_host("/about", "example.com"));
	assert!(!decision.set_cookie);
}

#[test]
fn domain_strategy_falls_back_to_the_cookie_on_an_unlisted_host() {
	// localhost and preview deployments are not in the domain table. Without
	// the cookie there would be nothing to persist a locale choice in, and a
	// prefix-stripping redirect would re-negotiate into a different locale.
	let config = domain_config(PrefixMode::AsNeeded);
	let request = RequestInfo {
		cookie_locale: Some("en".to_owned()),
		..with_host("/about", "localhost:3000")
	};

	let decision = decide(&config, &request);
	assert_eq!(decision.locale, "en");
	assert_eq!(decision.source, LocaleSource::Cookie);
	assert!(!decision.set_cookie, "the cookie already matches");
}

#[test]
fn redirects_are_permanent_only_when_the_locale_came_from_the_url() {
	let config = config(Strategy::Path, PrefixMode::AsNeeded);

	// /fa/about -> /about is the same for every visitor: cacheable.
	match decide(&config, &request("/fa/about")).action {
		Action::Redirect { permanent, .. } => assert!(permanent),
		other => panic!("expected a redirect, got {other:?}"),
	}

	// /about -> /en/about depends on this visitor's Accept-Language: never
	// cacheable, or the next visitor inherits someone else's language.
	let negotiated = RequestInfo {
		accept_language: Some("en".to_owned()),
		..request("/about")
	};
	match decide(&config, &negotiated).action {
		Action::Redirect { permanent, .. } => assert!(!permanent),
		other => panic!("expected a redirect, got {other:?}"),
	}
}

#[test]
fn unknown_hosts_do_not_block_locale_resolution() {
	// Preview deployments and localhost are not in the domain table.
	let config = domain_config(PrefixMode::AsNeeded);
	let request = RequestInfo {
		cookie_locale: Some("en".to_owned()),
		..with_host("/about", "localhost:3000")
	};

	let decision = decide(&config, &request);
	assert_eq!(decision.locale, "en");
}

#[test]
fn already_resolved_requests_are_never_redirected() {
	let config = config(Strategy::Path, PrefixMode::Always);
	let request = RequestInfo {
		already_resolved: true,
		..request("/about")
	};

	let decision = decide(&config, &request);
	assert_eq!(decision.action, Action::Next);
}

#[test]
fn skipped_paths_are_passed_through_untouched() {
	let config = config(Strategy::Path, PrefixMode::Always);

	let decision = decide(&config, &request("/_next/static/chunk.js"));
	assert_eq!(decision.action, Action::Next);
	assert!(!decision.set_cookie, "assets must not write cookies");
}

#[test]
fn a_redirect_target_never_redirects_again() {
	// The concrete form of the loop guarantee; the property test generalises it.
	let config = config(Strategy::Path, PrefixMode::Always);

	let first = decide(&config, &request("/fa/en/about"));
	let target = redirect_target(&first).to_owned();

	let second = decide(&config, &with_cookie(&target, &first.locale));
	assert!(
		!matches!(second.action, Action::Redirect { .. }),
		"redirect target {target} redirected again: {:?}",
		second.action
	);
}
