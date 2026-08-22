//! WebAssembly bindings for [`i18n_fs_core`].
//!
//! Three binaries are produced from this one crate:
//!
//! | build   | wasm-pack target | features           | consumer                     |
//! |---------|------------------|--------------------|------------------------------|
//! | `edge`  | `bundler`        | `--no-default`     | Next.js middleware (Edge)    |
//! | `browser` | `web`          | `full`             | client components            |
//! | `node`  | `nodejs`         | `full`             | server components, CLI       |
//!
//! The `edge` build omits message storage and formatting entirely, so the
//! middleware bundle carries locale negotiation and route canonicalisation and
//! nothing else.
//!
//! JSX never crosses this boundary. `tokenize` returns a plain node tree and the
//! React layer builds elements from it.

use i18n_fs_core::config::I18nConfig;
use i18n_fs_core::routing::RequestInfo;
use wasm_bindgen::prelude::*;

/// Version of the compiled core. The JS loader asserts this matches the package
/// version, so a stale `pkg/` directory fails loudly instead of subtly.
#[wasm_bindgen(js_name = coreVersion)]
pub fn core_version() -> String {
	i18n_fs_core::VERSION.to_owned()
}

fn to_js_error(error: impl core::fmt::Display) -> JsValue {
	JsValue::from_str(&error.to_string())
}

fn parse_config(config: JsValue) -> Result<I18nConfig, JsValue> {
	serde_wasm_bindgen::from_value(config).map_err(to_js_error)
}

fn to_js<T: serde::Serialize>(value: &T) -> Result<JsValue, JsValue> {
	serde_wasm_bindgen::to_value(value).map_err(to_js_error)
}

/// Validate a configuration snapshot. Returns an array of issues; an empty array
/// means the configuration is usable.
///
/// Present only in the builds that need it. Validation happens at build time in
/// the CLI, so the Edge binary does not carry it.
#[cfg(feature = "diagnostics")]
#[wasm_bindgen(js_name = validateConfig)]
pub fn validate_config(config: JsValue) -> Result<JsValue, JsValue> {
	let config = parse_config(config)?;
	to_js(&config.validate())
}

/// Pick the best supported locale for an `Accept-Language` header.
#[wasm_bindgen(js_name = negotiateLocale)]
pub fn negotiate_locale(
	config: JsValue,
	accept_language: Option<String>,
) -> Result<String, JsValue> {
	let config = parse_config(config)?;
	let header = accept_language.unwrap_or_default();
	Ok(i18n_fs_core::negotiate(&header, &config.locales, &config.default_locale).locale)
}

/// Decide what the middleware should do with a request.
#[wasm_bindgen(js_name = decideRoute)]
pub fn decide_route(config: JsValue, request: JsValue) -> Result<JsValue, JsValue> {
	let config = parse_config(config)?;
	let request: RequestInfo = serde_wasm_bindgen::from_value(request).map_err(to_js_error)?;
	to_js(&i18n_fs_core::decide(&config, &request))
}

/// The canonical public path for a pathname under a locale.
///
/// Exposed on its own because the navigation wrappers (`Link`, `useRouter`)
/// need it without constructing a full request.
/// `host` matters only for the domain strategy, where it decides which locale
/// goes unprefixed.
#[wasm_bindgen(js_name = canonicalPath)]
pub fn canonical_path(
	config: JsValue,
	pathname: &str,
	locale: &str,
	host: Option<String>,
) -> Result<String, JsValue> {
	let config = parse_config(config)?;
	let base = i18n_fs_core::routing::base_locale(&config, host.as_deref()).to_owned();
	Ok(i18n_fs_core::canonical_public_path(
		&config, pathname, locale, &base,
	))
}

/// The hostname that serves `locale`, or `undefined` when the domain strategy is
/// not in use. The locale switcher needs this to build a cross-domain URL.
#[wasm_bindgen(js_name = domainForLocale)]
pub fn domain_for_locale(config: JsValue, locale: &str) -> Result<Option<String>, JsValue> {
	let config = parse_config(config)?;
	Ok(i18n_fs_core::routing::domain_for_locale(&config, locale).map(str::to_owned))
}

/// The internal, always locale-prefixed path Next.js should route to.
#[wasm_bindgen(js_name = internalPath)]
pub fn internal_path(config: JsValue, pathname: &str, locale: &str) -> Result<String, JsValue> {
	let config = parse_config(config)?;
	Ok(i18n_fs_core::routing::internal_path(
		&config, pathname, locale,
	))
}

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
