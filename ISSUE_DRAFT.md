<!--
══════════════════════════════════════════════════════════════════════
DRAFT — not posted. This HTML comment is invisible when rendered on
GitHub, but you may delete it before submitting.

Title:
astro:i18n URL helpers return trailing slashes that violate `trailingSlash: 'never'` — Astro 301-redirects its own generated URLs (re-file of #14140)

Before posting:
1. Push this repro to a public GitHub repo (or import to StackBlitz)
   and replace REPLACE_WITH_REPRO_URL below.
2. Optionally tick the Participation checkbox.

Submit with:
  gh issue create --repo withastro/astro \
    --title "astro:i18n URL helpers return trailing slashes that violate \`trailingSlash: 'never'\` — Astro 301-redirects its own generated URLs (re-file of #14140)" \
    --body-file ISSUE_DRAFT.md
or open the form prefilled in the browser by appending --web.
══════════════════════════════════════════════════════════════════════
-->

### Astro Info

```
Astro                    v6.4.5
Vite                     v7.3.5
Node                     v24.16.0
System                   Linux (x64)
Package Manager          npm
Output                   server
Adapter                  @astrojs/node (v10.1.4)
Integrations             none
```

### If this issue only occurs in one browser, which browser is a problem?

No response

### Describe the Bug

With `trailingSlash: 'never'`, the `astro:i18n` URL helpers return URLs **with** a trailing slash in three situations:

```js
// astro.config.mjs: trailingSlash: 'never',
// i18n: { defaultLocale: 'en', locales: ['en', 'pl'] }, site: 'https://example.com'

getRelativeLocaleUrl('pl');                                  // '/pl'                  ✅
getRelativeLocaleUrl('pl', '');                              // '/pl/'                 ❌ expected '/pl'
getRelativeLocaleUrl('pl', '/');                             // '/pl/'                 ❌ expected '/pl'
getRelativeLocaleUrl('pl', 'docs/setup');                    // '/pl/docs/setup'       ✅ (nested paths are fine)
getRelativeLocaleUrl('pl', 'docs/setup/', { prependWith: 'blog' });
                                                             // '/blog/pl/docs/setup/' ❌ expected '/blog/pl/docs/setup'
getAbsoluteLocaleUrl('pl', '');                              // 'https://example.com/pl/' ❌
getAbsoluteLocaleUrlList('');                                // ['https://example.com', 'https://example.com/pl/'] ❌
```

Note two inconsistencies that no `trailingSlash` semantics can explain:

- omitting `path` vs passing `''` produce different URLs (`/pl` vs `/pl/`);
- `getAbsoluteLocaleUrlList('')` — “a list of absolute paths for all the locales”, the shape an hreflang block needs — is inconsistent **within a single call**: the default locale gets no slash, every other locale gets one.

This is a re-file of #14140 (same bug, closed as stale on no activity), where @matthewp wrote:

> If you're still experiencing this in Astro 6, please open a new issue and we'll take a fresh look.

It reproduces on Astro 6.4.5. Previously reported in #9919, #11630, #13032 and #14140; #13045 fixed only the case where the join collapses to `""` (default locale, no base), not the locale-prefixed one.

Why projects end up here: with `'always'` or the default `'ignore'` + `build.format: 'directory'`, these helpers append a slash to *every* URL, so an on-demand-rendered site that wants slash-less URLs has exactly one option — `trailingSlash: 'never'` — and then hits this bug on its language switcher and hreflang alternates.

#### Astro itself rejects the URLs it generates

The same config that produces these links refuses to serve them — both observable in the reproduction (`npm test` asserts the SSR behavior, `npm run dev` shows the dev notice):

- **dev**: `GET /pl/` → **404** with the notice *“Your site is configured with `trailingSlash` set to `never`. Do you want to go to `/pl` instead?”* (`GET /pl` → 200)
- **on-demand rendering** (`@astrojs/node`): `GET /pl/` → **301** redirect to `/pl` (308 for non-GET) via `TrailingSlashHandler` (`packages/astro/src/core/routing/trailing-slash-handler.ts`)

The affected URLs are the most-linked pages of a localized site — every language switcher and every hreflang block includes each locale’s home page. Concretely:

- **An extra round trip on every affected navigation.** Each click on a generated home link costs a 301 plus a second request before any HTML arrives — the hop Lighthouse’s “Avoid multiple page redirects” audit penalizes. On serverless/edge deployments each such hit is an extra billed invocation, and access logs and edge analytics fill with self-inflicted 301s for plain internal navigation.
- **SEO.** hreflang/canonical alternates built from `getAbsoluteLocaleUrlList()` send crawlers to URLs that 301: Search Console files the targets under “Page with redirect”, crawl budget is spent on the hop, and the alternate URLs contradict the URLs `@astrojs/sitemap` emits for the same pages — the sitemap integration explicitly honors `trailingSlash: 'never'` (`write-sitemap.js` checks `astroConfig.trailingSlash === "never"`), so two official Astro packages currently disagree about the canonical form of the same page.
- **Dev.** The very first language-switcher link built with the documented API responds 404 (notice page above).

#### Root cause

`getLocaleRelativeUrl` (`packages/astro/src/i18n/index.ts`) keeps the empty path as a join segment, and the `trailingSlash: 'never'` branch only *refrains from appending* a slash — it never strips one:

```js
const pathsToJoin = [base, prependWith];
// …pushes normalizedLocale for non-default locales…
pathsToJoin.push(path);                          // path === '' is kept
let relativePath;
if (shouldAppendForwardSlash(trailingSlash, format)) {
  relativePath = appendForwardSlash(joinPaths(...pathsToJoin));
} else {
  relativePath = joinPaths(...pathsToJoin);      // ← no stripping here
}
```

`joinPaths` (`@astrojs/internal-helpers`) filters only non-strings, so `''` survives and `['', 'pl', ''].join('/')` ends with `/`:

```js
function joinPaths(...paths) {
  return paths.filter(isString).map((path, i) => {
    if (i === 0) return removeTrailingForwardSlash(path);
    else if (i === paths.length - 1) return removeLeadingForwardSlash(path);
    else return trimSlashes(path);
  }).join('/');
}
```

The `prependWith` case is a second mechanism in the same function: `i === paths.length - 1` compares the **filtered** index against the **unfiltered** rest-parameter length. When `prependWith` is `undefined` the last-element branch never fires and `trimSlashes` accidentally cleans trailing slashes from the input path; when `prependWith` is a string, the branch fires and a trailing slash in `path` survives into the output.

`getLocaleAbsoluteUrl` and the `*List` variants delegate to the same logic, so they inherit all of the above.

#### “But the docs example shows `/fr/`”

The current docs do show `getAbsoluteLocaleUrl("fr", ""); // returns https://example.com/fr/` — the implementation matches that line. The point of this issue is that the line documents the bug rather than a contract:

1. **The docs originally promised the slash-less output.** Until January 2025 the [`astro:i18n` reference](https://docs.astro.build/en/reference/modules/astro-i18n/) read `// returns /fr` and `// returns https://example.com/fr` for these exact calls. withastro/docs#10797 (merged 2025-01-27, days after #13032 was closed as “expected”) flipped the documented outputs to match the implementation:

   ```diff
   -// returns /fr
   +// returns /fr/
   -// returns https://example.com/fr
   +// returns https://example.com/fr/
   ```

2. **The example set is self-contradictory.** The same section still shows `getRelativeLocaleUrl("fr"); // returns /fr` next to `getRelativeLocaleUrl("fr", ""); // returns /fr/`. No implementation that honors a single `trailingSlash` setting can produce both — only one that treats `undefined` and `''` differently, i.e. the bug. The examples also state no config, yet under the **default** config (`'ignore'` + `build.format: 'directory'`) the actual output of `getRelativeLocaleUrl("fr")` is `/fr/`, so they don’t describe defaults either. The inline JSDoc shipped with Astro likewise shows `getRelativeLocaleUrl("es"); // /es`.

3. **The operative contract says trailing slashes are config-driven.** The same reference page instructs:

   > When creating routes with these functions, be sure to take into account your individual settings for: `base`, `trailingSlash`, `build.format`, `site`

   and the [`trailingSlash: 'never'` reference](https://docs.astro.build/en/reference/configuration-reference/#trailingslash):

   > Only match URLs that do not include a trailing slash (e.g: “/about”). In production, requests for on-demand rendered URLs with a trailing slash will be redirected to the correct URL for your convenience.

   The runtime (`TrailingSlashHandler`) enforces exactly that — against the helpers’ own output.

#### “Just call the function without the second argument”

In #13032 @ematipico suggested omitting the argument instead of passing `''`. The core problem with that: **in real code `path` is a computed value, not a literal.** The signature is

```ts
(locale: string, path?: string, options?: GetLocaleOptions) => string
```

and a language switcher or hreflang loop derives the current page’s path from `Astro.url.pathname`, holding a `string` — which is `''` on the home page:

```astro
---
const path = stripLocale(Astro.url.pathname); // '' on the home page, 'docs/setup' elsewhere
---
{locales.map((l) => <a href={getRelativeLocaleUrl(l, path)}>{l}</a>)}
```

There is **no string value** of `path` that yields the correct home URL — the only escape is `getRelativeLocaleUrl(l, path || undefined)`, abusing argument optionality to change the output for the same logical input. The parameter’s own JSDoc reads “*An optional path to add after the `locale`*” — adding nothing after the locale should be equivalent to omitting it.

Additionally:

- `'/'` is an unambiguously valid root path and is equally affected;
- the official docs example itself passes `""`;
- omitting is not even possible for `getAbsoluteLocaleUrlList(path)`, whose whole purpose is mapping one path across all locales — the shape an hreflang block needs.

#### Suggested fix

In the `else` branch of both `getLocaleRelativeUrl` and `getLocaleAbsoluteUrl`:

```js
relativePath = removeTrailingForwardSlash(joinPaths(...pathsToJoin));
```

The existing `if (relativePath === "") return "/";` guard (from #13045) keeps the root case correct. This one-liner fixes every case above, including the `prependWith` one and the `*List` variants (they delegate). A narrower alternative — dropping empty segments in `joinPaths` (`filter((p) => isString(p) && p !== '')`) — would fix only the empty/root-path class, not the `prependWith` trailing-slash class.

### What's the expected result?

With `trailingSlash: 'never'`, no URL generated by `astro:i18n` ends with a trailing slash — the same invariant `TrailingSlashHandler` enforces for incoming requests:

```js
getRelativeLocaleUrl('pl');                                          // '/pl'
getRelativeLocaleUrl('pl', '');                                      // '/pl'
getRelativeLocaleUrl('pl', '/');                                     // '/pl'
getRelativeLocaleUrl('pl', 'docs/setup/', { prependWith: 'blog' });  // '/blog/pl/docs/setup'
getAbsoluteLocaleUrl('pl', '');                                      // 'https://example.com/pl'
getAbsoluteLocaleUrlList('');  // ['https://example.com', 'https://example.com/pl']
```

…and `getRelativeLocaleUrl(locale)` ≡ `getRelativeLocaleUrl(locale, '')` regardless of configuration.

### Link to Minimal Reproducible Example

REPLACE_WITH_REPRO_URL

`output: 'server'` with `@astrojs/node` (standalone), `trailingSlash: 'never'`, two locales; every URL exercised by the tests exists as a real page. `npm install && npm test` builds the site, starts the built server, and asserts over HTTP in two sections: **URL generation** (the seven calls above — five fail) and **server enforcement** (these pass: the slash-less URLs the helpers should return respond 200 — `/pl`, `/pl/docs/setup`, `/blog/pl/docs/setup` — while the URLs they actually return are 301-redirected — `/pl/`, `/blog/pl/docs/setup/`), demonstrating that Astro redirects away from the URLs its own helpers generate. `npm run dev` shows the same via the language-switcher link → 404 notice page.

### Participation

- [ ] I am willing to submit a pull request for this issue.
