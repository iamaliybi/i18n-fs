//! BCP-47 parsing and `Accept-Language` negotiation.

#![allow(clippy::unwrap_used, clippy::panic)]

use i18n_fs_core::locale::{parse_accept_language, LanguageTag, MatchKind};
use i18n_fs_core::negotiate;

fn supported(list: &[&str]) -> Vec<String> {
    list.iter().map(|s| (*s).to_owned()).collect()
}

#[test]
fn parses_and_normalises_tags() {
    let tag = LanguageTag::parse("FA-arab-ir").unwrap();
    assert_eq!(tag.language(), "fa");
    assert_eq!(tag.script(), Some("Arab"));
    assert_eq!(tag.region(), Some("IR"));
    assert_eq!(tag.to_string(), "fa-Arab-IR");
}

#[test]
fn accepts_underscore_separated_tags() {
    // Developers copy these out of filesystem paths often enough to matter.
    assert_eq!(
        LanguageTag::parse("pt_BR").unwrap().to_string(),
        "pt-BR".to_owned()
    );
}

#[test]
fn accepts_numeric_regions_and_variants() {
    let tag = LanguageTag::parse("es-419").unwrap();
    assert_eq!(tag.region(), Some("419"));

    let tag = LanguageTag::parse("de-CH-1901").unwrap();
    assert_eq!(tag.to_string(), "de-CH-1901");
}

#[test]
fn drops_extension_and_private_use_subtags() {
    let tag = LanguageTag::parse("en-US-u-ca-gregory").unwrap();
    assert_eq!(tag.to_string(), "en-US");

    let tag = LanguageTag::parse("fa-IR-x-internal").unwrap();
    assert_eq!(tag.to_string(), "fa-IR");
}

#[test]
fn rejects_malformed_tags() {
    for bad in [
        "",
        "-",
        "e",
        "toolongprimary",
        "fa-",
        "fa--IR",
        "فارسی",
        "1234",
    ] {
        assert!(
            LanguageTag::parse(bad).is_none(),
            "expected {bad:?} to be rejected"
        );
    }
}

#[test]
fn lookup_relation_is_directional() {
    let specific = LanguageTag::parse("fa-IR").unwrap();
    let generic = LanguageTag::parse("fa").unwrap();

    assert!(specific.is_covered_by(&generic));
    assert!(!generic.is_covered_by(&specific));
    assert!(specific.is_covered_by(&specific));
}

#[test]
fn parses_quality_values_in_order() {
    let ranges = parse_accept_language("en;q=0.5, fa-IR, de;q=0.8, *;q=0.1");
    let names: Vec<&str> = ranges.iter().map(|r| r.range.as_str()).collect();
    assert_eq!(names, vec!["fa-IR", "de", "en", "*"]);
}

#[test]
fn drops_explicitly_refused_and_malformed_qualities() {
    let ranges = parse_accept_language("fa;q=0, en;q=abc, de;q=0.4");
    let names: Vec<&str> = ranges.iter().map(|r| r.range.as_str()).collect();
    assert_eq!(names, vec!["de"]);
}

#[test]
fn equal_quality_preserves_header_order() {
    let ranges = parse_accept_language("de, fr, es");
    let names: Vec<&str> = ranges.iter().map(|r| r.range.as_str()).collect();
    assert_eq!(names, vec!["de", "fr", "es"]);
}

#[test]
fn negotiates_exact_match() {
    let result = negotiate("en-US,en;q=0.9", &supported(&["fa", "en"]), "fa");
    assert_eq!(result.locale, "en");
    assert_eq!(result.kind, MatchKind::Lookup);
}

#[test]
fn negotiates_by_truncating_the_range() {
    // Client asks for fa-IR, we ship fa: RFC 4647 Lookup truncates the range.
    let result = negotiate("fa-IR,en;q=0.5", &supported(&["fa", "en"]), "en");
    assert_eq!(result.locale, "fa");
    assert_eq!(result.kind, MatchKind::Lookup);
}

#[test]
fn falls_back_to_the_primary_language_when_we_ship_only_a_refinement() {
    // Client asks for pt, we ship pt-BR. Strict Lookup fails; the language
    // fallback keeps the user out of the default locale.
    let result = negotiate("pt", &supported(&["pt-BR", "en"]), "en");
    assert_eq!(result.locale, "pt-BR");
    assert_eq!(result.kind, MatchKind::LanguageFallback);
}

#[test]
fn preference_order_beats_match_precision() {
    // de is a language-fallback match at q=1.0; en is an exact match at q=0.5.
    // The client said de first, so de wins.
    let result = negotiate("de,en;q=0.5", &supported(&["en", "de-AT"]), "en");
    assert_eq!(result.locale, "de-AT");
}

#[test]
fn wildcard_alone_falls_through_to_the_default() {
    let result = negotiate("*", &supported(&["fa", "en"]), "fa");
    assert_eq!(result.locale, "fa");
    assert_eq!(result.kind, MatchKind::Default);
}

#[test]
fn unmatched_header_falls_back_to_the_default_locale() {
    let result = negotiate("ja,ko;q=0.8", &supported(&["fa", "en"]), "fa");
    assert_eq!(result.locale, "fa");
    assert_eq!(result.kind, MatchKind::Default);
}

#[test]
fn empty_or_garbage_header_does_not_panic() {
    for header in ["", ",,,", ";;;", "   ", "q=1", "fa;;q=;"] {
        let result = negotiate(header, &supported(&["fa", "en"]), "fa");
        assert!(!result.locale.is_empty());
    }
}

#[test]
fn returns_the_configured_spelling_not_the_clients() {
    // The config says `de-AT`; the client said `DE-at`. Downstream code keys
    // caches and file paths by locale, so the config spelling must win.
    let result = negotiate("DE-at", &supported(&["de-AT"]), "de-AT");
    assert_eq!(result.locale, "de-AT");
}
