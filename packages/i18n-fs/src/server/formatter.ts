/**
 * Dates, numbers and lists in a Server Component.
 *
 * The client half is `useFormatter` in `i18n-fs/client`. Both build the same
 * object from the same file; they differ only in where the locale comes from.
 */

import { createFormatter, type Formatter } from '../formatter.js';
import { getLocale } from './locale.js';

/**
 * A formatter for the request's locale.
 *
 * ```tsx
 * const format = await getFormatter();
 *
 * <p>{format.dateTime(order.placedAt, { dateStyle: 'full' })}</p>
 * ```
 *
 * Asynchronous for the same reason `getTranslation` is: the locale comes from
 * the request, and reading a request is asynchronous in Next.js.
 */
export async function getFormatter(): Promise<Formatter> {
	return createFormatter(await getLocale());
}
