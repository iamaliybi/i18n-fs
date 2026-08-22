//! Placeholder interpolation and rich-text tokenisation.
//!
//! The template language is deliberately tiny:
//!
//! - `{name}` is a placeholder. `{{` and `}}` are literal braces.
//! - `<tag>...</tag>` and `<tag />` delimit a region the caller renders itself.
//!
//! Parsing is a single pass over the input with an explicit stack, so tags that
//! nest inside a tag of the same name (`<b>a<b>c</b>d</b>`) parse correctly —
//! the regex approach this replaces silently mismatched them.
//!
//! JSX never crosses the WASM boundary. `rich` returns a [`Node`] tree and the
//! React layer turns each [`Node::Tag`] into an element. Requires the `full`
//! feature.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// A node of a parsed rich message.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Node {
    /// Literal text.
    Text {
        /// The text.
        value: String,
    },
    /// A `{placeholder}` the caller substitutes. Kept unresolved so a parameter
    /// can be a React element rather than a string.
    Param {
        /// Placeholder name.
        name: String,
    },
    /// A `<tag>` region.
    Tag {
        /// Tag name.
        name: String,
        /// Contents of the region.
        children: Vec<Node>,
    },
}

/// Result of rendering a plain message.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Interpolation {
    /// The rendered string.
    pub value: String,
    /// Placeholders that had no matching parameter, in order of appearance and
    /// de-duplicated. Their `{name}` markers are left intact in `value` so the
    /// gap is visible rather than silently blank.
    pub missing: Vec<String>,
}

/// Substitute `{name}` placeholders. Tags are left untouched.
///
/// `{{` and `}}` produce literal braces. An unterminated or malformed `{...}`
/// is emitted verbatim rather than swallowed.
pub fn interpolate(template: &str, params: &BTreeMap<String, String>) -> Interpolation {
    let bytes = template.as_bytes();
    let mut value = String::with_capacity(template.len());
    let mut missing: Vec<String> = Vec::new();
    let mut index = 0;

    while index < bytes.len() {
        match bytes.get(index) {
            Some(b'{') if bytes.get(index + 1) == Some(&b'{') => {
                value.push('{');
                index += 2;
            }
            Some(b'}') if bytes.get(index + 1) == Some(&b'}') => {
                value.push('}');
                index += 2;
            }
            Some(b'{') => match read_placeholder(template, index) {
                Some((name, next)) => {
                    match params.get(name) {
                        Some(replacement) => value.push_str(replacement),
                        None => {
                            if !missing.iter().any(|m| m == name) {
                                missing.push(name.to_owned());
                            }
                            value.push('{');
                            value.push_str(name);
                            value.push('}');
                        }
                    }
                    index = next;
                }
                None => {
                    value.push('{');
                    index += 1;
                }
            },
            _ => {
                let ch = next_char(template, index);
                value.push_str(ch);
                index += ch.len();
            }
        }
    }

    Interpolation { value, missing }
}

/// Parse a rich message into a node tree.
///
/// Lenient by design: an unmatched closing tag, an unclosed opening tag or a
/// `<` that is not a tag all degrade to literal text. A broken message shows
/// its own markup instead of disappearing.
pub fn tokenize(template: &str) -> Vec<Node> {
    let bytes = template.as_bytes();
    let mut stack: Vec<Frame> = vec![Frame::root()];
    let mut text = String::new();
    let mut index = 0;

    while index < bytes.len() {
        match bytes.get(index) {
            Some(b'{') if bytes.get(index + 1) == Some(&b'{') => {
                text.push('{');
                index += 2;
            }
            Some(b'}') if bytes.get(index + 1) == Some(&b'}') => {
                text.push('}');
                index += 2;
            }
            Some(b'{') => match read_placeholder(template, index) {
                Some((name, next)) => {
                    push_text(&mut stack, &mut text);
                    push_node(
                        &mut stack,
                        Node::Param {
                            name: name.to_owned(),
                        },
                    );
                    index = next;
                }
                None => {
                    text.push('{');
                    index += 1;
                }
            },
            Some(b'<') => match read_tag(template, index) {
                Some((tag, next)) => {
                    match tag {
                        Tag::Open(name) => {
                            push_text(&mut stack, &mut text);
                            stack.push(Frame {
                                open: Some(OpenTag {
                                    name: name.to_owned(),
                                    // Kept verbatim so an unclosed tag degrades
                                    // to exactly what the author wrote.
                                    raw: template.get(index..next).unwrap_or_default().to_owned(),
                                }),
                                children: Vec::new(),
                            });
                        }
                        Tag::SelfClosing(name) => {
                            push_text(&mut stack, &mut text);
                            push_node(
                                &mut stack,
                                Node::Tag {
                                    name: name.to_owned(),
                                    children: Vec::new(),
                                },
                            );
                        }
                        Tag::Close(name) => {
                            let matches_top = stack
                                .last()
                                .and_then(|frame| frame.open.as_ref())
                                .is_some_and(|open| open.name == name);

                            if matches_top {
                                push_text(&mut stack, &mut text);
                                if let Some(frame) = stack.pop() {
                                    if let Some(open) = frame.open {
                                        push_node(
                                            &mut stack,
                                            Node::Tag {
                                                name: open.name,
                                                children: frame.children,
                                            },
                                        );
                                    }
                                }
                            } else {
                                // Stray close tag: keep it visible, and keep it
                                // exactly as written. Re-emitting the parsed
                                // name would quietly rewrite the author's text
                                // (`</ b>` becoming `</b>`).
                                text.push_str(template.get(index..next).unwrap_or_default());
                            }
                        }
                    }
                    index = next;
                }
                None => {
                    text.push('<');
                    index += 1;
                }
            },
            _ => {
                let ch = next_char(template, index);
                text.push_str(ch);
                index += ch.len();
            }
        }
    }

    push_text(&mut stack, &mut text);

    // Unclosed tags degrade to their literal markup followed by their contents.
    while stack.len() > 1 {
        let Some(frame) = stack.pop() else {
            break;
        };
        let Some(open) = frame.open else { break };
        if let Some(parent) = stack.last_mut() {
            parent.children.push(Node::Text { value: open.raw });
            parent.children.extend(frame.children);
        }
    }

    stack.pop().map(|frame| frame.children).unwrap_or_default()
}

/// An open `<tag>` waiting for its close, plus the exact markup that opened it.
struct OpenTag {
    name: String,
    raw: String,
}

/// One level of the tokeniser's stack.
struct Frame {
    open: Option<OpenTag>,
    children: Vec<Node>,
}

impl Frame {
    fn root() -> Self {
        Self {
            open: None,
            children: Vec::new(),
        }
    }
}

/// Render a node tree back to plain text, dropping tag markup and substituting
/// parameters. Used when `t()` is called on a message that contains tags.
pub fn flatten(nodes: &[Node], params: &BTreeMap<String, String>) -> String {
    let mut out = String::new();
    for node in nodes {
        match node {
            Node::Text { value } => out.push_str(value),
            Node::Param { name } => match params.get(name) {
                Some(value) => out.push_str(value),
                None => out.push_str(&format!("{{{name}}}")),
            },
            Node::Tag { children, .. } => out.push_str(&flatten(children, params)),
        }
    }
    out
}

enum Tag<'a> {
    Open(&'a str),
    Close(&'a str),
    SelfClosing(&'a str),
}

fn push_text(stack: &mut [Frame], text: &mut String) {
    if text.is_empty() {
        return;
    }
    let value = core::mem::take(text);
    if let Some(frame) = stack.last_mut() {
        frame.children.push(Node::Text { value });
    }
}

fn push_node(stack: &mut [Frame], node: Node) {
    if let Some(frame) = stack.last_mut() {
        frame.children.push(node);
    }
}

/// Read the character starting at `index` as a string slice, so multi-byte
/// characters are copied whole.
fn next_char(input: &str, index: usize) -> &str {
    let rest = input.get(index..).unwrap_or_default();
    match rest.chars().next() {
        Some(ch) => rest.get(..ch.len_utf8()).unwrap_or_default(),
        None => "",
    }
}

/// Read `{name}` starting at `index`, returning the name and the index after
/// the closing brace.
fn read_placeholder(input: &str, index: usize) -> Option<(&str, usize)> {
    let rest = input.get(index + 1..)?;
    let end = rest.find('}')?;
    let name = rest.get(..end)?.trim();

    if name.is_empty() || !is_identifier(name) {
        return None;
    }

    Some((name, index + 1 + end + 1))
}

/// Read a tag starting at `index`, returning it and the index after `>`.
fn read_tag(input: &str, index: usize) -> Option<(Tag<'_>, usize)> {
    let rest = input.get(index + 1..)?;
    let end = rest.find('>')?;
    let inner = rest.get(..end)?;
    let next = index + 1 + end + 1;

    if let Some(name) = inner.strip_prefix('/') {
        let name = name.trim();
        return is_tag_name(name).then_some((Tag::Close(name), next));
    }

    if let Some(name) = inner.strip_suffix('/') {
        let name = name.trim();
        return is_tag_name(name).then_some((Tag::SelfClosing(name), next));
    }

    let name = inner.trim();
    is_tag_name(name).then_some((Tag::Open(name), next))
}

fn is_identifier(value: &str) -> bool {
    let mut chars = value.chars();
    let first = chars
        .next()
        .is_some_and(|c| c.is_ascii_alphabetic() || c == '_');
    first && chars.all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '.' || c == '-')
}

fn is_tag_name(value: &str) -> bool {
    let mut chars = value.chars();
    let first = chars.next().is_some_and(|c| c.is_ascii_alphabetic());
    first && chars.all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}
