# astro:i18n × `trailingSlash: 'never'` — trailing slash repro

`getRelativeLocaleUrl()`, `getAbsoluteLocaleUrl()` and `getAbsoluteLocaleUrlList()`
from `astro:i18n` return URLs **with a trailing slash** under `trailingSlash: 'never'`
whenever the locale-prefixed path is empty (`''`) or root (`'/'`) — and, when
`prependWith` is used, whenever the input path carries a trailing slash.

```js
// astro.config.mjs: trailingSlash: 'never', i18n: { defaultLocale: 'en', locales: ['en', 'pl'] }
getRelativeLocaleUrl('pl');                                  // '/pl'                  ✅
getRelativeLocaleUrl('pl', '');                              // '/pl/'                 ❌ expected '/pl'
getRelativeLocaleUrl('pl', '/');                             // '/pl/'                 ❌ expected '/pl'
getRelativeLocaleUrl('pl', 'docs/setup');                    // '/pl/docs/setup'       ✅ (nested paths are fine)
getRelativeLocaleUrl('pl', 'docs/setup/', { prependWith: 'blog' });
                                                             // '/blog/pl/docs/setup/' ❌ expected '/blog/pl/docs/setup'
getAbsoluteLocaleUrl('pl', '');                              // 'https://example.com/pl/' ❌
getAbsoluteLocaleUrlList('');                                // ['https://example.com', 'https://example.com/pl/'] ❌
//                          inconsistent within a single call ─────────────────^
```

The last call returns one URL per locale — the shape an hreflang block needs —
and is inconsistent within a single call: the default locale gets no slash,
every other locale gets one.

## Why it matters

The affected URLs are the most-linked pages of a localized site — every language
switcher and every hreflang block includes each locale’s home page. Each affected
navigation costs an extra 301 round trip (an extra billed invocation on
serverless/edge), and hreflang/canonical alternates built from
`getAbsoluteLocaleUrlList()` point crawlers at redirecting URLs — contradicting
what `@astrojs/sitemap`, which honors `trailingSlash: 'never'`, emits for the
same pages.

## Steps to reproduce

```bash
npm install
npm test        # astro build + starts the built server + assertions over HTTP
```

`npm test` builds the site (`output: 'server'`, `@astrojs/node` standalone),
starts `dist/server/entry.mjs`, and asserts in two sections:

1. **URL generation** — the seven calls above; five fail.
2. **Server enforcement of the same config** — these pass, demonstrating the
   contradiction: the slash-less URLs the helpers *should* return are real
   pages (`/pl`, `/pl/docs/setup`, `/blog/pl/docs/setup` → **200**), while the
   URLs they *do* return are redirected away (`/pl/`, `/blog/pl/docs/setup/` →
   **301**; 308 for non-GET — see `TrailingSlashHandler` in
   `astro/src/core/routing/trailing-slash-handler.ts`).

Every URL exercised by the tests exists as a page:

```
src/pages/index.astro               → /
src/pages/pl/index.astro            → /pl
src/pages/docs/setup.astro          → /docs/setup
src/pages/pl/docs/setup.astro       → /pl/docs/setup
src/pages/blog/pl/docs/setup.astro  → /blog/pl/docs/setup   (the prependWith: 'blog' mount)
```

The process exits non-zero because of the five failing generation cases.

Alternatively `npm run dev` and open `http://localhost:4321/` — the rendered list
shows the same outputs, and clicking the “Polski” language link navigates to
`/pl/`, which dev answers with **404** and the notice *“Your site is configured
with `trailingSlash` set to `never`. Do you want to go to `/pl` instead?”*

So the URLs produced by `astro:i18n` are URLs that Astro itself refuses to serve
under the very same configuration.
