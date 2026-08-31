//! Placeholder interpolation, plural selection and rich-text tokenisation.
//!
//! The template language:
//!
//! - `{name}` is a placeholder. `{{` and `}}` are literal braces.
//! - `<tag>...</tag>` and `<tag />` delimit a region the caller renders itself.
//! - `{n, plural, one {# file} other {# files}}` picks an arm by grammatical
//!   number, `{n, selectordinal, …}` by ordinal position, and
//!   `{n, select, …}` by exact value. Inside a plural arm, `#` is the argument
//!   formatted for the locale, and `##` is a literal `#`.
//!
//! Which arm a number needs is a property of the language, not of this crate:
//! `one` covers 1 and 21 in Russian but only 1 in English, and Arabic has six
//! arms. Those rules are CLDR's, every JavaScript runtime already ships them in
//! `Intl.PluralRules`, and a copy compiled in here would be a lookup table in a
//! binary that gets downloaded. So the host picks the category and hands it over
//! as a [`PluralArg`]; this crate decides only which arm that category selects.
//!
//! Braces inside an arm are structural, and `{{`/`}}` are *not* escapes there.
//! They cannot be: an arm that opens with a placeholder — `other {{name} won}` —
//! is ordinary, and an escape rule would read its first two braces as a literal
//! `{`. ICU resolves the same ambiguity by quoting with apostrophes, which turns
//! every `don't` in a message into a trap. Keeping the escape at the top level
//! and dropping it inside arms costs a literal brace in a position nobody writes
//! one, and leaves existing messages alone.
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

/// How deeply `{…}` arguments may nest before parsing stops descending.
///
/// Messages are written by developers, not submitted by users, so this is not a
/// defence — it is a guarantee that a malformed file cannot exhaust the stack
/// and take a request down with it.
const MAX_DEPTH: usize = 32;

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
	/// The `#` inside a plural arm: the argument, formatted for the locale.
	Number,
	/// A `{n, plural, …}` or `{n, selectordinal, …}` argument.
	Plural {
		/// Argument name.
		name: String,
		/// `true` for `selectordinal`, which asks for 1st/2nd/3rd rather than
		/// one/two/few — a different set of categories for the same number.
		ordinal: bool,
		/// The arms, in the order they were written.
		arms: Vec<Arm>,
	},
	/// A `{n, select, …}` argument, matched on the value itself.
	Select {
		/// Argument name.
		name: String,
		/// The arms, in the order they were written.
		arms: Vec<Arm>,
	},
}

/// One `key {content}` arm of a plural or select argument.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Arm {
	/// `=0`, a CLDR category (`one`, `few`, …), or a `select` value.
	pub key: String,
	/// What the arm renders.
	pub children: Vec<Node>,
}

/// What the host runtime's `Intl` knows about one numeric argument.
///
/// Supplied per call rather than derived here — see the module documentation
/// for why the CLDR tables stay out of the binary.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct PluralArg {
	/// `Intl.PluralRules(locale).select(value)` — `one`, `few`, `other`, …
	pub cardinal: String,
	/// `Intl.PluralRules(locale, { type: 'ordinal' }).select(value)`.
	pub ordinal: String,
	/// `Intl.NumberFormat(locale).format(value)` — what `#` renders as.
	pub formatted: String,
}

/// Result of rendering a plain message.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Interpolation {
	/// The rendered string.
	pub value: String,
	/// Placeholders that had no matching parameter, in order of appearance and
	/// de-duplicated. Their `{name}` markers are left intact in `value` so the
	/// gap is visible rather than silently blank.
	pub missing: Vec<String>,
	/// Arguments used with `plural` or `selectordinal` whose value was not a
	/// number, so no category could be computed for them.
	pub not_numeric: Vec<String>,
	/// Arguments that matched no arm and had no `other` to fall back to.
	pub unmatched: Vec<String>,
}

/// Substitute `{name}` placeholders. Tags are left untouched.
///
/// `{{` and `}}` produce literal braces. An unterminated or malformed `{...}`
/// is emitted verbatim rather than swallowed.
///
/// No plural arguments are available through this entry point, so a `plural` or
/// `selectordinal` argument falls to its `other` arm. Callers that can compute
/// categories use [`interpolate_with`].
pub fn interpolate(template: &str, params: &BTreeMap<String, String>) -> Interpolation {
	interpolate_with(template, params, &BTreeMap::new())
}

/// Substitute placeholders and select plural, ordinal and select arms.
pub fn interpolate_with(
	template: &str,
	params: &BTreeMap<String, String>,
	plurals: &BTreeMap<String, PluralArg>,
) -> Interpolation {
	let mut render = Render {
		params,
		plurals,
		missing: Vec::new(),
		not_numeric: Vec::new(),
		unmatched: Vec::new(),
	};

	let mut value = String::with_capacity(template.len());
	render.run(template, &mut value, true, None, 0);

	Interpolation {
		value,
		missing: render.missing,
		not_numeric: render.not_numeric,
		unmatched: render.unmatched,
	}
}

/// The state of one `interpolate` call, threaded through the recursion.
struct Render<'a> {
	params: &'a BTreeMap<String, String>,
	plurals: &'a BTreeMap<String, PluralArg>,
	missing: Vec<String>,
	not_numeric: Vec<String>,
	unmatched: Vec<String>,
}

impl Render<'_> {
	/// Render `template` into `out`.
	///
	/// `escapes` is off inside an arm, where braces are structural. `sharp` is
	/// the formatted value of the enclosing plural argument, or `None` outside
	/// one — where `#` is ordinary text.
	fn run(
		&mut self,
		template: &str,
		out: &mut String,
		escapes: bool,
		sharp: Option<&str>,
		depth: usize,
	) {
		let bytes = template.as_bytes();
		let mut index = 0;

		while index < bytes.len() {
			match bytes.get(index) {
				Some(b'{') if escapes && bytes.get(index + 1) == Some(&b'{') => {
					out.push('{');
					index += 2;
				}
				Some(b'}') if escapes && bytes.get(index + 1) == Some(&b'}') => {
					out.push('}');
					index += 2;
				}
				Some(b'#') => {
					match sharp {
						// `##` is a literal `#`, but only where `#` means
						// something. Outside an arm it is already literal, and
						// rewriting it there would change existing messages.
						Some(_) if bytes.get(index + 1) == Some(&b'#') => {
							out.push('#');
							index += 2;
						}
						Some(formatted) => {
							out.push_str(formatted);
							index += 1;
						}
						None => {
							out.push('#');
							index += 1;
						}
					}
				}
				Some(b'{') => {
					// A plain placeholder is tried first because it is both the
					// cheap check and the common one. The order is safe rather
					// than merely lucky: an argument's header always contains
					// `, keyword, `, and `is_identifier` rejects commas and
					// spaces, so `{n, plural, …}` cannot be mistaken for one.
					// Trying the argument first cost 11% on messages that have
					// no arguments in them at all.
					match read_placeholder(template, index) {
						Some((name, next)) => {
							match self.params.get(name) {
								Some(replacement) => out.push_str(replacement),
								None => {
									note(&mut self.missing, name);
									out.push('{');
									out.push_str(name);
									out.push('}');
								}
							}
							index = next;
						}
						None => match read_argument(template, index, depth) {
							Some((argument, next)) => {
								self.argument(&argument, out, depth);
								index = next;
							}
							None => {
								out.push('{');
								index += 1;
							}
						},
					}
				}
				_ => {
					let ch = next_char(template, index);
					out.push_str(ch);
					index += ch.len();
				}
			}
		}
	}

	/// Choose an arm and render it.
	fn argument(&mut self, argument: &Argument<'_>, out: &mut String, depth: usize) {
		let Some(value) = self.params.get(argument.name).map(String::as_str) else {
			// Same treatment as a bare placeholder with no value: report it, and
			// leave the marker where the reader can see something is missing.
			// Rendering `other` instead would print "# files" with no number.
			note(&mut self.missing, argument.name);
			out.push('{');
			out.push_str(argument.name);
			out.push('}');
			return;
		};

		let plural = match argument.kind {
			ArgKind::Select => None,
			_ => {
				let found = self.plurals.get(argument.name);
				if found.is_none() {
					note(&mut self.not_numeric, argument.name);
				}
				found
			}
		};

		let category = plural.map(|arg| match argument.kind {
			ArgKind::Ordinal => arg.ordinal.as_str(),
			_ => arg.cardinal.as_str(),
		});

		let Some(content) = pick(argument, value, category) else {
			note(&mut self.unmatched, argument.name);
			out.push('{');
			out.push_str(argument.name);
			out.push('}');
			return;
		};

		self.run(
			content,
			out,
			false,
			plural.map(|arg| arg.formatted.as_str()),
			depth + 1,
		);
	}
}

/// Record a name once, keeping first-seen order.
fn note(seen: &mut Vec<String>, name: &str) {
	if !seen.iter().any(|entry| entry == name) {
		seen.push(name.to_owned());
	}
}

/// Which arm an argument selects, or `None` when nothing matched and there is
/// no `other`.
///
/// `=0` and friends are tried first and beat the category, so "no items at all"
/// can be written without disturbing the grammatical arms around it.
fn pick<'a>(argument: &Argument<'a>, value: &str, category: Option<&str>) -> Option<&'a str> {
	for arm in &argument.arms {
		if let Some(exact) = arm.key.strip_prefix('=') {
			if same_number(exact, value) {
				return Some(arm.content);
			}
		}
	}

	let wanted = match argument.kind {
		ArgKind::Select => Some(value),
		_ => category,
	};

	if let Some(wanted) = wanted {
		for arm in &argument.arms {
			if arm.key == wanted {
				return Some(arm.content);
			}
		}
	}

	argument
		.arms
		.iter()
		.find(|arm| arm.key == "other")
		.map(|arm| arm.content)
}

/// Whether two written numbers are the same number.
///
/// `=0` has to match a parameter stringified as `0`, and `=1.5` one written
/// `1.50`. Values that are not numbers fall back to comparing the text, which
/// is what a `select` arm wants anyway.
///
/// Compared as digits rather than by parsing to `f64`, which is not a
/// micro-optimisation: Rust's string-to-float conversion is a large algorithm,
/// and linking it added 13.3 KB gzip to the binary the browser downloads — more
/// than a fifth again on top of the whole package, to compare `=0` against `0`.
/// This is also exact, where the float round-trip is only nearly so.
fn same_number(left: &str, right: &str) -> bool {
	match (digits(left), digits(right)) {
		(Some(a), Some(b)) => a == b,
		// Not both numbers, so the only sensible question left is whether the
		// text matches.
		_ => left == right,
	}
}

/// Split a written decimal into sign, integer digits and fraction digits, with
/// the insignificant zeros removed, so that two spellings of one number compare
/// equal. `None` for anything that is not a plain decimal.
fn digits(value: &str) -> Option<(bool, &str, &str)> {
	let value = value.trim();

	let (negative, rest) = match value.strip_prefix('-') {
		Some(rest) => (true, rest),
		None => (false, value.strip_prefix('+').unwrap_or(value)),
	};

	let (integer, fraction) = match rest.split_once('.') {
		Some((integer, fraction)) => (integer, fraction),
		None => (rest, ""),
	};

	if integer.is_empty() && fraction.is_empty() {
		return None;
	}

	if !integer
		.bytes()
		.chain(fraction.bytes())
		.all(|b| b.is_ascii_digit())
	{
		return None;
	}

	let integer = integer.trim_start_matches('0');
	let fraction = fraction.trim_end_matches('0');

	// `-0` and `0` are the same number, and a sign on zero would make them
	// differ.
	let negative = negative && !(integer.is_empty() && fraction.is_empty());

	Some((negative, integer, fraction))
}

/// What kind of argument was written.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ArgKind {
	Plural,
	Ordinal,
	Select,
}

/// One arm as it appears in the source, before its content is parsed.
struct RawArm<'a> {
	key: &'a str,
	content: &'a str,
}

/// A parsed `{name, kind, arms…}` argument, borrowing from the template.
struct Argument<'a> {
	name: &'a str,
	kind: ArgKind,
	arms: Vec<RawArm<'a>>,
}

/// Read `{name, plural, …}` starting at `index`, returning it and the index
/// after the closing brace.
///
/// `None` for anything that is not one of these — a plain `{placeholder}`, an
/// unknown keyword, or an unterminated argument — so the caller can fall
/// through to the simpler forms and, failing those, emit the brace verbatim.
fn read_argument<'a>(input: &'a str, index: usize, depth: usize) -> Option<(Argument<'a>, usize)> {
	if depth >= MAX_DEPTH {
		return None;
	}

	let rest = input.get(index + 1..)?;

	// Bounded by the first `}`, so a plain `{name}` cannot reach for a comma
	// belonging to a later argument.
	let stop = rest.find([',', '}'])?;
	if rest.as_bytes().get(stop) != Some(&b',') {
		return None;
	}

	let name = rest.get(..stop)?.trim();
	if !is_identifier(name) {
		return None;
	}

	let tail = rest.get(stop + 1..)?;
	let keyword_end = tail.find([',', '}'])?;
	if tail.as_bytes().get(keyword_end) != Some(&b',') {
		return None;
	}

	let kind = match tail.get(..keyword_end)?.trim() {
		"plural" => ArgKind::Plural,
		"selectordinal" => ArgKind::Ordinal,
		"select" => ArgKind::Select,
		_ => return None,
	};

	let mut cursor = index + 1 + stop + 1 + keyword_end + 1;
	let mut arms: Vec<RawArm<'a>> = Vec::new();

	loop {
		cursor = skip_space(input, cursor);

		match input.as_bytes().get(cursor) {
			// A complete argument needs at least one arm; `{n, plural, }` is
			// not one, and is better left as literal text than rendered blank.
			Some(b'}') => {
				return (!arms.is_empty()).then_some((Argument { name, kind, arms }, cursor + 1));
			}
			None => return None,
			_ => {}
		}

		let key_start = cursor;
		while let Some(byte) = input.as_bytes().get(cursor) {
			if byte.is_ascii_whitespace() || *byte == b'{' || *byte == b'}' {
				break;
			}
			cursor += 1;
		}

		let key = input.get(key_start..cursor)?;
		if !is_arm_key(key) {
			return None;
		}

		cursor = skip_space(input, cursor);
		let (content, next) = read_braced(input, cursor)?;

		arms.push(RawArm { key, content });
		cursor = next;
	}
}

/// Read a `{…}` region starting at `index`, returning its contents and the
/// index after the closing brace.
///
/// Braces are counted structurally: `{{` is not an escape here, because an arm
/// that starts with a placeholder opens with two braces that are both real.
fn read_braced(input: &str, index: usize) -> Option<(&str, usize)> {
	let bytes = input.as_bytes();
	if bytes.get(index) != Some(&b'{') {
		return None;
	}

	let mut depth = 0usize;
	let mut cursor = index;

	while let Some(byte) = bytes.get(cursor) {
		match byte {
			b'{' => {
				depth += 1;
				cursor += 1;
			}
			b'}' => {
				depth -= 1;
				cursor += 1;
				if depth == 0 {
					return Some((input.get(index + 1..cursor - 1)?, cursor));
				}
			}
			_ => cursor += 1,
		}
	}

	None
}

fn skip_space(input: &str, mut index: usize) -> usize {
	while input
		.as_bytes()
		.get(index)
		.is_some_and(u8::is_ascii_whitespace)
	{
		index += 1;
	}
	index
}

/// Whether `value` can name an arm: `=` followed by a number, or a bare word.
fn is_arm_key(value: &str) -> bool {
	if value.is_empty() {
		return false;
	}

	if let Some(exact) = value.strip_prefix('=') {
		return digits(exact).is_some();
	}

	// `select` arms match arbitrary values, so this is deliberately wider than
	// the CLDR categories — a message may switch on a status or a role.
	value
		.chars()
		.all(|c| c.is_alphanumeric() || c == '_' || c == '-' || c == '.')
}

/// Parse a rich message into a node tree.
///
/// Lenient by design: an unmatched closing tag, an unclosed opening tag or a
/// `<` that is not a tag all degrade to literal text. A broken message shows
/// its own markup instead of disappearing.
pub fn tokenize(template: &str) -> Vec<Node> {
	tokenize_inner(template, true, false, 0)
}

/// `escapes` is off inside an arm; `sharp` is on inside a plural arm, where `#`
/// becomes a [`Node::Number`] rather than text.
fn tokenize_inner(template: &str, escapes: bool, sharp: bool, depth: usize) -> Vec<Node> {
	let bytes = template.as_bytes();
	let mut stack: Vec<Frame> = vec![Frame::root()];
	let mut text = String::new();
	let mut index = 0;

	while index < bytes.len() {
		match bytes.get(index) {
			Some(b'{') if escapes && bytes.get(index + 1) == Some(&b'{') => {
				text.push('{');
				index += 2;
			}
			Some(b'}') if escapes && bytes.get(index + 1) == Some(&b'}') => {
				text.push('}');
				index += 2;
			}
			Some(b'#') if sharp => {
				if bytes.get(index + 1) == Some(&b'#') {
					text.push('#');
					index += 2;
				} else {
					push_text(&mut stack, &mut text);
					push_node(&mut stack, Node::Number);
					index += 1;
				}
			}
			Some(b'{') => {
				// Cheap check first; see the note in `Render::run`.
				match read_placeholder(template, index) {
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
					None => match read_argument(template, index, depth) {
						Some((argument, next)) => {
							push_text(&mut stack, &mut text);
							push_node(&mut stack, node_for(&argument, depth));
							index = next;
						}
						None => {
							text.push('{');
							index += 1;
						}
					},
				}
			}
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

/// Turn a parsed argument into its node, tokenising each arm's contents.
fn node_for(argument: &Argument<'_>, depth: usize) -> Node {
	let ordinal = matches!(argument.kind, ArgKind::Ordinal);
	let sharp = !matches!(argument.kind, ArgKind::Select);

	let arms = argument
		.arms
		.iter()
		.map(|arm| Arm {
			key: arm.key.to_owned(),
			children: tokenize_inner(arm.content, false, sharp, depth + 1),
		})
		.collect();

	if matches!(argument.kind, ArgKind::Select) {
		Node::Select {
			name: argument.name.to_owned(),
			arms,
		}
	} else {
		Node::Plural {
			name: argument.name.to_owned(),
			ordinal,
			arms,
		}
	}
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
	flatten_with(nodes, params, &BTreeMap::new())
}

/// Render a node tree back to plain text, selecting plural and select arms.
pub fn flatten_with(
	nodes: &[Node],
	params: &BTreeMap<String, String>,
	plurals: &BTreeMap<String, PluralArg>,
) -> String {
	let mut out = String::new();
	write_nodes(nodes, params, plurals, None, &mut out);
	out
}

fn write_nodes(
	nodes: &[Node],
	params: &BTreeMap<String, String>,
	plurals: &BTreeMap<String, PluralArg>,
	sharp: Option<&str>,
	out: &mut String,
) {
	for node in nodes {
		match node {
			Node::Text { value } => out.push_str(value),
			Node::Number => out.push_str(sharp.unwrap_or("#")),
			Node::Param { name } => match params.get(name) {
				Some(value) => out.push_str(value),
				None => {
					out.push('{');
					out.push_str(name);
					out.push('}');
				}
			},
			Node::Tag { children, .. } => write_nodes(children, params, plurals, sharp, out),
			Node::Plural {
				name,
				ordinal,
				arms,
			} => write_arm(name, arms, *ordinal, false, params, plurals, out),
			Node::Select { name, arms } => {
				write_arm(name, arms, false, true, params, plurals, out);
			}
		}
	}
}

#[allow(clippy::too_many_arguments)]
fn write_arm(
	name: &str,
	arms: &[Arm],
	ordinal: bool,
	select: bool,
	params: &BTreeMap<String, String>,
	plurals: &BTreeMap<String, PluralArg>,
	out: &mut String,
) {
	let Some(value) = params.get(name).map(String::as_str) else {
		out.push('{');
		out.push_str(name);
		out.push('}');
		return;
	};

	let plural = if select { None } else { plurals.get(name) };
	let category = plural.map(|arg| {
		if ordinal {
			arg.ordinal.as_str()
		} else {
			arg.cardinal.as_str()
		}
	});

	// The same choice `pick` makes, over already-parsed arms. Both walk the
	// arms in written order and try `=n`, then the category, then `other`; the
	// property test that renders every template through both paths is what
	// keeps them saying the same thing.
	let chosen = arms
		.iter()
		.find(|arm| {
			arm.key
				.strip_prefix('=')
				.is_some_and(|exact| same_number(exact, value))
		})
		.or_else(|| {
			let wanted = if select { Some(value) } else { category };
			wanted.and_then(|wanted| arms.iter().find(|arm| arm.key == wanted))
		})
		.or_else(|| arms.iter().find(|arm| arm.key == "other"));

	let Some(arm) = chosen else {
		out.push('{');
		out.push_str(name);
		out.push('}');
		return;
	};

	write_nodes(
		&arm.children,
		params,
		plurals,
		plural.map(|arg| arg.formatted.as_str()),
		out,
	);
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
