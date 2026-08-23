'use client';

import { useState } from 'react';
import { useTranslation, usePrefetch } from 'i18n-fs/client';

/**
 * A panel whose namespace the provider does not send.
 *
 * The button prefetches on hover and on focus — focus as well, because a
 * keyboard user never hovers and a touch user has no hover at all, so hover
 * alone would give the fastest experience to the people who need it least.
 */
function Panel() {
	const t = useTranslation('settings/panel');
	return <p data-testid="panel">{t('title')}</p>;
}

export function SettingsPanel() {
	const [open, setOpen] = useState(false);
	const prefetch = usePrefetch();
	const warm = () => prefetch('settings/panel');

	return (
		<div>
			<button
				type="button"
				data-testid="open-settings"
				onPointerEnter={warm}
				onFocus={warm}
				onClick={() => setOpen(true)}
			>
				settings
			</button>
			{open ? <Panel /> : null}
		</div>
	);
}
