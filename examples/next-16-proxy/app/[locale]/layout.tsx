import type { ReactNode } from 'react';
import { I18nProvider, setRequestLocale } from 'i18n-fs/server';

export default async function LocaleLayout({
	children,
	params,
}: {
	children: ReactNode;
	params: Promise<{ locale: string }>;
}) {
	const { locale } = await params;

	// Under the path strategy the segment is authoritative and a Server
	// Component cannot read the pathname, so it is pinned for this request.
	setRequestLocale(locale);

	return (
		<html lang={locale} dir={locale === 'fa' ? 'rtl' : 'ltr'}>
			<body>
				{/*
					Every namespace a Client Component reads has to be listed here.
					A client fetch has no origin during server rendering, so anything
					missing renders its fallback on the server and only fills in after
					hydration.
				*/}
				<I18nProvider namespaces={['common', 'home/hero']}>{children}</I18nProvider>
			</body>
		</html>
	);
}
