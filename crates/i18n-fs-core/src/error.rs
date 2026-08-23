//! Error taxonomy shared by every layer of `i18n-fs`.
//!
//! The fallback *behaviour* is uniform (developer-supplied string, otherwise the
//! key itself). The diagnostic *reason* is not: every failure carries a distinct
//! [`ErrorCode`] so `console.error` can tell a missing file from malformed JSON
//! from a missing key.

use core::fmt;

/// Result alias for fallible core operations.
///
/// The error is boxed on purpose: [`I18nError`] carries enough context to be
/// actionable, which makes it large, and the success path of a lookup is hot.
/// Boxing keeps `Result` pointer-sized.
pub type I18nResult<T> = Result<T, Box<I18nError>>;

/// Machine-readable reason a lookup failed.
///
/// Crosses the boundary as a **number**, so callers can compare against the
/// `ErrorCode` constants the package exports rather than against a string they
/// have to spell correctly.
///
/// The numbers are grouped, which makes a whole class of problem testable with
/// one comparison:
///
/// | range | meaning                                          |
/// |-------|--------------------------------------------------|
/// | `1xx` | the namespace could not be used at all            |
/// | `2xx` | the namespace is fine; the lookup inside it is not |
/// | `3xx` | the message resolved; formatting it went wrong     |
/// | `4xx` | the configuration is wrong                         |
///
/// The values are a public contract. Add new ones; never renumber an existing
/// one.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
#[repr(u16)]
pub enum ErrorCode {
	/// The namespace file could not be loaded (missing file, 404, unreadable).
	NamespaceNotFound = 100,
	/// The namespace file was loaded but is not valid JSON.
	InvalidJson = 101,
	/// The namespace loaded and parsed, but the requested scope object is absent.
	ScopeNotFound = 200,
	/// Scope resolved, but the key does not exist inside it.
	KeyNotFound = 201,
	/// The key exists but holds the wrong shape (e.g. an object where a string
	/// was requested, or a string where `t.array` expected a list).
	TypeMismatch = 202,
	/// A `{placeholder}` in the message had no matching entry in `params`.
	ParamMissing = 300,
	/// The `i18n-fs.config.ts` snapshot is not internally consistent.
	InvalidConfig = 400,
}

impl ErrorCode {
	/// Every code, in numeric order. Used by the JavaScript layer's tests to
	/// prove the two halves list exactly the same set.
	pub const ALL: [Self; 7] = [
		Self::NamespaceNotFound,
		Self::InvalidJson,
		Self::ScopeNotFound,
		Self::KeyNotFound,
		Self::TypeMismatch,
		Self::ParamMissing,
		Self::InvalidConfig,
	];

	/// The numeric value that crosses the boundary.
	pub const fn as_u16(self) -> u16 {
		self as u16
	}

	/// The code for a number, or `None` if it is not one of ours.
	pub const fn from_u16(value: u16) -> Option<Self> {
		match value {
			100 => Some(Self::NamespaceNotFound),
			101 => Some(Self::InvalidJson),
			200 => Some(Self::ScopeNotFound),
			201 => Some(Self::KeyNotFound),
			202 => Some(Self::TypeMismatch),
			300 => Some(Self::ParamMissing),
			400 => Some(Self::InvalidConfig),
			_ => None,
		}
	}

	/// Stable `SCREAMING_SNAKE_CASE` identifier for this code.
	///
	/// Not what crosses the boundary — that is the number — but what appears in
	/// diagnostics, because `KEY_NOT_FOUND` in a console tells you more at a
	/// glance than `201` does.
	pub const fn as_str(self) -> &'static str {
		match self {
			Self::NamespaceNotFound => "NAMESPACE_NOT_FOUND",
			Self::InvalidJson => "INVALID_JSON",
			Self::ScopeNotFound => "SCOPE_NOT_FOUND",
			Self::KeyNotFound => "KEY_NOT_FOUND",
			Self::TypeMismatch => "TYPE_MISMATCH",
			Self::ParamMissing => "PARAM_MISSING",
			Self::InvalidConfig => "INVALID_CONFIG",
		}
	}

	/// Whether the condition is caused by the developer's content (`true`) or by
	/// a caller mistake at the call site (`false`). Used only to pick wording.
	pub const fn is_content_issue(self) -> bool {
		matches!(
			self,
			Self::NamespaceNotFound | Self::InvalidJson | Self::ScopeNotFound | Self::KeyNotFound
		)
	}
}

impl fmt::Display for ErrorCode {
	fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
		// Name and number together: the name is what a human reads, the number
		// is what they will find in the documentation table.
		write!(f, "{} ({})", self.as_str(), self.as_u16())
	}
}

impl From<ErrorCode> for u16 {
	fn from(code: ErrorCode) -> Self {
		code.as_u16()
	}
}

// Hand-written rather than derived, so the wire form is a bare number instead of
// a string or a tagged object. Deriving would need `serde_repr`, and the Edge
// binary pays for every dependency it links.
impl serde::Serialize for ErrorCode {
	fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
		serializer.serialize_u16(self.as_u16())
	}
}

impl<'de> serde::Deserialize<'de> for ErrorCode {
	fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
		let value = u16::deserialize(deserializer)?;

		Self::from_u16(value).ok_or_else(|| {
			serde::de::Error::custom(format!("{value} is not a known i18n-fs error code"))
		})
	}
}

/// A fully-qualified description of one failed lookup.
///
/// Carries enough context that a developer can find the offending file and key
/// without re-running anything.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct I18nError {
	/// Why the lookup failed.
	pub code: ErrorCode,
	/// Active locale at the time of the failure.
	pub locale: String,
	/// Namespace (path under the messages directory) that was consulted.
	pub namespace: String,
	/// Scope object inside the namespace, when one was requested.
	pub scope: Option<String>,
	/// Key that was requested, when the failure happened at key level.
	pub key: Option<String>,
	/// Extra detail, such as the serde_json parse message.
	pub detail: Option<String>,
}

impl I18nError {
	/// Start building an error for `code` in `locale` / `namespace`.
	pub fn new(code: ErrorCode, locale: impl Into<String>, namespace: impl Into<String>) -> Self {
		Self {
			code,
			locale: locale.into(),
			namespace: namespace.into(),
			scope: None,
			key: None,
			detail: None,
		}
	}

	/// Attach the scope that was in effect.
	#[must_use]
	pub fn with_scope(mut self, scope: Option<impl Into<String>>) -> Self {
		self.scope = scope.map(Into::into);
		self
	}

	/// Attach the requested key.
	#[must_use]
	pub fn with_key(mut self, key: impl Into<String>) -> Self {
		self.key = Some(key.into());
		self
	}

	/// Attach free-form detail (parser message, expected type, ...).
	#[must_use]
	pub fn with_detail(mut self, detail: impl Into<String>) -> Self {
		self.detail = Some(detail.into());
		self
	}

	/// Move the error to the heap, matching [`I18nResult`].
	#[must_use]
	pub fn boxed(self) -> Box<Self> {
		Box::new(self)
	}

	/// Dotted path of scope + key, used in messages and for log de-duplication.
	pub fn path(&self) -> String {
		match (self.scope.as_deref(), self.key.as_deref()) {
			(Some(scope), Some(key)) => format!("{scope}.{key}"),
			(Some(scope), None) => scope.to_owned(),
			(None, Some(key)) => key.to_owned(),
			(None, None) => String::new(),
		}
	}

	/// Stable identity for this diagnostic, so each distinct problem is logged
	/// once per process instead of once per render.
	pub fn dedupe_key(&self) -> String {
		format!(
			"{}|{}|{}|{}",
			self.code.as_str(),
			self.locale,
			self.namespace,
			self.path()
		)
	}
}

/// Rendering an error for a human requires the `diagnostics` feature. The code
/// and the structured fields are always available; only the prose is optional.
#[cfg(feature = "diagnostics")]
impl fmt::Display for I18nError {
	fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
		write!(f, "[i18n-fs] {}: ", self.code)?;

		match self.code {
			ErrorCode::NamespaceNotFound => write!(
				f,
				"could not load namespace \"{}\" for locale \"{}\".",
				self.namespace, self.locale
			)?,
			ErrorCode::InvalidJson => write!(
				f,
				"namespace \"{}\" for locale \"{}\" is not valid JSON.",
				self.namespace, self.locale
			)?,
			ErrorCode::ScopeNotFound => write!(
				f,
				"scope \"{}\" does not exist in namespace \"{}\" for locale \"{}\".",
				self.scope.as_deref().unwrap_or("<none>"),
				self.namespace,
				self.locale
			)?,
			ErrorCode::KeyNotFound => write!(
				f,
				"key \"{}\" does not exist in namespace \"{}\" for locale \"{}\".",
				self.path(),
				self.namespace,
				self.locale
			)?,
			ErrorCode::TypeMismatch => write!(
				f,
				"key \"{}\" in namespace \"{}\" for locale \"{}\" has an unexpected type.",
				self.path(),
				self.namespace,
				self.locale
			)?,
			ErrorCode::ParamMissing => write!(
				f,
				"message \"{}\" in namespace \"{}\" expects a parameter that was not provided.",
				self.path(),
				self.namespace
			)?,
			ErrorCode::InvalidConfig => f.write_str("the i18n-fs configuration is invalid.")?,
		}

		if let Some(detail) = &self.detail {
			write!(f, " ({detail})")?;
		}

		f.write_str(
			" Falling back to the developer-supplied string, or the key itself. \
                     i18n-fs never falls back to another locale.",
		)
	}
}

#[cfg(feature = "diagnostics")]
impl std::error::Error for I18nError {}
