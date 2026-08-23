/**
 * No i18n-fs configuration needed.
 *
 * The Edge and Node binaries are embedded as bytes, so nothing here imports
 * a `.wasm` module and no bundler setup is required. Verified on Next.js 15
 * with `middleware.ts` and Next.js 16 with `proxy.ts`.
 *
 * @type {import('next').NextConfig}
 */
export default {};
