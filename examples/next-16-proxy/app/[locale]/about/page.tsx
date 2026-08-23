import { getTranslation } from 'i18n-fs/server';

export default async function AboutPage() {
	const t = await getTranslation('common');
	return <h1 data-testid="about-title">{t('about')}</h1>;
}
