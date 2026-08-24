//! WebAssembly bindings for [`i18n_fs_core`].
//!
//! Three binaries are produced from this one crate:
//!
//! | build     | features           | carries                    | consumer                  |
//! |-----------|--------------------|----------------------------|---------------------------|
//! | `edge`    | `routing`          | routing only               | Next.js proxy (Edge)      |
//! | `browser` | `full`             | messages only              | Client Components         |
//! | `node`    | `full,cli,routing` | both, plus introspection   | Server Components, CLI    |
//!
//! The two halves are separate features because each consumer needs exactly one
//! of them, and only Node needs both. The browser binary is the one a visitor
//! downloads, and it never routes: `<Link>` and `usePathname` are answered by a
//! TypeScript mirror of the same rules so they can stay synchronous, and every
//! redirect decision is made by the proxy before the page is served. Compiling
//! routing into it cost 34 KB gzip that no browser ever executed.
//!
//! JSX never crosses this boundary. `tokenize` returns a plain node tree and the
//! React layer builds elements from it.

#[cfg(all(feature = "diagnostics", feature = "routing"))]
use i18n_fs_core::config::I18nConfig;
use wasm_bindgen::prelude::*;

/// Version of the npm package this binary was built for.
///
/// Stamped in by `scripts/build-wasm.mjs`, which reads it from the package's
/// own `package.json`. It falls back to the crate version only when the crate
/// is built outside that script — which means a plain `cargo build`, never a
/// published artefact.
///
/// The JavaScript loader compares this against the version compiled into the
/// JavaScript, so a `wasm/` directory left over from an earlier version fails
/// on load rather than resolving messages with mismatched logic.
#[wasm_bindgen(js_name = coreVersion)]
pub fn core_version() -> String {
	option_env!("I18N_FS_VERSION")
		.unwrap_or(i18n_fs_core::CRATE_VERSION)
		.to_owned()
}

/// Present only where something crosses the boundary as serialised data. The
/// Edge build does neither, and gating rather than allowing dead code is what
/// makes that visible when it changes.
#[cfg(any(all(feature = "diagnostics", feature = "routing"), feature = "full"))]
fn to_js_error(error: impl core::fmt::Display) -> JsValue {
	JsValue::from_str(&error.to_string())
}

/// Deserialising a config snapshot is what pulls in most of the serde bridge,
/// which is why it is gated with the routing surface that needs it.
#[cfg(all(feature = "diagnostics", feature = "routing"))]
fn parse_config(config: JsValue) -> Result<I18nConfig, JsValue> {
	serde_wasm_bindgen::from_value(config).map_err(to_js_error)
}

#[cfg(any(all(feature = "diagnostics", feature = "routing"), feature = "full"))]
fn to_js<T: serde::Serialize>(value: &T) -> Result<JsValue, JsValue> {
	serde_wasm_bindgen::to_value(value).map_err(to_js_error)
}

/// Validate a configuration snapshot. Returns an array of issues; an empty array
/// means the configuration is usable.
///
/// Present only in the builds that need it. Validation happens at build time in
/// the CLI, so the Edge binary does not carry it.
#[cfg(feature = "diagnostics")]
#[cfg(feature = "routing")]
#[wasm_bindgen(js_name = validateConfig)]
pub fn validate_config(config: JsValue) -> Result<JsValue, JsValue> {
	let config = parse_config(config)?;
	to_js(&config.validate())
}

/// The canonical public path for a pathname under a locale.
///
/// Routing across the WebAssembly boundary, without serde.
///
/// The configuration used to cross as a serialised object on every call, which
/// meant `serde-wasm-bindgen` in every binary that routes — about half the Edge
/// build, for a value that never changes while the process lives. The proxy
/// runs on every request, so that is the one place where those bytes are worst
/// spent.
///
/// A `Router` is built once from primitives and answers questions afterwards.
/// `Vec<String>`, `&str` and `bool` cross natively, so nothing is serialised.
#[cfg(feature = "routing")]
mod router {
	use i18n_fs_core::config::{CookieConfig, DomainRule, I18nConfig, PrefixMode, Strategy};
	use i18n_fs_core::routing::RequestInfo;
	use wasm_bindgen::prelude::*;

	/// What the proxy should do with one request.
	///
	/// A class with getters rather than a serialised object, for the same reason
	/// the config is: crossing it as data would put the serialiser back.
	#[wasm_bindgen]
	pub struct Decision {
		locale: String,
		/// `"next"`, `"rewrite"` or `"redirect"`.
		action: String,
		/// The rewrite or redirect target; empty for `next`.
		path: String,
		permanent: bool,
		set_cookie: bool,
		source: String,
	}

	#[wasm_bindgen]
	impl Decision {
		/// The locale that is active for this request.
		#[wasm_bindgen(getter)]
		pub fn locale(&self) -> String {
			self.locale.clone()
		}

		/// `"next"`, `"rewrite"` or `"redirect"`.
		#[wasm_bindgen(getter)]
		pub fn action(&self) -> String {
			self.action.clone()
		}

		/// Where to rewrite or redirect to. Empty when the action is `next`.
		#[wasm_bindgen(getter)]
		pub fn path(&self) -> String {
			self.path.clone()
		}

		/// `true` for a 308, `false` for a 307. Only meaningful for a redirect.
		#[wasm_bindgen(getter)]
		pub fn permanent(&self) -> bool {
			self.permanent
		}

		/// Whether the locale cookie should be written on the response.
		#[wasm_bindgen(getter, js_name = setCookie)]
		pub fn set_cookie(&self) -> bool {
			self.set_cookie
		}

		/// How the locale was determined, for debugging.
		#[wasm_bindgen(getter)]
		pub fn source(&self) -> String {
			self.source.clone()
		}
	}

	/// A compiled configuration, ready to answer routing questions.
	#[wasm_bindgen]
	pub struct Router {
		config: I18nConfig,
	}

	#[wasm_bindgen]
	impl Router {
		/// Build from the resolved configuration snapshot.
		///
		/// Unknown `strategy` or `prefix` values fall back to the defaults rather
		/// than failing: the CLI validates the snapshot at build time, and a
		/// proxy that refuses to start is a worse failure than one that routes by
		/// the default rules.
		#[wasm_bindgen(constructor)]
		#[allow(clippy::too_many_arguments)]
		pub fn new(
			locales: Vec<String>,
			default_locale: String,
			strategy: &str,
			prefix: &str,
			messages_dir: String,
			cookie_name: String,
			cookie_max_age: f64,
			cookie_same_site: String,
			cookie_path: String,
			cookie_secure: bool,
			debug: bool,
		) -> Router {
			Router {
				config: I18nConfig {
					locales,
					default_locale,
					strategy: match strategy {
						"domain" => Strategy::Domain,
						"cookie" => Strategy::Cookie,
						_ => Strategy::Path,
					},
					prefix: match prefix {
						"always" => PrefixMode::Always,
						"never" => PrefixMode::Never,
						_ => PrefixMode::AsNeeded,
					},
					domains: Vec::new(),
					cookie: CookieConfig {
						name: cookie_name,
						max_age: cookie_max_age as u64,
						same_site: cookie_same_site,
						path: cookie_path,
						secure: cookie_secure,
					},
					messages_dir,
					debug,
				},
			}
		}

		/// Bind a hostname to a locale, optionally with extra prefixed locales.
		///
		/// Separate from the constructor because a domain rule is itself a
		/// structure, and passing a list of them is what would need a serialiser.
		#[wasm_bindgen(js_name = addDomain)]
		pub fn add_domain(&mut self, domain: String, locale: String, locales: Vec<String>) {
			self.config.domains.push(DomainRule {
				domain,
				locale,
				locales,
			});
		}

		/// Pick the best supported locale for an `Accept-Language` header.
		#[wasm_bindgen(js_name = negotiateLocale)]
		pub fn negotiate_locale(&self, accept_language: Option<String>) -> String {
			let header = accept_language.unwrap_or_default();
			i18n_fs_core::negotiate(&header, &self.config.locales, &self.config.default_locale)
				.locale
		}

		/// Decide what the proxy should do with a request.
		#[wasm_bindgen(js_name = decideRoute)]
		pub fn decide_route(
			&self,
			pathname: String,
			host: Option<String>,
			cookie_locale: Option<String>,
			accept_language: Option<String>,
			already_resolved: bool,
		) -> Decision {
			let request = RequestInfo {
				pathname,
				host,
				cookie_locale,
				accept_language,
				already_resolved,
			};

			let decided = i18n_fs_core::decide(&self.config, &request);

			let (action, path, permanent) = match decided.action {
				i18n_fs_core::routing::Action::Next => ("next", String::new(), false),
				i18n_fs_core::routing::Action::Rewrite { path } => ("rewrite", path, false),
				i18n_fs_core::routing::Action::Redirect { path, permanent } => {
					("redirect", path, permanent)
				}
			};

			Decision {
				locale: decided.locale,
				action: action.to_owned(),
				path,
				permanent,
				set_cookie: decided.set_cookie,
				source: match decided.source {
					i18n_fs_core::routing::LocaleSource::Path => "path",
					i18n_fs_core::routing::LocaleSource::Domain => "domain",
					i18n_fs_core::routing::LocaleSource::Cookie => "cookie",
					i18n_fs_core::routing::LocaleSource::Header => "header",
					i18n_fs_core::routing::LocaleSource::Default => "default",
				}
				.to_owned(),
			}
		}

		/// The canonical public path for a pathname under a locale.
		#[wasm_bindgen(js_name = canonicalPath)]
		pub fn canonical_path(&self, pathname: &str, locale: &str, host: Option<String>) -> String {
			let base = i18n_fs_core::routing::base_locale(&self.config, host.as_deref()).to_owned();
			i18n_fs_core::canonical_public_path(&self.config, pathname, locale, &base)
		}

		/// The internal, always locale-prefixed path Next.js should route to.
		#[wasm_bindgen(js_name = internalPath)]
		pub fn internal_path(&self, pathname: &str, locale: &str) -> String {
			i18n_fs_core::routing::internal_path(&self.config, pathname, locale)
		}

		/// The hostname that serves `locale`, if the domain strategy is in use.
		#[wasm_bindgen(js_name = domainForLocale)]
		pub fn domain_for_locale(&self, locale: &str) -> Option<String> {
			i18n_fs_core::routing::domain_for_locale(&self.config, locale).map(str::to_owned)
		}
	}
}

#[cfg(feature = "routing")]
pub use router::{Decision, Router};

#[cfg(feature = "full")]
mod messages {
	use super::{to_js, to_js_error};
	use i18n_fs_core::store::{MessageStore, Resolved};
	use std::collections::BTreeMap;
	use wasm_bindgen::prelude::*;

	/// One parsed namespace file.
	///
	/// Construction parses and flattens the file once; every later lookup is a
	/// hash lookup. Drop the handle to free the index.
	#[wasm_bindgen]
	pub struct Store {
		inner: MessageStore,
	}

	#[wasm_bindgen]
	impl Store {
		/// Parse a namespace file. Rejects with a serialised `I18nError` whose
		/// `code` is `INVALID_JSON` when the file does not parse.
		#[wasm_bindgen(constructor)]
		pub fn new(locale: &str, namespace: &str, raw: &str) -> Result<Store, JsValue> {
			match MessageStore::from_json(locale, namespace, raw) {
				Ok(inner) => Ok(Store { inner }),
				Err(error) => Err(to_js(&error).unwrap_or_else(|value| value)),
			}
		}

		/// Number of terminal entries in the namespace.
		#[wasm_bindgen(getter)]
		pub fn size(&self) -> usize {
			self.inner.len()
		}

		/// Every dotted key in the namespace.
		pub fn keys(&self) -> Vec<String> {
			self.inner.keys().map(str::to_owned).collect()
		}

		/// Every key with the shape it holds, sorted by key.
		///
		/// The CLI writes these into generated files, so the order is stable:
		/// unordered output would churn the diff on every run.
		#[cfg(feature = "cli")]
		pub fn entries(&self) -> Result<JsValue, JsValue> {
			to_js(&self.inner.entries())
		}

		/// Every scope in the namespace, sorted, with the root as an empty
		/// string. These are the values that may be passed as the second
		/// argument to `useTranslation`.
		#[cfg(feature = "cli")]
		pub fn scopes(&self) -> Vec<String> {
			self.inner.scopes().into_iter().map(str::to_owned).collect()
		}

		/// Whether a key resolves to a message or a list.
		pub fn has(&self, scope: Option<String>, key: &str) -> bool {
			self.inner.has(scope.as_deref(), key)
		}

		/// Resolve a key that must be a single message.
		#[wasm_bindgen(js_name = resolveText)]
		pub fn resolve_text(&self, scope: Option<String>, key: &str) -> Result<String, JsValue> {
			self.inner
				.resolve_text(scope.as_deref(), key)
				.map(str::to_owned)
				.map_err(|error| to_js(&error).unwrap_or_else(|value| value))
		}

		/// Resolve a key that must be a list of messages.
		#[wasm_bindgen(js_name = resolveList)]
		pub fn resolve_list(
			&self,
			scope: Option<String>,
			key: &str,
		) -> Result<Vec<String>, JsValue> {
			self.inner
				.resolve_list(scope.as_deref(), key)
				.map(<[String]>::to_vec)
				.map_err(|error| to_js(&error).unwrap_or_else(|value| value))
		}

		/// Resolve a key and report which shape it holds, without failing on a
		/// type mismatch. Used by `t.raw`.
		#[wasm_bindgen(js_name = resolveAny)]
		pub fn resolve_any(&self, scope: Option<String>, key: &str) -> Result<JsValue, JsValue> {
			match self.inner.resolve(scope.as_deref(), key) {
				Ok(Resolved::Text(text)) => JsValue::from_str(text).into_js_ok(),
				Ok(Resolved::List(list)) => to_js(&list.to_vec()),
				Err(error) => Err(to_js(&error).unwrap_or_else(|value| value)),
			}
		}
	}

	trait IntoJsOk {
		fn into_js_ok(self) -> Result<JsValue, JsValue>;
	}

	impl IntoJsOk for JsValue {
		fn into_js_ok(self) -> Result<JsValue, JsValue> {
			Ok(self)
		}
	}

	/// Substitute `{placeholder}` values in a plain message.
	///
	/// Returns `{ value, missing }`. Missing placeholders are left visible in
	/// `value` and listed in `missing` so the caller can report `PARAM_MISSING`.
	#[wasm_bindgen(js_name = interpolate)]
	pub fn interpolate(template: &str, params: JsValue) -> Result<JsValue, JsValue> {
		let params: BTreeMap<String, String> = if params.is_undefined() || params.is_null() {
			BTreeMap::new()
		} else {
			serde_wasm_bindgen::from_value(params).map_err(to_js_error)?
		};

		let result = i18n_fs_core::interpolate(template, &params);
		let output = InterpolationResult {
			value: result.value,
			missing: result.missing,
		};
		to_js(&output)
	}

	#[derive(serde::Serialize)]
	#[serde(rename_all = "camelCase")]
	struct InterpolationResult {
		value: String,
		missing: Vec<String>,
	}

	/// Parse a rich message into a node tree for the React layer to render.
	#[wasm_bindgen(js_name = tokenize)]
	pub fn tokenize(template: &str) -> Result<JsValue, JsValue> {
		to_js(&i18n_fs_core::tokenize(template))
	}
}

#[cfg(feature = "full")]
pub use messages::*;
