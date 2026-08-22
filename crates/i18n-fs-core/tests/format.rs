//! Placeholder interpolation and rich-text tokenisation.

#![cfg(feature = "full")]
#![allow(clippy::unwrap_used, clippy::panic)]

use i18n_fs_core::format::{flatten, interpolate, tokenize, Node};
use std::collections::BTreeMap;

fn params(pairs: &[(&str, &str)]) -> BTreeMap<String, String> {
    pairs
        .iter()
        .map(|(k, v)| ((*k).to_owned(), (*v).to_owned()))
        .collect()
}

fn text(value: &str) -> Node {
    Node::Text {
        value: value.to_owned(),
    }
}

fn param(name: &str) -> Node {
    Node::Param {
        name: name.to_owned(),
    }
}

fn tag(name: &str, children: Vec<Node>) -> Node {
    Node::Tag {
        name: name.to_owned(),
        children,
    }
}

#[test]
fn substitutes_placeholders() {
    let result = interpolate("Hello {name}!", &params(&[("name", "Ali")]));
    assert_eq!(result.value, "Hello Ali!");
    assert!(result.missing.is_empty());
}

#[test]
fn a_missing_parameter_stays_visible_and_is_reported() {
    // Rendering an empty gap hides the bug; leaving the marker shows it, and
    // `missing` lets the caller report PARAM_MISSING with the name.
    let result = interpolate("Hello {name}, you are {age}", &params(&[("name", "Ali")]));
    assert_eq!(result.value, "Hello Ali, you are {age}");
    assert_eq!(result.missing, ["age"]);
}

#[test]
fn missing_parameters_are_reported_once_each() {
    let result = interpolate("{a} {a} {b} {a}", &params(&[]));
    assert_eq!(result.missing, ["a", "b"]);
}

#[test]
fn doubled_braces_are_literal() {
    let result = interpolate(
        "{{name}} is literal, {name} is not",
        &params(&[("name", "Ali")]),
    );
    assert_eq!(result.value, "{name} is literal, Ali is not");
    assert!(result.missing.is_empty());
}

#[test]
fn malformed_placeholders_are_left_alone() {
    for template in ["{", "{ }", "{not valid}", "a { b", "{1abc}"] {
        let result = interpolate(template, &params(&[]));
        assert_eq!(result.value, template, "{template} was mangled");
    }
}

#[test]
fn interpolation_leaves_tags_untouched() {
    let result = interpolate("Read <b>{title}</b>", &params(&[("title", "the docs")]));
    assert_eq!(result.value, "Read <b>the docs</b>");
}

#[test]
fn interpolation_handles_multibyte_text() {
    let result = interpolate("سلام {name}، خوش آمدید", &params(&[("name", "علی")]));
    assert_eq!(result.value, "سلام علی، خوش آمدید");
}

#[test]
fn tokenizes_plain_text() {
    assert_eq!(tokenize("just text"), vec![text("just text")]);
}

#[test]
fn tokenizes_a_simple_tag() {
    assert_eq!(
        tokenize("a <b>bold</b> word"),
        vec![text("a "), tag("b", vec![text("bold")]), text(" word"),]
    );
}

#[test]
fn tokenizes_tags_nested_inside_the_same_tag_name() {
    // The regex parser this replaces matched the first closing tag and produced
    // "<b>a<b>c</b>" + stray "d</b>". A stack gets it right.
    assert_eq!(
        tokenize("<b>a<b>c</b>d</b>"),
        vec![tag(
            "b",
            vec![text("a"), tag("b", vec![text("c")]), text("d")]
        )]
    );
}

#[test]
fn tokenizes_params_inside_tags() {
    assert_eq!(
        tokenize("<link>{label}</link>"),
        vec![tag("link", vec![param("label")])]
    );
}

#[test]
fn tokenizes_self_closing_tags() {
    assert_eq!(
        tokenize("line<br />break"),
        vec![text("line"), tag("br", vec![]), text("break")]
    );
    assert_eq!(
        tokenize("line<br/>break"),
        vec![text("line"), tag("br", vec![]), text("break")]
    );
}

#[test]
fn an_unclosed_tag_degrades_to_visible_markup() {
    // A broken message shows its own markup rather than disappearing.
    assert_eq!(
        tokenize("<b>never closed"),
        vec![text("<b>"), text("never closed")]
    );
}

#[test]
fn a_stray_closing_tag_degrades_to_text() {
    assert_eq!(tokenize("plain</b>"), vec![text("plain</b>")]);
}

#[test]
fn a_bare_angle_bracket_is_text() {
    assert_eq!(tokenize("2 < 3 and 4 > 3"), vec![text("2 < 3 and 4 > 3")]);
}

#[test]
fn mismatched_nesting_does_not_lose_content() {
    let nodes = tokenize("<a>one<b>two</a>three</b>");
    let rendered = flatten(&nodes, &params(&[]));
    assert!(rendered.contains("one"));
    assert!(rendered.contains("two"));
    assert!(rendered.contains("three"));
}

#[test]
fn flatten_drops_markup_and_substitutes() {
    let nodes = tokenize("Hello <b>{name}</b>, see <link>docs</link>");
    let rendered = flatten(&nodes, &params(&[("name", "Ali")]));
    assert_eq!(rendered, "Hello Ali, see docs");
}

#[test]
fn flatten_keeps_missing_parameters_visible() {
    let nodes = tokenize("Hello <b>{name}</b>");
    assert_eq!(flatten(&nodes, &params(&[])), "Hello {name}");
}

#[test]
fn tokenizes_multibyte_content_inside_tags() {
    assert_eq!(
        tokenize("<b>سلام</b> دنیا"),
        vec![tag("b", vec![text("سلام")]), text(" دنیا")]
    );
}

#[test]
fn tag_names_allow_hyphens_and_digits() {
    assert_eq!(
        tokenize("<my-tag2>x</my-tag2>"),
        vec![tag("my-tag2", vec![text("x")])]
    );
}

#[test]
fn doubled_braces_survive_tokenisation() {
    assert_eq!(tokenize("{{literal}}"), vec![text("{literal}")]);
}
