//! Namespace parsing and `scope` / `key` resolution, including the exact
//! reason each failure mode reports.

#![cfg(feature = "full")]
#![allow(clippy::unwrap_used, clippy::panic)]

#[cfg(feature = "cli")]
use i18n_fs_core::store::LeafKind;
use i18n_fs_core::store::{MessageStore, Resolved};
use i18n_fs_core::ErrorCode;

const SAMPLE: &str = r#"{
    "hero": {
        "title": "Welcome",
        "cta": { "label": "Start now", "hint": "It is free" },
        "bullets": ["Fast", "Small", "Typed"]
    },
    "footer": { "copyright": "© 2026" },
    "count": 42,
    "enabled": true,
    "unfinished": null,
    "mixed": ["text", { "nested": "value" }]
}"#;

fn store() -> MessageStore {
	MessageStore::from_json("fa", "home", SAMPLE).unwrap()
}

#[test]
fn resolves_a_key_inside_a_scope() {
	let store = store();
	assert_eq!(
		store.resolve_text(Some("hero"), "title").unwrap(),
		"Welcome"
	);
	assert_eq!(
		store.resolve_text(Some("hero.cta"), "label").unwrap(),
		"Start now"
	);
}

#[test]
fn resolves_a_dotted_key_without_a_scope() {
	let store = store();
	assert_eq!(
		store.resolve_text(None, "hero.cta.hint").unwrap(),
		"It is free"
	);
}

#[test]
fn treats_an_empty_scope_as_no_scope() {
	let store = store();
	assert_eq!(
		store.resolve_text(Some(""), "hero.title").unwrap(),
		"Welcome"
	);
}

#[test]
fn resolves_a_string_array() {
	let store = store();
	let list = store.resolve_list(Some("hero"), "bullets").unwrap();
	assert_eq!(list, ["Fast", "Small", "Typed"]);
}

#[test]
fn array_elements_are_addressable_by_index() {
	let store = store();
	assert_eq!(
		store.resolve_text(Some("hero"), "bullets.1").unwrap(),
		"Small"
	);
	assert_eq!(store.resolve_text(None, "mixed.1.nested").unwrap(), "value");
}

#[test]
fn coerces_numbers_and_booleans_to_text() {
	let store = store();
	assert_eq!(store.resolve_text(None, "count").unwrap(), "42");
	assert_eq!(store.resolve_text(None, "enabled").unwrap(), "true");
}

#[test]
fn null_is_treated_as_a_missing_key() {
	// An unfinished translation should report KEY_NOT_FOUND, not render "null".
	let store = store();
	let error = store.resolve_text(None, "unfinished").unwrap_err();
	assert_eq!(error.code, ErrorCode::KeyNotFound);
}

#[test]
fn missing_scope_and_missing_key_are_distinguished() {
	let store = store();

	let error = store.resolve_text(Some("nope"), "title").unwrap_err();
	assert_eq!(error.code, ErrorCode::ScopeNotFound);
	assert_eq!(error.scope.as_deref(), Some("nope"));

	let error = store.resolve_text(Some("hero"), "nope").unwrap_err();
	assert_eq!(error.code, ErrorCode::KeyNotFound);
	assert_eq!(error.key.as_deref(), Some("nope"));
}

#[test]
fn resolving_a_container_reports_a_type_mismatch() {
	let store = store();
	let error = store.resolve_text(Some("hero"), "cta").unwrap_err();
	assert_eq!(error.code, ErrorCode::TypeMismatch);
	assert!(
		error.detail.is_some(),
		"the detail should say what was found"
	);
}

#[test]
fn asking_for_the_wrong_shape_reports_a_type_mismatch_with_the_fix() {
	let store = store();

	let error = store.resolve_text(Some("hero"), "bullets").unwrap_err();
	assert_eq!(error.code, ErrorCode::TypeMismatch);
	assert!(error.detail.unwrap().contains("t.array"));

	let error = store.resolve_list(Some("hero"), "title").unwrap_err();
	assert_eq!(error.code, ErrorCode::TypeMismatch);
	assert!(error.detail.unwrap().contains("t()"));
}

#[test]
fn invalid_json_is_distinguished_from_a_missing_key() {
	let error = MessageStore::from_json("fa", "broken", "{ \"a\": ").unwrap_err();
	assert_eq!(error.code, ErrorCode::InvalidJson);
	assert_eq!(error.namespace, "broken");
	// The parser's own message carries line and column.
	assert!(error.detail.is_some());
}

#[test]
fn error_messages_name_the_locale_and_namespace() {
	let store = store();
	let error = store.resolve_text(Some("hero"), "nope").unwrap_err();
	let message = error.to_string();

	assert!(message.contains("KEY_NOT_FOUND"), "{message}");
	assert!(message.contains("home"), "{message}");
	assert!(message.contains("fa"), "{message}");
	assert!(
		message.contains("never falls back to another locale"),
		"the policy should be stated where the developer reads it: {message}"
	);
}

#[test]
fn dedupe_key_is_stable_per_distinct_problem() {
	let store = store();
	let first = store.resolve_text(Some("hero"), "nope").unwrap_err();
	let second = store.resolve_text(Some("hero"), "nope").unwrap_err();
	let other = store.resolve_text(Some("hero"), "also-nope").unwrap_err();

	assert_eq!(first.dedupe_key(), second.dedupe_key());
	assert_ne!(first.dedupe_key(), other.dedupe_key());
}

#[test]
fn has_reports_presence_without_erroring() {
	let store = store();
	assert!(store.has(Some("hero"), "title"));
	assert!(store.has(Some("hero"), "bullets"));
	assert!(!store.has(Some("hero"), "cta")); // a container is not a message
	assert!(!store.has(Some("hero"), "missing"));
}

#[test]
fn keys_enumerates_every_terminal_entry() {
	let store = store();
	let mut keys: Vec<&str> = store.keys().collect();
	keys.sort_unstable();

	assert!(keys.contains(&"hero.title"));
	assert!(keys.contains(&"hero.cta.label"));
	assert!(keys.contains(&"hero.bullets"));
	assert!(keys.contains(&"hero.bullets.0"));
	assert!(!keys.contains(&"unfinished"));
}

#[test]
fn resolve_reports_the_shape_it_found() {
	let store = store();
	assert!(matches!(
		store.resolve(Some("hero"), "title"),
		Ok(Resolved::Text(_))
	));
	assert!(matches!(
		store.resolve(Some("hero"), "bullets"),
		Ok(Resolved::List(_))
	));
}

#[test]
fn an_empty_namespace_is_usable() {
	let store = MessageStore::from_json("fa", "empty", "{}").unwrap();
	assert!(store.is_empty());
	assert_eq!(
		store.resolve_text(None, "any").unwrap_err().code,
		ErrorCode::KeyNotFound
	);
}

#[test]
fn nesting_within_the_parser_limit_flattens_correctly() {
	let depth = 100;
	let raw = format!(
		"{}{}{}",
		r#"{"a":"#.repeat(depth),
		r#""leaf""#,
		"}".repeat(depth)
	);
	let store = MessageStore::from_json("fa", "deep", &raw).unwrap();

	let path = vec!["a"; depth].join(".");
	assert_eq!(store.resolve_text(None, &path).unwrap(), "leaf");
}

#[test]
fn pathologically_nested_input_is_rejected_rather_than_overflowing() {
	// serde_json enforces its own recursion limit, which also bounds our
	// recursive flattener. A hostile or generated file fails as INVALID_JSON
	// instead of taking the process down with a stack overflow.
	let depth = 2_000;
	let raw = format!(
		"{}{}{}",
		r#"{"a":"#.repeat(depth),
		r#""leaf""#,
		"}".repeat(depth)
	);

	let error = MessageStore::from_json("fa", "deep", &raw).unwrap_err();
	assert_eq!(error.code, ErrorCode::InvalidJson);
}

#[cfg(feature = "cli")]
#[test]
fn entries_report_the_shape_of_each_key() {
	let store = store();
	let entries = store.entries();

	let title = entries.iter().find(|e| e.key == "hero.title").unwrap();
	assert_eq!(title.kind, LeafKind::Text);

	let bullets = entries.iter().find(|e| e.key == "hero.bullets").unwrap();
	assert_eq!(bullets.kind, LeafKind::List);
}

#[cfg(feature = "cli")]
#[test]
fn entries_are_sorted_so_generated_files_do_not_churn() {
	let store = store();
	let keys: Vec<&str> = store.entries().into_iter().map(|e| e.key).collect();

	let mut sorted = keys.clone();
	sorted.sort_unstable();
	assert_eq!(keys, sorted);
}

#[cfg(feature = "cli")]
#[test]
fn scopes_include_the_root_and_are_sorted() {
	let store = store();
	let scopes = store.scopes();

	assert_eq!(scopes.first(), Some(&""), "the root scope must be present");
	assert!(scopes.contains(&"hero"));
	assert!(scopes.contains(&"hero.cta"));
	// Arrays are containers too, so their indices are addressable.
	assert!(scopes.contains(&"hero.bullets"));

	let mut sorted = scopes.clone();
	sorted.sort_unstable();
	assert_eq!(scopes, sorted);
}

// Joining `scope` and `key` happens on the stack when it fits and spills to the
// heap when it does not. That boundary is invisible from outside — which is
// exactly why it needs testing: a key one byte too long must resolve to the same
// value, not be truncated into a different key or silently miss.
#[test]
fn resolves_the_same_either_side_of_the_stack_join_boundary() {
	// The buffer is 192 bytes. These sit well below, exactly on, and above it.
	for scope_len in [8usize, 100, 190, 191, 300, 4096] {
		let scope = "s".repeat(scope_len);
		let key = "k".repeat(40);

		let raw = format!(r#"{{ "{scope}": {{ "{key}": "value" }} }}"#);
		let store = MessageStore::from_json("fa", "long", &raw).unwrap();

		assert_eq!(
			store.resolve_text(Some(&scope), &key).unwrap(),
			"value",
			"scope of {scope_len} bytes did not resolve"
		);

		// The unscoped form of the same path must agree, since both produce the
		// same dotted key by different routes.
		let joined = format!("{scope}.{key}");
		assert_eq!(store.resolve_text(None, &joined).unwrap(), "value");
	}
}

#[test]
fn a_long_key_that_is_absent_still_reports_key_not_found() {
	let scope = "s".repeat(300);
	let raw = format!(r#"{{ "{scope}": {{ "present": "value" }} }}"#);
	let store = MessageStore::from_json("fa", "long", &raw).unwrap();

	let error = store.resolve_text(Some(&scope), "absent").unwrap_err();
	assert_eq!(error.code, ErrorCode::KeyNotFound);
}

#[test]
fn a_multibyte_scope_joins_without_corrupting_the_key() {
	// The join writes bytes, not characters. A scope of Persian text is the
	// obvious way to notice if that were done wrong.
	let raw = r#"{ "صفحه‌اصلی": { "عنوان": "خوش آمدید" } }"#;
	let store = MessageStore::from_json("fa", "fa-keys", raw).unwrap();

	assert_eq!(
		store.resolve_text(Some("صفحه‌اصلی"), "عنوان").unwrap(),
		"خوش آمدید"
	);
	assert_eq!(
		store.resolve_text(None, "صفحه‌اصلی.عنوان").unwrap(),
		"خوش آمدید"
	);
}
