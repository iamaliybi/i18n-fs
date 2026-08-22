//! Property tests for the message formatter.
//!
//! Translation files are authored by hand and by translators who are not
//! developers, so the formatter sees malformed input as a matter of course. The
//! invariant is that it degrades rather than panicking or losing text.

#![cfg(feature = "full")]
#![allow(clippy::unwrap_used, clippy::panic)]

use i18n_fs_core::format::{flatten, interpolate, tokenize, Node};
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
    ];

    prop::collection::vec(fragment, 0..12).prop_map(|parts| parts.concat())
}

fn params() -> BTreeMap<String, String> {
    let mut params = BTreeMap::new();
    params.insert("name".to_owned(), "Ali".to_owned());
    params
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
    let mut out = String::new();
    for node in nodes {
        match node {
            // Literal braces have to go back through the escape, or the
            // reconstruction would read as a placeholder on the next parse.
            Node::Text { value } => out.push_str(&value.replace('{', "{{").replace('}', "}}")),
            Node::Param { name } => {
                out.push('{');
                out.push_str(name);
                out.push('}');
            }
            Node::Tag { name, children } => {
                out.push('<');
                out.push_str(name);
                out.push('>');
                out.push_str(&reconstruct(children));
                out.push_str("</");
                out.push_str(name);
                out.push('>');
            }
        }
    }
    out
}

/// Every `Text` node in the tree, flattened.
fn text_nodes(nodes: &[Node], out: &mut Vec<String>) {
    for node in nodes {
        match node {
            Node::Text { value } => out.push(value.clone()),
            Node::Tag { children, .. } => text_nodes(children, out),
            Node::Param { .. } => {}
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

        let source = unescape(&template);
        for value in texts {
            prop_assert!(
                source.contains(&value),
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
            flatten(&nodes, &params()),
            interpolate(&template, &params()).value
        );
    }
}
