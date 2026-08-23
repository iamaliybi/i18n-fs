import { defineConfig } from 'i18n-fs/config';

export default defineConfig({
	locales: ['fa', 'en'],
	defaultLocale: 'fa',
	strategy: 'path',
	prefix: 'as-needed',
});
