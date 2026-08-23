---
'i18n-fs': patch
---

Verify both Next.js file conventions in CI.

Next.js 16 renamed the proxy file convention and deprecated the old name, so the
package supports two. Only one was covered by an automated test; the other was
checked by hand, which is the same as not being checked at all a month from now.

There are two example apps now — `next-16-proxy` and `next-15-middleware` — and
both run the same assertions from `examples/shared`, so behaving identically
across two Next.js majors and two conventions is proven rather than assumed.

No published behaviour changes.
