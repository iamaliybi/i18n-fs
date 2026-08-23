'use client';

import { useLocaleSwitcher } from 'i18n-fs/navigation';
import { useTranslation } from 'i18n-fs/client';

export function LocaleSwitcher() {
	const { locale, locales, switchTo, hrefFor } = useLocaleSwitcher();
	const t = useTranslation('common');

	return (
		<nav data-testid="switcher" aria-label={t('switch')}>
			{locales.map((candidate) => (
				<a
					key={candidate}
					href={hrefFor(candidate)}
					data-testid={`switch-${candidate}`}
					aria-current={candidate === locale ? 'true' : undefined}
					onClick={(event) => {
						event.preventDefault();
						switchTo(candidate);
					}}
				>
					{candidate}
				</a>
			))}
		</nav>
	);
}
