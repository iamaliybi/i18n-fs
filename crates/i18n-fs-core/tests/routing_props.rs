//! Property tests for the infinite-loop guarantee.
//!
//! Example-based tests can only cover the paths we thought of. A redirect loop
//! is by definition the path nobody thought of, so the two invariants that
//! prevent it are asserted over generated input instead:
//!
//! 1. [`canonical_public_path`] is idempotent.
//! 2. Following a redirect never produces another redirect.

#![allow(clippy::unwrap_used, clippy::panic)]

// Aliased: `proptest::Strategy` is a trait and would collide with the enum.
use i18n_fs_core::config::{DomainRule, I18nConfig, PrefixMode, Strategy as RoutingStrategy};
use i18n_fs_core::routing::{
    base_locale, canonical_public_path, decide, internal_path, Action, RequestInfo,
};
use proptest::prelude::*;

const LOCALES: [&str; 3] = ["fa", "en", "de-AT"];

fn strategies() -> impl Strategy<Value = RoutingStrategy> {
    prop_oneof![
        Just(RoutingStrategy::Path),
        Just(RoutingStrategy::Domain),
        Just(RoutingStrategy::Cookie),
    ]
}

fn prefixes() -> impl Strategy<Value = PrefixMode> {
    prop_oneof![
        Just(PrefixMode::Always),
        Just(PrefixMode::AsNeeded),
        Just(PrefixMode::Never),
    ]
}

fn configs() -> impl Strategy<Value = I18nConfig> {
    (strategies(), prefixes(), 0usize..LOCALES.len()).prop_map(|(strategy, prefix, default)| {
        I18nConfig {
            locales: LOCALES.iter().map(|l| (*l).to_owned()).collect(),
            default_locale: LOCALES.get(default).copied().unwrap_or("fa").to_owned(),
            strategy,
            prefix,
            domains: vec![
                DomainRule {
                    domain: "example.ir".to_owned(),
                    locale: "fa".to_owned(),
                    locales: Vec::new(),
                },
                DomainRule {
                    domain: "example.com".to_owned(),
                    locale: "en".to_owned(),
                    locales: vec!["de-AT".to_owned()],
                },
            ],
            ..I18nConfig::default()
        }
    })
}

/// Paths deliberately biased toward the shapes that break naive
/// implementations: repeated locale segments, empty segments, locale-looking
/// route names.
fn paths() -> impl Strategy<Value = String> {
    let segment = prop_oneof![
        Just("fa"),
        Just("en"),
        Just("de-AT"),
        Just("about"),
        Just("blog"),
        Just(""),
        Just("en-US"),
    ];

    prop::collection::vec(segment, 0..6).prop_map(|parts| format!("/{}", parts.join("/")))
}

fn hosts() -> impl Strategy<Value = Option<String>> {
    prop_oneof![
        Just(None),
        Just(Some("example.ir".to_owned())),
        Just(Some("example.com".to_owned())),
        Just(Some("localhost:3000".to_owned())),
    ]
}

fn cookies() -> impl Strategy<Value = Option<String>> {
    prop_oneof![
        Just(None),
        Just(Some("fa".to_owned())),
        Just(Some("en".to_owned())),
        Just(Some("de-AT".to_owned())),
        Just(Some("ru".to_owned())),
    ]
}

fn headers() -> impl Strategy<Value = Option<String>> {
    prop_oneof![
        Just(None),
        Just(Some("en-US,en;q=0.9".to_owned())),
        Just(Some("fa-IR,fa;q=0.9,en;q=0.5".to_owned())),
        Just(Some("*".to_owned())),
        Just(Some("ja".to_owned())),
    ]
}

fn requests() -> impl Strategy<Value = RequestInfo> {
    (paths(), hosts(), cookies(), headers()).prop_map(
        |(pathname, host, cookie_locale, accept_language)| RequestInfo {
            pathname,
            host,
            cookie_locale,
            accept_language,
            already_resolved: false,
        },
    )
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(4096))]

    /// The fixed-point property. Everything else rests on this.
    #[test]
    fn canonical_path_is_idempotent(
        config in configs(),
        path in paths(),
        index in 0usize..3,
        host in hosts(),
    ) {
        let locale = LOCALES.get(index).copied().unwrap_or("fa");
        let base = base_locale(&config, host.as_deref()).to_owned();
        let once = canonical_public_path(&config, &path, locale, &base);
        let twice = canonical_public_path(&config, &once, locale, &base);
        prop_assert_eq!(&once, &twice, "canonicalisation is not a fixed point");
    }

    /// The internal path is already canonical for its own locale.
    #[test]
    fn internal_path_is_idempotent(config in configs(), path in paths(), index in 0usize..3) {
        let locale = LOCALES.get(index).copied().unwrap_or("fa");
        let once = internal_path(&config, &path, locale);
        let twice = internal_path(&config, &once, locale);
        prop_assert_eq!(&once, &twice);
    }

    /// Every produced path is a well-formed absolute path.
    #[test]
    fn canonical_path_is_well_formed(
        config in configs(),
        path in paths(),
        index in 0usize..3,
        host in hosts(),
    ) {
        let locale = LOCALES.get(index).copied().unwrap_or("fa");
        let base = base_locale(&config, host.as_deref()).to_owned();
        let result = canonical_public_path(&config, &path, locale, &base);

        prop_assert!(result.starts_with('/'), "{result} is not absolute");
        prop_assert!(!result.contains("//"), "{result} has an empty segment");
        prop_assert!(
            result == "/" || !result.ends_with('/'),
            "{result} has a trailing slash"
        );
    }

    /// The loop guarantee: following a redirect must not redirect again.
    ///
    /// The follow-up request carries the cookie the first response set, which is
    /// how the real middleware behaves — without it a `Never`-prefix
    /// configuration would legitimately re-resolve to a different locale.
    #[test]
    fn following_a_redirect_terminates(config in configs(), request in requests()) {
        let first = decide(&config, &request);

        let Action::Redirect { path, .. } = &first.action else {
            return Ok(());
        };

        let followed = RequestInfo {
            pathname: path.clone(),
            cookie_locale: if first.set_cookie {
                Some(first.locale.clone())
            } else {
                request.cookie_locale.clone()
            },
            ..request.clone()
        };

        let second = decide(&config, &followed);

        // Terminating is not enough on its own: a chain that settles on a
        // *different* locale than the one the request asked for is still wrong,
        // and is what a prefix-stripping redirect does when nothing carries the
        // choice forward.
        prop_assert_eq!(
            &second.locale,
            &first.locale,
            "redirect changed the locale: {} -> {}",
            first.locale,
            second.locale
        );

        prop_assert!(
            !matches!(second.action, Action::Redirect { .. }),
            "redirect chain did not terminate: {} -> {} -> {:?} (config: {:?}/{:?})",
            request.pathname,
            path,
            second.action,
            config.strategy,
            config.prefix,
        );
    }

    /// The last-resort guard: a request a previous pass already resolved is
    /// passed through whatever its shape. This is what still stops a loop if the
    /// reasoning above is ever broken by a future change.
    #[test]
    fn the_already_resolved_guard_always_terminates(config in configs(), request in requests()) {
        let guarded = RequestInfo {
            already_resolved: true,
            ..request
        };
        prop_assert_eq!(decide(&config, &guarded).action, Action::Next);
    }

    /// A rewrite is internal and must be self-consistent: the rewrite target is
    /// already the internal path for its own locale, and its public form is the
    /// URL we are already on. So a deployment that re-enters middleware on
    /// rewrites still settles.
    #[test]
    fn rewrite_targets_are_stable(config in configs(), request in requests()) {
        let first = decide(&config, &request);

        let Action::Rewrite { path } = &first.action else {
            return Ok(());
        };

        let again = internal_path(&config, path, &first.locale);
        prop_assert_eq!(&again, path, "rewrite target was not stable");

        let base = base_locale(&config, request.host.as_deref()).to_owned();
        let public = canonical_public_path(&config, path, &first.locale, &base);
        prop_assert_eq!(public, request.pathname);
    }

    /// Resolution always yields a configured locale, never an empty string or a
    /// value the client made up.
    #[test]
    fn resolved_locale_is_always_configured(config in configs(), request in requests()) {
        let decision = decide(&config, &request);
        prop_assert!(
            config.has_locale(&decision.locale),
            "resolved {} which is not in the configured locales",
            decision.locale
        );
    }

    /// Nothing in the decision path panics, whatever the input looks like.
    #[test]
    fn never_panics_on_arbitrary_input(config in configs(), pathname in ".*") {
        let request = RequestInfo {
            pathname,
            ..RequestInfo::default()
        };
        let _ = decide(&config, &request);
    }
}
