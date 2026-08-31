//! Plural, ordinal and select arguments.
//!
//! The categories in these tests are the ones `Intl.PluralRules` actually
//! returns — `ru` really does put 21 in `one` and 22 in `few` — because the
//! point of this code is to be correct for languages whose rules do not look
//! like English's. Writing plausible-looking categories by hand would test the
//! selection logic against a fiction.

#![cfg(feature = "full")]
#![allow(clippy::unwrap_used, clippy::panic)]

use i18n_fs_core::format::{
	flatten_with, interpolate, interpolate_with, tokenize, Arm, Node, PluralArg,
};
use std::collections::BTreeMap;

fn params(pairs: &[(&str, &str)]) -> BTreeMap<String, String> {
	pairs
		.iter()
		.map(|(k, v)| ((*k).to_owned(), (*v).to_owned()))
		.collect()
}

/// One numeric argument, as the host would describe it.
fn plural(
	name: &str,
	cardinal: &str,
	ordinal: &str,
	formatted: &str,
) -> BTreeMap<String, PluralArg> {
	let mut map = BTreeMap::new();
	map.insert(
		name.to_owned(),
		PluralArg {
			cardinal: cardinal.to_owned(),
			ordinal: ordinal.to_owned(),
			formatted: formatted.to_owned(),
		},
	);
	map
}

/// Render, and assert nothing was reported as wrong.
fn render(
	template: &str,
	values: &[(&str, &str)],
	plurals: &BTreeMap<String, PluralArg>,
) -> String {
	let result = interpolate_with(template, &params(values), plurals);
	assert!(result.missing.is_empty(), "missing: {:?}", result.missing);
	assert!(
		result.not_numeric.is_empty(),
		"not numeric: {:?}",
		result.not_numeric
	);
	assert!(
		result.unmatched.is_empty(),
		"unmatched: {:?}",
		result.unmatched
	);
	result.value
}

const EN: &str = "{count, plural, one {# file} other {# files}}";

#[test]
fn english_picks_one_and_other() {
	assert_eq!(
		render(EN, &[("count", "1")], &plural("count", "one", "one", "1")),
		"1 file"
	);
	assert_eq!(
		render(
			EN,
			&[("count", "5")],
			&plural("count", "other", "other", "5")
		),
		"5 files"
	);
}

#[test]
fn russian_needs_three_arms_and_gets_them() {
	// The whole reason this feature exists: `count == 1 ? a : b` in a component
	// is wrong here for 2 and for 21, and the translator cannot fix it.
	let template = "{count, plural, one {# файл} few {# файла} many {# файлов} other {# файла}}";

	assert_eq!(
		render(
			template,
			&[("count", "1")],
			&plural("count", "one", "other", "1")
		),
		"1 файл"
	);
	assert_eq!(
		render(
			template,
			&[("count", "2")],
			&plural("count", "few", "other", "2")
		),
		"2 файла"
	);
	assert_eq!(
		render(
			template,
			&[("count", "5")],
			&plural("count", "many", "other", "5")
		),
		"5 файлов"
	);
	// 21 goes back to `one`, which is the case a hand-written rule gets wrong.
	assert_eq!(
		render(
			template,
			&[("count", "21")],
			&plural("count", "one", "other", "21")
		),
		"21 файл"
	);
}

#[test]
fn persian_puts_zero_in_one() {
	// `fa` categorises 0 as `one`, so a message written for it renders the arm
	// the language asks for rather than the arm English would.
	let template = "{count, plural, one {یک یا هیچ} other {چند}}";

	assert_eq!(
		render(
			template,
			&[("count", "0")],
			&plural("count", "one", "other", "۰")
		),
		"یک یا هیچ"
	);
}

#[test]
fn exact_arms_beat_the_category() {
	let template = "{count, plural, =0 {no files} one {# file} other {# files}}";

	// `fa` and `en` disagree about which category 0 falls in; `=0` sidesteps
	// the question entirely, which is why it exists.
	assert_eq!(
		render(
			template,
			&[("count", "0")],
			&plural("count", "other", "other", "0")
		),
		"no files"
	);
	assert_eq!(
		render(
			template,
			&[("count", "0")],
			&plural("count", "one", "one", "0")
		),
		"no files"
	);
}

#[test]
fn exact_arms_compare_numbers_not_text() {
	let template = "{n, plural, =1.5 {half} other {#}}";

	assert_eq!(
		render(
			template,
			&[("n", "1.50")],
			&plural("n", "other", "other", "1.5")
		),
		"half"
	);
}

#[test]
fn hash_renders_the_formatted_number() {
	// The point of taking `formatted` from the host: `#` has to be the number
	// as the locale writes it, not as Rust would.
	assert_eq!(
		render(
			"{count, plural, other {# فایل}}",
			&[("count", "1234")],
			&plural("count", "other", "other", "۱٬۲۳۴"),
		),
		"۱٬۲۳۴ فایل"
	);
}

#[test]
fn double_hash_is_a_literal_hash() {
	assert_eq!(
		render(
			"{count, plural, other {## rank #}}",
			&[("count", "3")],
			&plural("count", "other", "other", "3"),
		),
		"# rank 3"
	);
}

#[test]
fn hash_outside_an_arm_is_ordinary_text() {
	// Existing messages contain `#`, and none of them meant this.
	let result = interpolate("issue #42 for {name}", &params(&[("name", "Ali")]));
	assert_eq!(result.value, "issue #42 for Ali");
}

#[test]
fn ordinals_use_the_ordinal_category() {
	let template = "{n, selectordinal, one {#st} two {#nd} few {#rd} other {#th}}";

	// 2 is `other` as a cardinal and `two` as an ordinal. Reading the wrong one
	// gives "2th", so this asserts the two are not confused.
	assert_eq!(
		render(template, &[("n", "2")], &plural("n", "other", "two", "2")),
		"2nd"
	);
	assert_eq!(
		render(template, &[("n", "4")], &plural("n", "other", "other", "4")),
		"4th"
	);
	assert_eq!(
		render(template, &[("n", "21")], &plural("n", "other", "one", "21")),
		"21st"
	);
}

#[test]
fn select_matches_the_value_itself() {
	let template = "{role, select, admin {Administrator} guest {Guest} other {Member}}";
	let none = BTreeMap::new();

	assert_eq!(
		render(template, &[("role", "admin")], &none),
		"Administrator"
	);
	assert_eq!(render(template, &[("role", "guest")], &none), "Guest");
	assert_eq!(render(template, &[("role", "someone")], &none), "Member");
}

#[test]
fn select_needs_no_plural_information() {
	// A `select` argument is not a number, so asking for its category would be
	// a false diagnostic.
	let result = interpolate_with(
		"{role, select, other {ok}}",
		&params(&[("role", "admin")]),
		&BTreeMap::new(),
	);

	assert_eq!(result.value, "ok");
	assert!(result.not_numeric.is_empty());
}

#[test]
fn an_arm_may_open_with_a_placeholder() {
	// `other {{name} …}` is the case that rules out `{{` escaping inside arms:
	// both braces here are structural.
	assert_eq!(
		render(
			"{count, plural, other {{name} has # files}}",
			&[("count", "3"), ("name", "Ali")],
			&plural("count", "other", "other", "3"),
		),
		"Ali has 3 files"
	);
}

#[test]
fn escapes_are_off_inside_an_arm() {
	// `{{name}}` means a literal brace, the parameter, and a literal brace —
	// not an escaped `{name}`. The rule has to differ from the top level
	// because an arm's own braces are structural; this is the case that tells
	// the two apart, and the arm-opens-with-a-placeholder test above does not
	// (its content has no `{{` for the flag to act on).
	assert_eq!(
		render(
			"{count, plural, other {{{name}} won}}",
			&[("count", "1"), ("name", "Ali")],
			&plural("count", "other", "other", "1"),
		),
		"{Ali} won"
	);

	// And the top level is untouched.
	let result = interpolate("{{name}}", &params(&[("name", "Ali")]));
	assert_eq!(result.value, "{name}");
}

#[test]
fn arms_may_nest() {
	let template = "{count, plural, other {{total, plural, one {# of one} other {# of #}}}}";

	let mut plurals = plural("count", "other", "other", "3");
	plurals.insert(
		"total".to_owned(),
		PluralArg {
			cardinal: "other".to_owned(),
			ordinal: "other".to_owned(),
			formatted: "9".to_owned(),
		},
	);

	// `#` binds to the nearest enclosing plural, so both are the inner one.
	assert_eq!(
		render(template, &[("count", "3"), ("total", "9")], &plurals),
		"9 of 9"
	);
}

#[test]
fn braces_still_escape_outside_arms() {
	let result = interpolate("{{literal}} and {name}", &params(&[("name", "x")]));
	assert_eq!(result.value, "{literal} and x");
}

#[test]
fn a_missing_argument_is_reported_and_left_visible() {
	let result = interpolate_with(EN, &params(&[]), &BTreeMap::new());

	assert_eq!(result.value, "{count}");
	assert_eq!(result.missing, vec!["count".to_owned()]);
	// Not also reported as non-numeric: there is no value to have a category.
	assert!(result.not_numeric.is_empty());
}

#[test]
fn a_non_numeric_plural_argument_is_reported_and_falls_to_other() {
	// The host supplies no entry when the parameter was not a number. The
	// sentence still renders, because a page with one odd plural beats a page
	// with a hole in it.
	let result = interpolate_with(EN, &params(&[("count", "many")]), &BTreeMap::new());

	assert_eq!(result.value, "# files");
	assert_eq!(result.not_numeric, vec!["count".to_owned()]);
	assert!(result.unmatched.is_empty());
}

#[test]
fn no_matching_arm_and_no_other_is_reported() {
	let result = interpolate_with(
		"{role, select, admin {A}}",
		&params(&[("role", "guest")]),
		&BTreeMap::new(),
	);

	assert_eq!(result.value, "{role}");
	assert_eq!(result.unmatched, vec!["role".to_owned()]);
}

#[test]
fn each_argument_is_reported_once() {
	let result = interpolate_with(
		"{n, plural, other {#}} and {n, plural, other {#}}",
		&params(&[("n", "x")]),
		&BTreeMap::new(),
	);

	assert_eq!(result.not_numeric, vec!["n".to_owned()]);
}

#[test]
fn malformed_arguments_degrade_to_text() {
	// Every one of these is left as written rather than swallowed, so a typo in
	// a message shows itself instead of blanking the sentence.
	for template in [
		"{count, plural}",
		"{count, plural, }",
		"{count, unknown, other {x}}",
		"{count, plural, other {unclosed}",
		"{, plural, other {x}}",
	] {
		let result = interpolate_with(template, &params(&[("count", "1")]), &BTreeMap::new());
		assert_eq!(result.value, *template, "template: {template}");
	}
}

#[test]
fn nesting_stops_at_a_depth_limit() {
	// Deep enough to be certain the limit is what stopped it, and that stopping
	// is a rendered string rather than a blown stack.
	let mut template = String::new();
	for _ in 0..64 {
		template.push_str("{n, plural, other {");
	}
	template.push('x');
	for _ in 0..64 {
		template.push('}');
	}

	let result = interpolate_with(
		&template,
		&params(&[("n", "1")]),
		&plural("n", "one", "one", "1"),
	);
	assert!(result.value.contains('x'));
}

#[test]
fn tokenize_produces_arms_for_the_react_layer() {
	let nodes = tokenize("{count, plural, one {# file} other {# <b>files</b>}}");

	let Some(Node::Plural {
		name,
		ordinal,
		arms,
	}) = nodes.first()
	else {
		panic!("expected a plural node, got {nodes:?}");
	};

	assert_eq!(name, "count");
	assert!(!ordinal);
	assert_eq!(arms.len(), 2);
	assert_eq!(arms[0].key, "one");
	assert_eq!(
		arms[0].children,
		vec![
			Node::Number,
			Node::Text {
				value: " file".to_owned()
			}
		]
	);

	// Tags inside an arm are still tags, so `t.rich` can render them.
	let Arm { children, .. } = &arms[1];
	assert!(children.iter().any(|node| matches!(node, Node::Tag { .. })));
}

#[test]
fn selectordinal_is_marked_as_ordinal() {
	let nodes = tokenize("{n, selectordinal, other {#th}}");

	assert!(matches!(
		nodes.first(),
		Some(Node::Plural { ordinal: true, .. })
	));
}

#[test]
fn both_renderers_agree_on_plural_messages() {
	// `t` renders through `interpolate` and `t.rich` through `tokenize` plus
	// `flatten`. Two parsers over one grammar drift; this is what catches it.
	let cases: &[(&str, &[(&str, &str)])] = &[
		(EN, &[("count", "1")]),
		(EN, &[("count", "7")]),
		(
			"{count, plural, =0 {none} other {# left}}",
			&[("count", "0")],
		),
		(
			"{count, plural, other {{name} has # files}}",
			&[("count", "3"), ("name", "Ali")],
		),
		("{role, select, admin {A} other {M}}", &[("role", "admin")]),
		("{n, selectordinal, one {#st} other {#th}}", &[("n", "21")]),
		("{count, plural, other {##}}", &[("count", "2")]),
		("{count, plural, admin {x}}", &[("count", "2")]),
	];

	for (template, values) in cases {
		let plurals = plural("count", "one", "one", "1");
		let mut all = plurals.clone();
		all.insert(
			"n".to_owned(),
			PluralArg {
				cardinal: "other".to_owned(),
				ordinal: "one".to_owned(),
				formatted: "21".to_owned(),
			},
		);

		let direct = interpolate_with(template, &params(values), &all);
		let through_nodes = flatten_with(&tokenize(template), &params(values), &all);

		assert_eq!(direct.value, through_nodes, "template: {template}");
	}
}
