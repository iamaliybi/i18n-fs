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
		let path = match scope.filter(|s| !s.is_empty()) {
			Some(scope) => child_path(scope, key),
			None => key.to_owned(),
		};

		if let Some(leaf) = self.leaves.get(&path) {
			return Ok(match leaf {
				Leaf::Text(text) => Resolved::Text(text),
				Leaf::List(list) => Resolved::List(list),
			});
		}

		if self.containers.contains(&path) {
			return Err(self.error_with(
				ErrorCode::TypeMismatch,
				scope,
				key,
				"resolved to an object, not a message",
			));
		}

		if let Some(scope) = scope.filter(|s| !s.is_empty()) {
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

fn child_path(prefix: &str, key: &str) -> String {
	if prefix.is_empty() {
		key.to_owned()
	} else {
		format!("{prefix}.{key}")
	}
}
