'use client';

import { useTranslation } from 'i18n-fs/client';

/**
 * Reads a namespace the provider did not send, so the client fetches it and
 * suspends. Exercises the path that needs the manifest hash.
 */
export function LateNamespace() {
	const t = useTranslation('home/hero');

	return (
		<p data-testid="late">
			{t.rich('terms', { link: (chunk) => <em>{chunk}</em> })}
		</p>
	);
}
