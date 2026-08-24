//! The serialised form of `i18n-fs.config.ts`.
//!
//! `i18n-fs.config.ts` cannot be imported directly by every runtime we target
//! (the Edge runtime has no TypeScript loader and WASM has no module system), so
//! the CLI compiles it once into a plain snapshot that is handed to the core as
//! data. This module defines that snapshot and validates it.

#[cfg(feature = "diagnostics")]
use crate::error::ErrorCode;
#[cfg(feature = "diagnostics")]
use crate::locale::LanguageTag;
use serde::{Deserialize, Serialize};

/// How the active locale is carried between requests.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum Strategy {
	/// The locale lives in the first path segment (`/fa/about`).
	#[default]
	Path,
	/// The locale is bound to the hostname (`example.ir` -> `fa`).
	Domain,
	/// The locale lives only in a cookie; the URL never shows it.
	Cookie,
}

/// Whether the locale is visible in the public URL.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "kebab-case")]
pub enum PrefixMode {
	/// Every locale is prefixed, including the default one.
	Always,
	/// Every locale except the default one is prefixed.
	#[default]
	AsNeeded,
	/// No locale is ever prefixed; the URL hides the locale entirely.
	Never,
}

/// One hostname bound to a locale, for [`Strategy::Domain`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DomainRule {
	/// Hostname without scheme or port, e.g. `example.ir`.
	pub domain: String,
	/// Locale served by that hostname.
	pub locale: String,
	/// Additional locales this domain may serve via prefix. Empty means the
	/// domain is single-locale.
	#[serde(default)]
	pub locales: Vec<String>,
}

/// Cookie used to persist an explicit user choice.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CookieConfig {
	/// Cookie name.
	pub name: String,
	/// `Max-Age` in seconds.
	pub max_age: u64,
	/// `SameSite` attribute, verbatim.
	pub same_site: String,
	/// `Path` attribute.
	pub path: String,
	/// Whether to emit the `Secure` attribute.
	pub secure: bool,
}

impl Default for CookieConfig {
	fn default() -> Self {
		Self {
			name: "I18N_FS_LOCALE".to_owned(),
			max_age: 60 * 60 * 24 * 365,
			same_site: "lax".to_owned(),
			path: "/".to_owned(),
			secure: true,
		}
	}
}

/// The compiled configuration snapshot.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct I18nConfig {
	/// Every locale the application ships, as BCP-47 tags.
	pub locales: Vec<String>,
	/// Locale used when nothing else resolves. Never used as a content fallback.
	pub default_locale: String,
	/// How the locale travels with the request.
	#[serde(default)]
	pub strategy: Strategy,
	/// Whether the locale is visible in the URL.
	#[serde(default)]
	pub prefix: PrefixMode,
	/// Hostname bindings, required for [`Strategy::Domain`].
	#[serde(default)]
	pub domains: Vec<DomainRule>,
	/// Cookie settings.
	#[serde(default)]
	pub cookie: CookieConfig,
	/// Directory under `public/` that holds the message tree.
	#[serde(default = "default_messages_dir")]
	pub messages_dir: String,
	/// Emit developer diagnostics. The CLI sets this from `NODE_ENV`.
	#[serde(default)]
	pub debug: bool,
}

fn default_messages_dir() -> String {
	"locales".to_owned()
}

impl Default for I18nConfig {
	fn default() -> Self {
		Self {
			locales: Vec::new(),
			default_locale: String::new(),
			strategy: Strategy::default(),
			prefix: PrefixMode::default(),
			domains: Vec::new(),
			cookie: CookieConfig::default(),
			messages_dir: default_messages_dir(),
			debug: false,
		}
	}
}

/// One problem found in a configuration snapshot.
#[cfg(feature = "diagnostics")]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigIssue {
	/// Always [`ErrorCode::InvalidConfig`]; present so the JS layer can switch
	/// on one field across every diagnostic type.
	pub code: ErrorCode,
	/// Dotted path of the offending field, e.g. `domains[1].locale`.
	pub field: String,
	/// Human-readable explanation.
	pub message: String,
}

#[cfg(feature = "diagnostics")]
impl ConfigIssue {
	fn new(field: impl Into<String>, message: impl Into<String>) -> Self {
		Self {
			code: ErrorCode::InvalidConfig,
			field: field.into(),
			message: message.into(),
		}
	}
}

impl I18nConfig {
	/// Whether `locale` is one of the configured locales, ignoring case.
	pub fn has_locale(&self, locale: &str) -> bool {
		self.locales.iter().any(|l| l.eq_ignore_ascii_case(locale))
	}

	/// Return the configured spelling of `locale`, ignoring case.
	pub fn canonical_locale<'a>(&'a self, locale: &str) -> Option<&'a str> {
		self.locales
			.iter()
			.find(|l| l.eq_ignore_ascii_case(locale))
			.map(String::as_str)
	}

	/// Validate the snapshot. An empty result means the configuration is usable.
	///
	/// Every issue is reported, not just the first, so the CLI can print them
	/// all in one pass.
	///
	/// Requires the `diagnostics` feature. Validation runs at build time in the
	/// CLI, so the Edge build leaves it out.
	#[cfg(feature = "diagnostics")]
	pub fn validate(&self) -> Vec<ConfigIssue> {
		let mut issues = Vec::new();

		if self.locales.is_empty() {
			issues.push(ConfigIssue::new(
				"locales",
				"at least one locale must be configured",
			));
		}

		for (index, locale) in self.locales.iter().enumerate() {
			if LanguageTag::parse(locale).is_none() {
				issues.push(ConfigIssue::new(
					format!("locales[{index}]"),
					format!("\"{locale}\" is not a well-formed BCP-47 language tag"),
				));
			}

			let duplicate = self
				.locales
				.iter()
				.take(index)
				.any(|other| other.eq_ignore_ascii_case(locale));
			if duplicate {
				issues.push(ConfigIssue::new(
					format!("locales[{index}]"),
					format!("\"{locale}\" is listed more than once"),
				));
			}
		}

		if self.default_locale.is_empty() {
			issues.push(ConfigIssue::new(
				"defaultLocale",
				"defaultLocale must be set",
			));
		} else if !self.has_locale(&self.default_locale) {
			issues.push(ConfigIssue::new(
				"defaultLocale",
				format!("\"{}\" is not present in locales", self.default_locale),
			));
		}

		if self.strategy == Strategy::Domain && self.domains.is_empty() {
			issues.push(ConfigIssue::new(
				"domains",
				"the domain strategy requires at least one domain binding",
			));
		}

		// A domain's extra `locales` are reachable only through a URL prefix —
		// that is what opting into them means — and `never` removes prefixes.
		// The router resolves this deterministically rather than bouncing, so
		// nothing breaks; the locale is simply unreachable, which is worse to
		// discover from a page that renders in the wrong language than from a
		// build that stops.
		if self.strategy == Strategy::Domain && self.prefix == PrefixMode::Never {
			for (index, rule) in self.domains.iter().enumerate() {
				if rule.locales.is_empty() {
					continue;
				}

				issues.push(ConfigIssue::new(
					format!("domains[{index}].locales"),
					format!(
						concat!(
							"\"{}\" lists extra locales, which are reachable only through a URL ",
							"prefix — and prefix \"never\" removes prefixes, so they can never ",
							"be selected. Use prefix \"as-needed\", or give each locale its own ",
							"domain."
						),
						rule.domain
					),
				));
			}
		}

		for (index, rule) in self.domains.iter().enumerate() {
			if rule.domain.trim().is_empty() {
				issues.push(ConfigIssue::new(
					format!("domains[{index}].domain"),
					"domain must not be empty",
				));
			}

			if rule.domain.contains("://") || rule.domain.contains(':') {
				issues.push(ConfigIssue::new(
					format!("domains[{index}].domain"),
					format!(
						"\"{}\" must be a bare hostname, without scheme or port",
						rule.domain
					),
				));
			}

			if !self.has_locale(&rule.locale) {
				issues.push(ConfigIssue::new(
					format!("domains[{index}].locale"),
					format!("\"{}\" is not present in locales", rule.locale),
				));
			}

			for (extra_index, extra) in rule.locales.iter().enumerate() {
				if !self.has_locale(extra) {
					issues.push(ConfigIssue::new(
						format!("domains[{index}].locales[{extra_index}]"),
						format!("\"{extra}\" is not present in locales"),
					));
				}
			}

			let duplicate = self
				.domains
				.iter()
				.take(index)
				.any(|other| other.domain.eq_ignore_ascii_case(&rule.domain));
			if duplicate {
				issues.push(ConfigIssue::new(
					format!("domains[{index}].domain"),
					format!("\"{}\" is bound more than once", rule.domain),
				));
			}
		}

		let invalid_cookie_name = self.cookie.name.is_empty()
			|| self
				.cookie
				.name
				.chars()
				.any(|c| c.is_whitespace() || c == ';' || c == '=' || c == ',');
		if invalid_cookie_name {
			issues.push(ConfigIssue::new(
				"cookie.name",
				format!("\"{}\" is not a valid cookie name", self.cookie.name),
			));
		}

		if self.messages_dir.starts_with('/') || self.messages_dir.contains("..") {
			issues.push(ConfigIssue::new(
				"messagesDir",
				"messagesDir must be a relative path inside public/, without \"..\"",
			));
		}

		issues
	}
}
