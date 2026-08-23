//! Message storage and `namespace` / `scope` / `key` resolution.
//!
//! A namespace file is parsed once and flattened into a dotted index. The index
//! is bounded by the file itself — unlike a per-lookup cache, it cannot grow
//! without limit while the server process lives.
//!
//! Requires the `full` feature; the Edge middleware never resolves messages.

use crate::error::{ErrorCode, I18nError, I18nResult};
use serde_json::Value;
use std::collections::{HashMap, HashSet};

/// A terminal value in a namespace.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Leaf {
	/// A single message.
	Text(String),
	/// A list of messages, for `t.array`.
	List(Vec<String>),
}

/// What shape a key holds, without its value.
///
/// Requires the `cli` feature.
///
/// The CLI needs this to generate types and to compare locales: a key that is a
/// string in one locale and a list in another is a mismatch worth reporting,
/// and comparing key names alone would miss it.
#[cfg(feature = "cli")]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LeafKind {
	/// A single message, reachable through `t`.
	Text,
	/// A list of messages, reachable through `t.array`.
	List,
}

/// One entry of a namespace: its dotted key and the shape it holds.
///
/// Requires the `cli` feature.
#[cfg(feature = "cli")]
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct Entry<'a> {
	/// Dotted path from the root of the namespace.
	pub key: &'a str,
	/// The shape the key holds.
	pub kind: LeafKind,
}

/// The value a lookup produced.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Resolved<'a> {
	/// A single message.
	Text(&'a str),
	/// A list of messages.
	List(&'a [String]),
}

/// One namespace file, parsed and flattened.
#[derive(Debug, Clone)]
pub struct MessageStore {
	locale: String,
	namespace: String,
	leaves: HashMap<String, Leaf>,
	containers: HashSet<String>,
}

impl MessageStore {
	/// Parse and flatten a namespace file.
	///
	/// Returns [`ErrorCode::InvalidJson`] with the parser's own message attached,
	/// so the developer sees the line and column rather than a generic failure.
	pub fn from_json(
		locale: impl Into<String>,
		namespace: impl Into<String>,
		raw: &str,
	) -> I18nResult<Self> {
		let locale = locale.into();
		let namespace = namespace.into();

		let root: Value = serde_json::from_str(raw).map_err(|error| {
			I18nError::new(ErrorCode::InvalidJson, &locale, &namespace)
				.with_detail(error.to_string())
				.boxed()
		})?;

		let mut store = Self {
			locale,
			namespace,
			leaves: HashMap::new(),
			containers: HashSet::new(),
		};
		store.flatten(String::new(), &root);
		Ok(store)
	}

	/// Build a store directly from an already-parsed value.
	pub fn from_value(
		locale: impl Into<String>,
		namespace: impl Into<String>,
		root: &Value,
	) -> Self {
		let mut store = Self {
			locale: locale.into(),
			namespace: namespace.into(),
			leaves: HashMap::new(),
			containers: HashSet::new(),
		};
		store.flatten(String::new(), root);
		store
	}

	/// Locale this store was loaded for.
	pub fn locale(&self) -> &str {
		&self.locale
	}

	/// Namespace this store was loaded for.
	pub fn namespace(&self) -> &str {
		&self.namespace
	}

	/// Number of terminal entries; used by tests and the CLI's key diff.
	pub fn len(&self) -> usize {
		self.leaves.len()
	}

	/// Whether the namespace produced no usable messages.
	pub fn is_empty(&self) -> bool {
		self.leaves.is_empty()
	}

	/// Every dotted key in the namespace, unordered. Used by the CLI to diff
	/// locales against each other and to generate types.
	pub fn keys(&self) -> impl Iterator<Item = &str> {
		self.leaves.keys().map(String::as_str)
	}

	/// Every key with the shape it holds, sorted by key.
	///
	/// Sorted because the CLI writes these into generated files: unordered
	/// output would produce a different file on every run and churn diffs.
	#[cfg(feature = "cli")]
	pub fn entries(&self) -> Vec<Entry<'_>> {
		let mut entries: Vec<Entry<'_>> = self
			.leaves
			.iter()
			.map(|(key, leaf)| Entry {
				key: key.as_str(),
				kind: match leaf {
					Leaf::Text(_) => LeafKind::Text,
					Leaf::List(_) => LeafKind::List,
				},
			})
			.collect();
		entries.sort_unstable_by(|a, b| a.key.cmp(b.key));
		entries
	}

	/// Every scope in the namespace — the object paths a caller may pass as the
	/// second argument to `useTranslation` — sorted, with the root included as
	/// an empty string.
	#[cfg(feature = "cli")]
	pub fn scopes(&self) -> Vec<&str> {
		let mut scopes: Vec<&str> = std::iter::once("")
			.chain(self.containers.iter().map(String::as_str))
			.collect();
		scopes.sort_unstable();
		scopes
	}

	fn flatten(&mut self, prefix: String, value: &Value) {
		match value {
			Value::Object(map) => {
				if !prefix.is_empty() {
					self.containers.insert(prefix.clone());
				}
				for (key, child) in map {
					self.flatten(child_path(&prefix, key), child);
				}
			}
			Value::Array(items) => {
				if !prefix.is_empty() {
					self.containers.insert(prefix.clone());
				}

				let all_strings: Option<Vec<String>> = items
					.iter()
					.map(|item| item.as_str().map(str::to_owned))
					.collect();
				if let Some(list) = all_strings {
					if !prefix.is_empty() {
						self.leaves.insert(prefix.clone(), Leaf::List(list));
					}
				}

				for (index, item) in items.iter().enumerate() {
					self.flatten(child_path(&prefix, &index.to_string()), item);
				}
			}
			Value::String(text) => {
				if !prefix.is_empty() {
					self.leaves.insert(prefix, Leaf::Text(text.clone()));
				}
			}
			Value::Number(number) => {
				if !prefix.is_empty() {
					self.leaves.insert(prefix, Leaf::Text(number.to_string()));
				}
			}
			Value::Bool(flag) => {
				if !prefix.is_empty() {
					self.leaves.insert(prefix, Leaf::Text(flag.to_string()));
				}
			}
			// `null` is treated as absent, so an unfinished translation reports
			// KEY_NOT_FOUND rather than rendering "null".
			Value::Null => {}
		}
	}

	fn error(&self, code: ErrorCode, scope: Option<&str>, key: &str) -> Box<I18nError> {
		I18nError::new(code, &self.locale, &self.namespace)
			.with_scope(scope)
			.with_key(key)
			.boxed()
	}

	fn error_with(
		&self,
		code: ErrorCode,
		scope: Option<&str>,
		key: &str,
		detail: &str,
	) -> Box<I18nError> {
		I18nError::new(code, &self.locale, &self.namespace)
			.with_scope(scope)
			.with_key(key)
			.with_detail(detail)
			.boxed()
	}

	/// Resolve `scope` + `key` to a terminal value.
	///
	/// The three failure modes are kept distinct on purpose: a missing scope,
	/// a missing key inside a present scope, and a key that resolves to a
	/// container are different authoring mistakes.
	pub fn resolve(&self, scope: Option<&str>, key: &str) -> I18nResult<Resolved<'_>> {
		// The index is keyed by `String`, which borrows as `str`, so an unscoped
		// lookup can hash the caller's key as it stands — no key is built at all.
		//
		// A scoped one has to join the two halves first, and doing that with
		// `format!` allocated on every lookup, costing about four times the
		// lookup itself. It is joined on the stack instead.
		//
		// The join buffer is declared inside this branch rather than above the
		// match on purpose: hoisting it made the unscoped path 21% slower, since
		// it then paid to set up a buffer it never reads.
		match scope.filter(|s| !s.is_empty()) {
			None => self.resolve_path(None, key, key),
			Some(scope) => {
				let mut inline = [0u8; JOIN_BUFFER];
				let mut spilled = String::new();

				self.resolve_path(
					Some(scope),
					key,
					join(scope, key, &mut inline, &mut spilled),
				)
			}
		}
	}

	/// Resolve an already-joined dotted `path`, reporting failures against the
	/// `scope` and `key` the caller actually wrote.
	///
	/// Inlined so that splitting it out of `resolve` costs nothing: without this
	/// the unscoped path measured slower than when the body was written inline.
	#[inline]
	fn resolve_path<'s>(
		&'s self,
		scope: Option<&str>,
		key: &str,
		path: &str,
	) -> I18nResult<Resolved<'s>> {
		if let Some(leaf) = self.leaves.get(path) {
			return Ok(match leaf {
				Leaf::Text(text) => Resolved::Text(text),
				Leaf::List(list) => Resolved::List(list),
			});
		}

		if self.containers.contains(path) {
			return Err(self.error_with(
				ErrorCode::TypeMismatch,
				scope,
				key,
				"resolved to an object, not a message",
			));
		}

		if let Some(scope) = scope {
			if !self.containers.contains(scope) {
				return Err(self.error(ErrorCode::ScopeNotFound, Some(scope), key));
			}
		}

		Err(self.error(ErrorCode::KeyNotFound, scope, key))
	}

	/// Resolve a key that must be a single message.
	pub fn resolve_text(&self, scope: Option<&str>, key: &str) -> I18nResult<&str> {
		match self.resolve(scope, key)? {
			Resolved::Text(text) => Ok(text),
			Resolved::List(_) => Err(self.error_with(
				ErrorCode::TypeMismatch,
				scope,
				key,
				"expected a string but found an array; use t.array()",
			)),
		}
	}

	/// Resolve a key that must be a list of messages.
	pub fn resolve_list(&self, scope: Option<&str>, key: &str) -> I18nResult<&[String]> {
		match self.resolve(scope, key)? {
			Resolved::List(list) => Ok(list),
			Resolved::Text(_) => Err(self.error_with(
				ErrorCode::TypeMismatch,
				scope,
				key,
				"expected an array but found a string; use t()",
			)),
		}
	}

	/// Whether a key exists and is a message or list.
	pub fn has(&self, scope: Option<&str>, key: &str) -> bool {
		self.resolve(scope, key).is_ok()
	}
}

/// How much of a joined `scope.key` is built without touching the heap.
///
/// Sized to cover realistic keys rather than to be safe against every input:
/// anything longer spills to a `String` instead of being truncated, so the
/// number is a performance choice, never a correctness one.
const JOIN_BUFFER: usize = 192;

/// Join `scope` and `key` into `scope.key`, on the stack where it fits.
///
/// The result borrows from whichever buffer was used, so both outlive the call.
fn join<'a>(
	scope: &str,
	key: &str,
	inline: &'a mut [u8; JOIN_BUFFER],
	spilled: &'a mut String,
) -> &'a str {
	let needed = scope.len() + 1 + key.len();

	if needed <= inline.len() {
		inline[..scope.len()].copy_from_slice(scope.as_bytes());
		inline[scope.len()] = b'.';
		inline[scope.len() + 1..needed].copy_from_slice(key.as_bytes());

		// Two `&str` joined by an ASCII byte cannot be anything but valid UTF-8.
		// The heap path below is what answers the impossible case, so a bug here
		// would cost an allocation rather than panic in a page render.
		if let Ok(joined) = std::str::from_utf8(&inline[..needed]) {
			return joined;
		}
	}

	spilled.reserve_exact(needed);
	spilled.push_str(scope);
	spilled.push('.');
	spilled.push_str(key);
	spilled.as_str()
}

fn child_path(prefix: &str, key: &str) -> String {
	if prefix.is_empty() {
		key.to_owned()
	} else {
		format!("{prefix}.{key}")
	}
}
