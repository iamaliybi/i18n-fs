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
pub use format::{
	flatten, flatten_with, interpolate, interpolate_with, tokenize, Arm, Interpolation, Node,
	PluralArg,
};
/// The JSON value type used by [`store::MessageStore::from_value`].
///
/// Re-exported because it appears in that public signature: without it, callers
/// outside this crate cannot name the type they are required to pass.
#[cfg(feature = "full")]
pub use serde_json::Value as JsonValue;
#[cfg(all(feature = "full", feature = "cli"))]
pub use store::{Entry, LeafKind};
#[cfg(feature = "full")]
pub use store::{Leaf, MessageStore, Resolved};

/// Version of this crate.
///
/// Not the version of the npm package — the crates in this workspace are never
/// published to crates.io and stay at `0.0.0`. What the JavaScript layer checks
/// against is stamped into the WASM crate at build time instead; see
/// `i18n-fs-wasm`.
pub const CRATE_VERSION: &str = env!("CARGO_PKG_VERSION");
