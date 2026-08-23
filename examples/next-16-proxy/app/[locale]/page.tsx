import { Suspense } from 'react';
import { getTranslation } from 'i18n-fs/server';
import { Link } from 'i18n-fs/navigation';
import { LocaleSwitcher } from '../locale-switcher';
import { LateNamespace } from '../late-namespace';

export default async function HomePage() {
	const t = await getTranslation('home/hero', 'hero');

	return (
		<main>
			<h1 data-testid="title">{t('title')}</h1>

			<ul data-testid="bullets">
				{t.array('bullets').map((bullet) => (
					<li key={bullet}>{bullet}</li>
				))}
			</ul>

			<button type="button" data-testid="cta">
				{t('cta.label')}
			</button>

			{/* Missing on purpose: it must render the fallback, not blow up. */}
			<p data-testid="missing">{t('nope', {}, { fallback: 'fallback shown' })}</p>

			<Link href="/about" data-testid="about-link">
				about
			</Link>

			<LocaleSwitcher />

			{/* Not pre-loaded by the provider, so the client fetches and suspends. */}
			<Suspense fallback={<span data-testid="late-loading">loading</span>}>
				<LateNamespace />
			</Suspense>
		</main>
	);
}
