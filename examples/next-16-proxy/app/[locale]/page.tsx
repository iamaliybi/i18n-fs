import { Suspense } from 'react';
import { getFormatter, getTranslation, unknownKey } from 'i18n-fs/server';
import { Link } from 'i18n-fs/navigation';
import { LocaleSwitcher } from '../locale-switcher';
import { LateNamespace } from '../late-namespace';
import { SettingsPanel } from '../settings-panel';
import { Aside } from '../aside';

export default async function HomePage() {
	const t = await getTranslation('home/hero', 'hero');
	const format = await getFormatter();

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

			{/*
				Plural and ordinal arms, rendered by the server. The two locale
				files differ in *shape* here, not only in wording: English needs
				`one` and `other`, Persian needs neither. That is the point — the
				grammar is the translator's to write, and this page does not know
				which arms exist.
			*/}
			<p data-testid="files-none">{t('files', { count: 0 })}</p>
			<p data-testid="files-one">{t('files', { count: 1 })}</p>
			<p data-testid="files-many">{t('files', { count: 1234 })}</p>
			<p data-testid="place">{t('place', { n: 2 })}</p>

			{/* `Intl`, so this costs the visitor nothing. */}
			<p data-testid="formatted-number">{format.number(1234567.89)}</p>
			<p data-testid="formatted-date">
				{format.dateTime(Date.UTC(2026, 7, 31), { dateStyle: 'long', timeZone: 'UTC' })}
			</p>

			{/*
				Missing on purpose: it must render the fallback, not blow up. The
				key is not in the generated registry — which is the point — so
				`unknownKey` is how a deliberate or runtime-built key gets past the
				type check without turning off the type check everywhere else.
			*/}
			<p data-testid="missing">
				{t(unknownKey('nope'), {}, { fallback: 'fallback shown' })}
			</p>

			<Link href="/about" data-testid="about-link">
				about
			</Link>

			<LocaleSwitcher />

			{/* Not pre-loaded by the provider, so the client fetches and suspends. */}
			<Suspense fallback={<span data-testid="late-loading">loading</span>}>
				<LateNamespace />
			<SettingsPanel />
			<Aside />
			</Suspense>
		</main>
	);
}
