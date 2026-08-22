//! Pure logic core for `i18n-fs`.
//!
//! Everything here is a deterministic function of its inputs: no I/O, no clock,
//! no globals. That is what lets the same code back the Edge middleware, the
//! Node server runtime, the browser bundle and the build-time CLI.
//!
//! # Features
//!
//! - `minimal` (no default features) — [`config`], [`locale`], [`routing`],
//!   [`error`]. This is what the Edge middleware bundle compiles, and it is why
//!   `serde_json` is an optional dependency.
//! - `full` (default) — adds [`store`] and [`format`].
//!
//! # Fallback policy
//!
//! Resolution failures are uniform in behaviour and distinct in diagnosis. The
//! core never substitutes another locale's content; it returns a typed
//! [`error::I18nError`] and leaves the choice of fallback string to the caller.

#![cfg_attr(docsrs, feature(doc_cfg))]

pub mod config;
pub mod error;
pub mod locale;
pub mod routing;

#[cfg(feature = "full")]
pub mod format;
#[cfg(feature = "full")]
pub mod store;

#[cfg(feature = "diagnostics")]
pub use config::ConfigIssue;
pub use config::{DomainRule, I18nConfig, PrefixMode, Strategy};
pub use error::{ErrorCode, I18nError, I18nResult};
pub use locale::{negotiate, LanguageTag, MatchKind, Negotiated};
pub use routing::{canonical_public_path, decide, Action, Decision, LocaleSource, RequestInfo};

#[cfg(feature = "full")]
pub use format::{flatten, interpolate, tokenize, Interpolation, Node};
#[cfg(all(feature = "full", feature = "cli"))]
pub use store::{Entry, LeafKind};
#[cfg(feature = "full")]
pub use store::{Leaf, MessageStore, Resolved};

/// Version of the core, surfaced through WASM so the JS layer can assert that
/// the loaded binary matches the package it shipped with.
pub const VERSION: &str = env!("CARGO_PKG_VERSION");
