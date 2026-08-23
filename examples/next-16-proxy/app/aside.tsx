'use client';

import { useEffect, useState } from 'react';
import { useTranslation } from 'i18n-fs/client';

function Note() {
	const t = useTranslation('home/aside');
	return <aside data-testid="aside">{t('note')}</aside>;
}

/**
 * A client-only subtree, which is what the `prefetch` prop is for.
 *
 * It renders nothing on the server, so there is no markup to mismatch during
 * hydration — and because the layout preloads `home/aside`, the request went
 * out with the HTML and the namespace is already there when this mounts.
 * Nothing suspends and nothing flashes.
 *
 * Reading a namespace the server did not send *during* server rendering is the
 * case to avoid: the server has no origin to fetch from, so it renders the
 * fallback while the client renders the message, and React reports a hydration
 * mismatch. Anything on first paint belongs in `namespaces` instead.
 */
export function Aside() {
	const [mounted, setMounted] = useState(false);

	useEffect(() => setMounted(true), []);

	return mounted ? <Note /> : null;
}
