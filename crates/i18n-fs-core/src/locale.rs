//! BCP-47 tag parsing and `Accept-Language` negotiation (RFC 4647 Lookup).
//!
//! This module is part of the `minimal` build: it is the only message-agnostic
//! work the Edge middleware needs, alongside [`crate::routing`].

use core::fmt;

/// A parsed, normalised BCP-47 language tag.
///
/// Only the subtags that matter for matching are retained. Extensions and
/// private-use subtags are accepted by the parser but dropped, because RFC 4647
/// Lookup removes them before comparing anyway.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct LanguageTag {
    language: String,
    script: Option<String>,
    region: Option<String>,
    variants: Vec<String>,
}

impl LanguageTag {
    /// Parse a language tag, returning `None` if it is not well-formed.
    ///
    /// Normalisation follows the BCP-47 recommendation: language lowercase,
    /// script title case, region uppercase, variants lowercase.
    pub fn parse(input: &str) -> Option<Self> {
        let input = input.trim();
        if input.is_empty() || !input.is_ascii() {
            return None;
        }

        let mut parts = input.split(['-', '_']).peekable();

        let language = parts.next()?;
        if !is_language_subtag(language) {
            return None;
        }

        let mut tag = Self {
            language: language.to_ascii_lowercase(),
            script: None,
            region: None,
            variants: Vec::new(),
        };

        if let Some(candidate) = parts.peek() {
            if is_script_subtag(candidate) {
                tag.script = Some(title_case(candidate));
                parts.next();
            }
        }

        if let Some(candidate) = parts.peek() {
            if is_region_subtag(candidate) {
                tag.region = Some(candidate.to_ascii_uppercase());
                parts.next();
            }
        }

        for candidate in parts {
            if is_variant_subtag(candidate) {
                tag.variants.push(candidate.to_ascii_lowercase());
            } else if is_singleton(candidate) {
                // Extension or private-use sequence: everything after it is
                // irrelevant to Lookup matching.
                break;
            } else {
                return None;
            }
        }

        Some(tag)
    }

    /// The primary language subtag, e.g. `fa`.
    pub fn language(&self) -> &str {
        &self.language
    }

    /// The script subtag, e.g. `Arab`.
    pub fn script(&self) -> Option<&str> {
        self.script.as_deref()
    }

    /// The region subtag, e.g. `IR`.
    pub fn region(&self) -> Option<&str> {
        self.region.as_deref()
    }

    /// The normalised subtags, most significant first.
    pub fn subtags(&self) -> Vec<&str> {
        let mut out = Vec::with_capacity(2 + self.variants.len());
        out.push(self.language.as_str());
        if let Some(script) = &self.script {
            out.push(script.as_str());
        }
        if let Some(region) = &self.region {
            out.push(region.as_str());
        }
        out.extend(self.variants.iter().map(String::as_str));
        out
    }

    /// Whether `self` is `range` or a more specific form of it, i.e. whether
    /// `range`'s subtags are a prefix of `self`'s.
    ///
    /// `fa-IR.is_covered_by(fa)` is true; `fa.is_covered_by(fa-IR)` is not.
    ///
    /// Note the direction when using this for RFC 4647 Lookup: Lookup truncates
    /// the *range*, so it asks `range.is_covered_by(supported_tag)`.
    pub fn is_covered_by(&self, range: &Self) -> bool {
        let own = self.subtags();
        let wanted = range.subtags();

        if wanted.len() > own.len() {
            return false;
        }

        wanted
            .iter()
            .zip(own.iter())
            .all(|(a, b)| a.eq_ignore_ascii_case(b))
    }
}

impl fmt::Display for LanguageTag {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.subtags().join("-"))
    }
}

fn is_language_subtag(value: &str) -> bool {
    matches!(value.len(), 2..=3 | 5..=8) && value.chars().all(|c| c.is_ascii_alphabetic())
}

fn is_script_subtag(value: &str) -> bool {
    value.len() == 4 && value.chars().all(|c| c.is_ascii_alphabetic())
}

fn is_region_subtag(value: &str) -> bool {
    (value.len() == 2 && value.chars().all(|c| c.is_ascii_alphabetic()))
        || (value.len() == 3 && value.chars().all(|c| c.is_ascii_digit()))
}

fn is_variant_subtag(value: &str) -> bool {
    match value.len() {
        5..=8 => value.chars().all(|c| c.is_ascii_alphanumeric()),
        4 => {
            let mut chars = value.chars();
            let first = chars.next().is_some_and(|c| c.is_ascii_digit());
            first && chars.all(|c| c.is_ascii_alphanumeric())
        }
        _ => false,
    }
}

fn is_singleton(value: &str) -> bool {
    value.len() == 1 && value.chars().all(|c| c.is_ascii_alphanumeric())
}

fn title_case(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for (index, ch) in value.chars().enumerate() {
        if index == 0 {
            out.extend(ch.to_uppercase());
        } else {
            out.extend(ch.to_lowercase());
        }
    }
    out
}

/// One entry of an `Accept-Language` header.
#[derive(Debug, Clone, PartialEq)]
pub struct LanguageRange {
    /// The raw range as sent by the client, e.g. `fa-IR` or `*`.
    pub range: String,
    /// Quality value in `[0.0, 1.0]`.
    pub quality: f32,
}

impl LanguageRange {
    /// Whether this range is the wildcard `*`.
    pub fn is_wildcard(&self) -> bool {
        self.range == "*"
    }
}

/// Parse an `Accept-Language` header into ranges ordered by descending quality.
///
/// Entries with `q=0` are dropped: RFC 9110 defines them as explicit refusals.
/// Ordering is stable, so equal-quality entries keep their header order.
pub fn parse_accept_language(header: &str) -> Vec<LanguageRange> {
    let mut ranges: Vec<LanguageRange> = header
        .split(',')
        .filter_map(|entry| {
            let mut parts = entry.split(';');
            let range = parts.next()?.trim();
            if range.is_empty() {
                return None;
            }

            let mut quality = 1.0_f32;
            for param in parts {
                let param = param.trim();
                if let Some(value) = param
                    .strip_prefix("q=")
                    .or_else(|| param.strip_prefix("Q="))
                {
                    quality = value.trim().parse::<f32>().unwrap_or(0.0);
                }
            }

            // `q=0` is an explicit refusal (RFC 9110); a malformed or
            // non-finite quality is treated the same way.
            if !quality.is_finite() || quality <= 0.0 {
                return None;
            }

            Some(LanguageRange {
                range: range.to_owned(),
                quality: quality.clamp(0.0, 1.0),
            })
        })
        .collect();

    // `sort_by` is stable, so equal qualities preserve header order.
    ranges.sort_by(|a, b| {
        b.quality
            .partial_cmp(&a.quality)
            .unwrap_or(core::cmp::Ordering::Equal)
    });

    ranges
}

/// How a locale was matched, for diagnostics and tests.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MatchKind {
    /// RFC 4647 Lookup: the supported tag is the range or a refinement of it.
    Lookup,
    /// The primary language subtag matched but the range was more specific than
    /// anything we ship (client asked for `fa`, we only ship `fa-IR`).
    LanguageFallback,
    /// Nothing matched; the configured default was used.
    Default,
}

/// Result of negotiating a locale.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Negotiated {
    /// The chosen locale, spelled exactly as it appears in the configuration.
    pub locale: String,
    /// How it was chosen.
    pub kind: MatchKind,
}

/// Pick the best supported locale for an `Accept-Language` header.
///
/// Ranges are tried in quality order. For each range we first run RFC 4647
/// Lookup, then a primary-language fallback, before moving to the next range —
/// so a client's stated preference order always wins over match precision.
///
/// This never falls back to another locale's *content*; it only decides which
/// locale is active.
pub fn negotiate(header: &str, supported: &[String], default_locale: &str) -> Negotiated {
    let parsed: Vec<(usize, LanguageTag)> = supported
        .iter()
        .enumerate()
        .filter_map(|(index, tag)| LanguageTag::parse(tag).map(|parsed| (index, parsed)))
        .collect();

    let fallback = || Negotiated {
        locale: default_locale.to_owned(),
        kind: MatchKind::Default,
    };

    if parsed.is_empty() {
        return fallback();
    }

    let pick = |index: usize, kind: MatchKind| {
        supported.get(index).map(|locale| Negotiated {
            locale: locale.clone(),
            kind,
        })
    };

    for entry in parse_accept_language(header) {
        if entry.is_wildcard() {
            continue;
        }

        let Some(range) = LanguageTag::parse(&entry.range) else {
            continue;
        };

        // RFC 4647 Lookup truncates the *range* until it equals a supported
        // tag, so a tag matches when its subtags are a prefix of the range's.
        // Truncation happens longest-first, so the most specific supported tag
        // wins: with `fa` and `fa-IR` both shipped, the range `fa-IR` picks
        // `fa-IR`.
        let lookup = parsed
            .iter()
            .filter(|(_, tag)| range.is_covered_by(tag))
            .max_by_key(|(_, tag)| tag.subtags().len());
        if let Some((index, _)) = lookup {
            if let Some(result) = pick(*index, MatchKind::Lookup) {
                return result;
            }
        }

        let language_match = parsed
            .iter()
            .find(|(_, tag)| tag.language().eq_ignore_ascii_case(range.language()));
        if let Some((index, _)) = language_match {
            if let Some(result) = pick(*index, MatchKind::LanguageFallback) {
                return result;
            }
        }
    }

    fallback()
}
