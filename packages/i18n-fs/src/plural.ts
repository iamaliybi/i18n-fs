/**
 * What the runtime knows about the numbers passed to a message.
 *
 * Choosing between `# file` and `# files` is not arithmetic. Russian needs
 * three forms and puts 21 back with 1; Arabic has six and a separate one for
 * exactly two; Persian counts 0 as singular. Those rules are CLDR's, they are
 * long, and every JavaScript runtime already ships them in `Intl.PluralRules` —
 * including the Edge one. So the category is computed here and handed to the
 * WebAssembly core, which decides only which arm that category selects. The
 * alternative, compiling the tables into the core, would put a copy of CLDR
 * into a binary that gets downloaded.
 *
 * Nothing here allocates on a message that has no numbers in it.
 */

import type { TranslationParams, RichTranslationParams } from './translator.js';

/** One numeric argument, as `Intl` describes it. */
export interface PluralArg {
	/** `one`, `few`, `other`, … for counting. */
	cardinal: string;
	/** The same for ranking: 1st, 2nd, 3rd. A different question about the
	 * same number, and the two disagree — 2 is `other` as a cardinal and `two`
	 * as an ordinal. */
	ordinal: string;
	/** The number as this locale writes it, which is what `#` renders as. */
	formatted: string;
}

/**
 * Constructing an `Intl` object is the expensive part; using it is not. These
 * are keyed by locale and live for the process, which for a server is the
 * lifetime of the worker and for a browser is the lifetime of the tab.
 */
const cardinals = new Map<string, Intl.PluralRules | null>();
const ordinals = new Map<string, Intl.PluralRules | null>();
const numbers = new Map<string, Intl.NumberFormat | null>();

/**
 * Build one, or remember that this runtime would not.
 *
 * A malformed tag makes every `Intl` constructor throw, and one bad locale in a
 * config should not take down every page that renders a number. `null` is
 * cached so the failure costs one attempt rather than one per call, and the
 * message then falls to its `other` arm — reported, not silently substituted
 * with another language's grammar.
 */
function build<T>(cache: Map<string, T | null>, locale: string, make: () => T): T | null {
	const cached = cache.get(locale);
	if (cached !== undefined) return cached;

	let made: T | null;
	try {
		made = make();
	} catch {
		made = null;
	}

	cache.set(locale, made);
	return made;
}

/**
 * Whether a parameter is a number for the purposes of a plural argument.
 *
 * Numeric strings count. `t('files', { count: String(n) })` is ordinary, and
 * refusing it would report a defect that only exists in the type of the value
 * rather than in the message.
 */
function asNumber(value: unknown): number | undefined {
	if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;

	if (typeof value === 'string' && value.trim() !== '') {
		const parsed = Number(value);
		return Number.isFinite(parsed) ? parsed : undefined;
	}

	return undefined;
}

/**
 * Categorise every numeric parameter, or return `undefined` when there are
 * none — which is the common case, and the one that should cost nothing.
 *
 * Every number is categorised rather than only the ones a message turns out to
 * use, because finding that out would mean parsing the message first, and a
 * cached `select()` is cheaper than the extra pass.
 */
export function pluralArgs(
	locale: string,
	params?: TranslationParams | RichTranslationParams,
): Record<string, PluralArg> | undefined {
	if (!params) return undefined;

	let found: Record<string, PluralArg> | undefined;

	for (const [name, raw] of Object.entries(params)) {
		const value = asNumber(raw);
		if (value === undefined) continue;

		const cardinal = build(cardinals, locale, () => new Intl.PluralRules(locale));
		const ordinal = build(ordinals, locale, () => new Intl.PluralRules(locale, { type: 'ordinal' }));
		const number = build(numbers, locale, () => new Intl.NumberFormat(locale));

		if (!cardinal || !ordinal || !number) return undefined;

		found ??= {};
		found[name] = {
			cardinal: cardinal.select(value),
			ordinal: ordinal.select(value),
			formatted: number.format(value),
		};
	}

	return found;
}

/** Drop every cached `Intl` object. Exposed for tests. */
export function resetPluralCache(): void {
	cardinals.clear();
	ordinals.clear();
	numbers.clear();
}
