'use client';

/**
 * Dates, numbers and lists in a Client Component.
 *
 * The server half is `getFormatter` in `i18n-fs/server`. Both build the same
 * object from the same file; they differ only in where the locale comes from,
 * which is the same split `useTranslation` and `getTranslation` have.
 *
 * Nothing here is downloaded. `Intl` is part of the runtime, so unlike
 * `useTranslation` this hook pulls in no WebAssembly at all.
 */

import { useMemo } from 'react';
import { createFormatter, type Formatter } from '../formatter.js';
import { useI18nContext } from './context.js';

/**
 * A formatter for the active locale.
 *
 * ```tsx
 * const format = useFormatter();
 *
 * <time dateTime={iso}>{format.relativeTime(postedAt)}</time>
 * <span>{format.number(price, { style: 'currency', currency: 'IRR' })}</span>
 * ```
 */
export function useFormatter(): Formatter {
	const { locale } = useI18nContext();

	// The object is cheap to build, but a new identity on every render would
	// defeat any `useMemo` or `memo` downstream that depends on it.
	return useMemo(() => createFormatter(locale), [locale]);
}
