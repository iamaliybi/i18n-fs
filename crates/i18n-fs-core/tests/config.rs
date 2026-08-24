//! Validation of the compiled `i18n-fs.config.ts` snapshot.
//!
//! Validation runs in the CLI at build time, so a broken configuration fails the
//! build rather than surfacing as mysterious routing behaviour in production.

#![cfg(feature = "diagnostics")]
#![allow(clippy::unwrap_used, clippy::panic)]

use i18n_fs_core::config::{CookieConfig, DomainRule, I18nConfig, PrefixMode, Strategy};

fn valid() -> I18nConfig {
	I18nConfig {
		locales: vec!["fa".to_owned(), "en".to_owned()],
		default_locale: "fa".to_owned(),
		..I18nConfig::default()
	}
}

fn fields(config: &I18nConfig) -> Vec<String> {
	config.validate().into_iter().map(|i| i.field).collect()
}

#[test]
fn a_minimal_configuration_is_valid() {
	assert!(valid().validate().is_empty());
}

#[test]
fn locales_must_not_be_empty() {
	let config = I18nConfig {
		locales: Vec::new(),
		..valid()
	};
	assert!(fields(&config).contains(&"locales".to_owned()));
}

#[test]
fn locales_must_be_well_formed_tags() {
	let config = I18nConfig {
		locales: vec!["fa".to_owned(), "not a tag".to_owned()],
		..valid()
	};
	assert!(fields(&config).contains(&"locales[1]".to_owned()));
}

#[test]
fn duplicate_locales_are_rejected() {
	let config = I18nConfig {
		locales: vec!["fa".to_owned(), "FA".to_owned()],
		..valid()
	};
	assert!(fields(&config).contains(&"locales[1]".to_owned()));
}

#[test]
fn the_default_locale_must_be_one_of_the_locales() {
	let config = I18nConfig {
		default_locale: "de".to_owned(),
		..valid()
	};
	assert!(fields(&config).contains(&"defaultLocale".to_owned()));
}

#[test]
fn the_domain_strategy_requires_domains() {
	let config = I18nConfig {
		strategy: Strategy::Domain,
		..valid()
	};
	assert!(fields(&config).contains(&"domains".to_owned()));
}

#[test]
fn domains_must_be_bare_hostnames() {
	let config = I18nConfig {
		strategy: Strategy::Domain,
		domains: vec![DomainRule {
			domain: "https://example.ir".to_owned(),
			locale: "fa".to_owned(),
			locales: Vec::new(),
		}],
		..valid()
	};
	assert!(fields(&config).contains(&"domains[0].domain".to_owned()));
}

#[test]
fn a_domain_locale_must_be_configured() {
	let config = I18nConfig {
		strategy: Strategy::Domain,
		domains: vec![DomainRule {
			domain: "example.de".to_owned(),
			locale: "de".to_owned(),
			locales: vec!["it".to_owned()],
		}],
		..valid()
	};
	let reported = fields(&config);
	assert!(reported.contains(&"domains[0].locale".to_owned()));
	assert!(reported.contains(&"domains[0].locales[0]".to_owned()));
}

#[test]
fn a_hostname_may_be_bound_only_once() {
	let config = I18nConfig {
		strategy: Strategy::Domain,
		domains: vec![
			DomainRule {
				domain: "example.ir".to_owned(),
				locale: "fa".to_owned(),
				locales: Vec::new(),
			},
			DomainRule {
				domain: "EXAMPLE.IR".to_owned(),
				locale: "en".to_owned(),
				locales: Vec::new(),
			},
		],
		..valid()
	};
	assert!(fields(&config).contains(&"domains[1].domain".to_owned()));
}

#[test]
fn the_cookie_name_must_be_a_valid_token() {
	for name in ["", "has space", "has=equals", "has;semicolon"] {
		let config = I18nConfig {
			cookie: CookieConfig {
				name: name.to_owned(),
				..CookieConfig::default()
			},
			..valid()
		};
		assert!(
			fields(&config).contains(&"cookie.name".to_owned()),
			"{name:?} should be rejected"
		);
	}
}

#[test]
fn the_messages_directory_must_stay_inside_public() {
	for dir in ["/etc/passwd", "../../secrets", "locales/../.."] {
		let config = I18nConfig {
			messages_dir: dir.to_owned(),
			..valid()
		};
		assert!(
			fields(&config).contains(&"messagesDir".to_owned()),
			"{dir:?} should be rejected"
		);
	}
}

#[test]
fn every_problem_is_reported_in_one_pass() {
	// The CLI prints all of them at once; fixing one at a time is a bad loop.
	let config = I18nConfig {
		locales: vec!["nope!".to_owned()],
		default_locale: "missing".to_owned(),
		strategy: Strategy::Domain,
		messages_dir: "../outside".to_owned(),
		..I18nConfig::default()
	};

	let issues = config.validate();
	assert!(
		issues.len() >= 4,
		"expected several issues, got {issues:#?}"
	);
}

#[test]
fn locale_lookup_ignores_case_but_returns_the_configured_spelling() {
	let config = I18nConfig {
		locales: vec!["de-AT".to_owned()],
		default_locale: "de-AT".to_owned(),
		..I18nConfig::default()
	};

	assert!(config.has_locale("DE-at"));
	assert_eq!(config.canonical_locale("de-at"), Some("de-AT"));
	assert_eq!(config.canonical_locale("fr"), None);
}

#[test]
fn the_snapshot_round_trips_through_json() {
	// The CLI serialises this into the generated bundle and the WASM layer
	// deserialises it, so the two representations must agree.
	let config = I18nConfig {
		strategy: Strategy::Domain,
		domains: vec![DomainRule {
			domain: "example.ir".to_owned(),
			locale: "fa".to_owned(),
			locales: Vec::new(),
		}],
		..valid()
	};

	let json = serde_json::to_string(&config).unwrap();
	assert!(json.contains("defaultLocale"), "expected camelCase: {json}");

	let parsed: I18nConfig = serde_json::from_str(&json).unwrap();
	assert_eq!(parsed, config);
}

#[test]
fn optional_fields_may_be_omitted_from_the_snapshot() {
	let parsed: I18nConfig =
		serde_json::from_str(r#"{"locales":["fa"],"defaultLocale":"fa"}"#).unwrap();

	assert_eq!(parsed.strategy, Strategy::Path);
	assert_eq!(parsed.messages_dir, "locales");
	assert!(parsed.validate().is_empty());
}

// A domain's extra `locales` are reachable only through a URL prefix, and
// `never` removes prefixes. The router already resolves this deterministically
// — the loop tests cover that — so nothing breaks at runtime and the locale is
// simply unreachable. Catching it at build time is the point.
#[test]
fn rejects_extra_domain_locales_under_prefix_never() {
	let config = I18nConfig {
		locales: vec!["fa".to_owned(), "en".to_owned(), "de-AT".to_owned()],
		default_locale: "fa".to_owned(),
		strategy: Strategy::Domain,
		prefix: PrefixMode::Never,
		domains: vec![DomainRule {
			domain: "example.com".to_owned(),
			locale: "en".to_owned(),
			locales: vec!["de-AT".to_owned()],
		}],
		..I18nConfig::default()
	};

	let issues = config.validate();
	let Some(issue) = issues.iter().find(|i| i.field == "domains[0].locales") else {
		panic!("the unreachable locale should be reported; got {issues:?}");
	};

	// The message has to say what to do, not only that something is wrong.
	assert!(issue.message.contains("as-needed"), "{}", issue.message);
	assert!(issue.message.contains("example.com"), "{}", issue.message);
}

#[test]
fn accepts_extra_domain_locales_when_prefixes_survive() {
	// The same configuration is fine as soon as a prefix can express the locale.
	for prefix in [PrefixMode::AsNeeded, PrefixMode::Always] {
		let config = I18nConfig {
			locales: vec!["fa".to_owned(), "en".to_owned(), "de-AT".to_owned()],
			default_locale: "fa".to_owned(),
			strategy: Strategy::Domain,
			prefix,
			domains: vec![DomainRule {
				domain: "example.com".to_owned(),
				locale: "en".to_owned(),
				locales: vec!["de-AT".to_owned()],
			}],
			..I18nConfig::default()
		};

		assert!(
			!fields(&config).iter().any(|f| f == "domains[0].locales"),
			"{prefix:?} should not be reported"
		);
	}
}

#[test]
fn leaves_a_domain_without_extra_locales_alone_under_never() {
	// `domain` with `never` is the ordinary separate-sites-per-language setup
	// and must stay valid.
	let config = I18nConfig {
		locales: vec!["fa".to_owned(), "en".to_owned()],
		default_locale: "fa".to_owned(),
		strategy: Strategy::Domain,
		prefix: PrefixMode::Never,
		domains: vec![
			DomainRule {
				domain: "example.ir".to_owned(),
				locale: "fa".to_owned(),
				locales: vec![],
			},
			DomainRule {
				domain: "example.com".to_owned(),
				locale: "en".to_owned(),
				locales: vec![],
			},
		],
		..I18nConfig::default()
	};

	assert!(config.validate().is_empty(), "{:?}", config.validate());
}
