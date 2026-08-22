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
/// These strings are part of the public contract: the JavaScript layer switches
/// on them and they appear in developer-facing diagnostics.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ErrorCode {
    /// The namespace file could not be loaded (missing file, 404, unreadable).
    NamespaceNotFound,
    /// The namespace file was loaded but is not valid JSON.
    InvalidJson,
    /// The namespace loaded and parsed, but the requested scope object is absent.
    ScopeNotFound,
    /// Scope resolved, but the key does not exist inside it.
    KeyNotFound,
    /// The key exists but holds the wrong shape (e.g. an object where a string
    /// was requested, or a string where `t.array` expected a list).
    TypeMismatch,
    /// A `{placeholder}` in the message had no matching entry in `params`.
    ParamMissing,
    /// The `i18n-fs.config.ts` snapshot is not internally consistent.
    InvalidConfig,
}

impl ErrorCode {
    /// Stable `SCREAMING_SNAKE_CASE` identifier for this code.
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
        f.write_str(self.as_str())
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
        write!(f, "[i18n-fs] {}: ", self.code.as_str())?;

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
