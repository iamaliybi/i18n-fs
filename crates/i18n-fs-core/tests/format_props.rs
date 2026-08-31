//! Property tests for the message formatter.
//!
//! Translation files are authored by hand and by translators who are not
//! developers, so the formatter sees malformed input as a matter of course. The
//! invariant is that it degrades rather than panicking or losing text.

#![cfg(feature = "full")]
#![allow(clippy::unwrap_used, clippy::panic)]

use i18n_fs_core::format::{
	flatten_with, interpolate, interpolate_with, tokenize, Node, PluralArg,
};
use proptest::prelude::*;
use std::collections::BTreeMap;

/// Fragments biased toward the constructs the formatter cares about, so the
/// generator spends its time on interesting input rather than random text.
fn templates() -> impl Strategy<Value = String> {
	let fragment = prop_oneof![
		Just("plain"),
		Just(" "),
		Just("{name}"),
		Just("{missing}"),
		Just("{{"),
		Just("}}"),
		Just("{"),
		Just("}"),
		Just("<b>"),
		Just("</b>"),
		Just("<link>"),
		Just("</link>"),
		Just("<br />"),
		Just("<"),
		Just(">"),
		Just("</"),
		Just("سلام"),
		Just("{1bad}"),
		// Plural arguments, whole and in pieces, so the generator produces both
		// valid ones and every way of truncating one.
		Just("{count, plural, one {# file} other {# files}}"),
		Just("{count, plural, =0 {none} other {#}}"),
		Just("{role, select, admin {A} other {M}}"),
		Just("{n, selectordinal, one {#st} other {#th}}"),
		Just("{count, plural, other {{name} has #}}"),
		Just("{count, plural, =3 {exactly three} other {#}}"),
		Just("{count, plural, other {{{name}} won}}"),
		Just("{count, plural, "),
		Just("other {"),
		Just("#"),
		Just("##"),
	];

	prop::collection::vec(fragment, 0..12).prop_map(|parts| parts.concat())
}

/// The same fragments with the tag markup removed.
///
/// `flatten` drops tag markup by design and `interpolate` leaves it in place,
/// so comparing the two renderers means comparing them on messages where they
/// are supposed to agree. Filtering the main generator instead rejects most of
/// what it produces and the property gives up before it has covered anything.
fn tagless_templates() -> impl Strategy<Value = String> {
	let fragment = prop_oneof![
		Just("plain"),
		Just(" "),
		Just("{name}"),
		Just("{missing}"),
		Just("{{"),
		Just("}}"),
		Just("{"),
		Just("}"),
		Just("سلام"),
		Just("{1bad}"),
		Just("{count, plural, one {# file} other {# files}}"),
		Just("{count, plural, =0 {none} other {#}}"),
		Just("{role, select, admin {A} other {M}}"),
		Just("{n, selectordinal, one {#st} other {#th}}"),
		Just("{count, plural, other {{name} has #}}"),
		Just("{count, plural, =3 {exactly three} other {#}}"),
		Just("{count, plural, other {{{name}} won}}"),
		Just("{count, plural, "),
		Just("other {"),
		Just("#"),
		Just("##"),
	];

	prop::collection::vec(fragment, 0..12).prop_map(|parts| parts.concat())
}

fn params() -> BTreeMap<String, String> {
	let mut params = BTreeMap::new();
	params.insert("name".to_owned(), "Ali".to_owned());
	params.insert("count".to_owned(), "3".to_owned());
	params.insert("role".to_owned(), "admin".to_owned());
	params.insert("n".to_owned(), "21".to_owned());
	params
}

/// What the host would report about the numeric parameters in [`params`].
fn plurals() -> BTreeMap<String, PluralArg> {
	let mut plurals = BTreeMap::new();
	plurals.insert(
		"count".to_owned(),
		PluralArg {
			cardinal: "other".to_owned(),
			ordinal: "other".to_owned(),
			formatted: "3".to_owned(),
		},
	);
	plurals.insert(
		"n".to_owned(),
		PluralArg {
			cardinal: "other".to_owned(),
			ordinal: "one".to_owned(),
			formatted: "21".to_owned(),
		},
	);
	plurals
}

/// Collapse brace escapes the way the tokeniser does, so tests can compare
/// against the text a correct tokeniser is expected to produce.
fn unescape(template: &str) -> String {
	let bytes = template.as_bytes();
	let mut out = String::with_capacity(template.len());
	let mut index = 0;

	while index < bytes.len() {
		let rest = &template[index..];
		if rest.starts_with("{{") || rest.starts_with("}}") {
			out.push(rest.chars().next().unwrap_or('{'));
			index += 2;
		} else {
			let ch = rest.chars().next().unwrap_or('\0');
			out.push(ch);
			index += ch.len_utf8();
		}
	}

	out
}

/// Render a node tree back to markup. Not byte-identical to the input — a
/// self-closing `<br />` comes back as `<br></br>` — but semantically the same
/// message, which is what the round-trip property below checks.
fn reconstruct(nodes: &[Node]) -> String {
	reconstruct_inner(nodes, true, false)
}

/// `escapes` is off inside an arm, and `sharp` is on inside a plural arm —
/// the same two flags the tokeniser carries. Writing them out here is what
/// makes the round-trip property test the asymmetry rather than assume it.
fn reconstruct_inner(nodes: &[Node], escapes: bool, sharp: bool) -> String {
	let mut out = String::new();
	for node in nodes {
		match node {
			// Literal braces have to go back through the escape, or the
			// reconstruction would read as a placeholder on the next parse.
			// Inside an arm there is no escape, and none is needed: the braces
			// that survived parsing are balanced, so they parse the same way
			// again.
			Node::Text { value } => {
				let value = if escapes {
					value.replace('{', "{{").replace('}', "}}")
				} else {
					value.clone()
				};
				out.push_str(&if sharp {
					value.replace('#', "##")
				} else {
					value
				});
			}
			Node::Number => out.push('#'),
			Node::Param { name } => {
				out.push('{');
				out.push_str(name);
				out.push('}');
			}
			Node::Tag { name, children } => {
				out.push('<');
				out.push_str(name);
				out.push('>');
				out.push_str(&reconstruct_inner(children, escapes, sharp));
				out.push_str("</");
				out.push_str(name);
				out.push('>');
			}
			Node::Plural {
				name,
				ordinal,
				arms,
			} => {
				let keyword = if *ordinal { "selectordinal" } else { "plural" };
				out.push_str(&write_arms(name, keyword, arms, true));
			}
			Node::Select { name, arms } => {
				out.push_str(&write_arms(name, "select", arms, false));
			}
		}
	}
	out
}

fn write_arms(name: &str, keyword: &str, arms: &[i18n_fs_core::Arm], sharp: bool) -> String {
	let mut out = format!("{{{name}, {keyword}, ");
	for arm in arms {
		out.push_str(&arm.key);
		out.push(' ');
		out.push('{');
		out.push_str(&reconstruct_inner(&arm.children, false, sharp));
		out.push('}');
	}
	out.push('}');
	out
}

/// Every `Text` node in the tree, flattened.
fn text_nodes(nodes: &[Node], out: &mut Vec<String>) {
	for node in nodes {
		match node {
			Node::Text { value } => out.push(value.clone()),
			Node::Tag { children, .. } => text_nodes(children, out),
			Node::Plural { arms, .. } | Node::Select { arms, .. } => {
				for arm in arms {
					text_nodes(&arm.children, out);
				}
			}
			Node::Param { .. } | Node::Number => {}
		}
	}
}

proptest! {
	#![proptest_config(ProptestConfig::with_cases(4096))]

	#[test]
	fn interpolate_never_panics(template in templates()) {
		let _ = interpolate(&template, &params());
	}

	#[test]
	fn interpolate_never_panics_on_arbitrary_text(template in ".*") {
		let _ = interpolate(&template, &params());
	}

	#[test]
	fn tokenize_never_panics(template in templates()) {
		let _ = tokenize(&template);
	}

	#[test]
	fn tokenize_never_panics_on_arbitrary_text(template in ".*") {
		let _ = tokenize(&template);
	}

	/// Interpolating with no parameters at all is the identity on text that
	/// contains no placeholders and no brace escapes.
	#[test]
	fn interpolate_preserves_text_without_placeholders(text in "[^{}]*") {
		let result = interpolate(&text, &BTreeMap::new());
		prop_assert_eq!(result.value, text);
		prop_assert!(result.missing.is_empty());
	}

	/// Every reported missing name is a name that really appears unresolved in
	/// the output, and no name is reported twice.
	#[test]
	fn reported_missing_params_are_accurate(template in templates()) {
		let result = interpolate(&template, &params());

		for name in &result.missing {
			prop_assert!(
				result.value.contains(&format!("{{{name}}}")),
				"reported {name} as missing but it is not in the output"
			);
			prop_assert_ne!(name, "name", "a provided parameter was reported missing");
		}

		let mut seen = result.missing.clone();
		seen.sort();
		seen.dedup();
		prop_assert_eq!(seen.len(), result.missing.len(), "duplicate report");
	}

	/// Tokenising invents nothing: every piece of literal text in the tree
	/// occurs in the template, once brace escapes are collapsed the way the
	/// tokeniser collapses them.
	#[test]
	fn tokenize_invents_no_text(template in templates()) {
		let nodes = tokenize(&template);
		let mut texts = Vec::new();
		text_nodes(&nodes, &mut texts);

		// Two sources, because the escape is context-dependent: text outside an
		// arm appears in the template with `{{` collapsed, and text inside one
		// appears exactly as written. Accepting either still catches invented
		// text, which is what this property is for.
		let source = unescape(&template);
		for value in texts {
			prop_assert!(
				source.contains(&value) || template.contains(&value),
				"tokenising {:?} produced text {:?} that is not in it",
				template,
				value
			);
		}
	}

	/// Tokenising is stable under round-tripping: parsing the tree's own markup
	/// yields the same tree. This is the strong form of "degrades predictably" —
	/// even a malformed message settles on one interpretation instead of
	/// drifting each time it is parsed.
	#[test]
	fn tokenize_round_trips(template in templates()) {
		let once = tokenize(&template);
		let twice = tokenize(&reconstruct(&once));
		prop_assert_eq!(&twice, &once, "tokenising {:?} was not stable", template);
	}

	/// Tag nodes are always balanced by construction, so the React layer can
	/// map them to elements without checking.
	#[test]
	fn tokenize_produces_named_tags_only(template in templates()) {
		fn check(nodes: &[Node]) -> bool {
			nodes.iter().all(|node| match node {
				Node::Tag { name, children } => {
					!name.is_empty()
						&& name.chars().next().is_some_and(|c| c.is_ascii_alphabetic())
						&& check(children)
				}
				_ => true,
			})
		}

		prop_assert!(check(&tokenize(&template)));
	}

	/// `flatten` agrees with `interpolate` on templates that contain no tags.
	#[test]
	fn flatten_matches_interpolate_without_tags(text in "[a-z ]*") {
		let template = format!("{text} {{name}} {text}");
		let nodes = tokenize(&template);

		prop_assert_eq!(
			flatten_with(&nodes, &params(), &plurals()),
			interpolate_with(&template, &params(), &plurals()).value
		);
	}

	/// The same agreement over the whole generator, plural arguments included.
	///
	/// `t` renders through `interpolate` and `t.rich` through `tokenize` and
	/// `flatten`: two parsers over one grammar, which is exactly the shape that
	/// drifts. Tags are excluded only because `flatten` drops their markup by
	/// design while `interpolate` leaves it in place.
	#[test]
	fn both_renderers_agree(template in tagless_templates()) {
		prop_assert_eq!(
			flatten_with(&tokenize(&template), &params(), &plurals()),
			interpolate_with(&template, &params(), &plurals()).value,
			"template: {:?}", template
		);
	}
}
