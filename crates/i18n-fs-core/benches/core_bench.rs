//! Benchmarks for the three hot paths.
//!
//! These exist to keep the Rust/JS boundary honest. If a path here is not
//! measurably better than the equivalent JavaScript, it does not belong in WASM.

#![allow(clippy::unwrap_used, missing_docs)]

use criterion::{black_box, criterion_group, criterion_main, Criterion};
use i18n_fs_core::config::{I18nConfig, PrefixMode, Strategy};
use i18n_fs_core::routing::RequestInfo;
use i18n_fs_core::{decide, interpolate, negotiate, tokenize, MessageStore};
use std::collections::BTreeMap;

fn config() -> I18nConfig {
    I18nConfig {
        locales: vec![
            "fa".to_owned(),
            "en".to_owned(),
            "ar".to_owned(),
            "de-DE".to_owned(),
        ],
        default_locale: "fa".to_owned(),
        strategy: Strategy::Path,
        prefix: PrefixMode::AsNeeded,
        ..I18nConfig::default()
    }
}

fn namespace_json() -> String {
    let mut sections = Vec::new();
    for section in 0..40 {
        let mut keys = Vec::new();
        for key in 0..25 {
            keys.push(format!(
                "\"key{key}\": \"message {section}/{key} for {{name}}\""
            ));
        }
        sections.push(format!("\"scope{section}\": {{ {} }}", keys.join(", ")));
    }
    format!("{{ {} }}", sections.join(", "))
}

fn bench_negotiate(c: &mut Criterion) {
    let config = config();
    let header = "fa-IR,fa;q=0.9,en-US;q=0.8,en;q=0.7,de;q=0.5,*;q=0.1";

    c.bench_function("negotiate/accept-language", |b| {
        b.iter(|| {
            negotiate(
                black_box(header),
                black_box(&config.locales),
                black_box(&config.default_locale),
            )
        });
    });
}

fn bench_decide(c: &mut Criterion) {
    let config = config();
    let request = RequestInfo {
        pathname: "/en/docs/getting-started/installation".to_owned(),
        host: Some("example.com".to_owned()),
        cookie_locale: Some("fa".to_owned()),
        accept_language: Some("en-US,en;q=0.9".to_owned()),
        already_resolved: false,
    };

    c.bench_function("routing/decide", |b| {
        b.iter(|| decide(black_box(&config), black_box(&request)));
    });
}

fn bench_store(c: &mut Criterion) {
    let raw = namespace_json();

    c.bench_function("store/parse+flatten (1000 keys)", |b| {
        b.iter(|| MessageStore::from_json("fa", "bench", black_box(&raw)).unwrap());
    });

    let store = MessageStore::from_json("fa", "bench", &raw).unwrap();
    c.bench_function("store/resolve", |b| {
        b.iter(|| store.resolve_text(black_box(Some("scope20")), black_box("key12")));
    });
}

fn bench_format(c: &mut Criterion) {
    let mut params = BTreeMap::new();
    params.insert("name".to_owned(), "Ali".to_owned());
    params.insert("count".to_owned(), "12".to_owned());

    let plain = "Hello {name}, you have {count} new messages waiting in your inbox.";
    c.bench_function("format/interpolate", |b| {
        b.iter(|| interpolate(black_box(plain), black_box(&params)));
    });

    let rich = "Hello <b>{name}</b>, read the <link><b>full report</b></link> or <i>skip</i> it.";
    c.bench_function("format/tokenize", |b| {
        b.iter(|| tokenize(black_box(rich)));
    });
}

criterion_group!(
    benches,
    bench_negotiate,
    bench_decide,
    bench_store,
    bench_format
);
criterion_main!(benches);
