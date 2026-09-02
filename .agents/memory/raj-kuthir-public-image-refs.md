---
name: Raj Kuthir public image references
description: Property photos live in public/ and must be referenced by URL, never ESM-imported.
---

The property photos (Bedroom.jpg, "External Villa Morning.jpg", Review 1-3.jpg,
etc.) live in `artifacts/raj-kuthir/public/` and are consumed in
`artifacts/raj-kuthir/src/App.tsx` via an `asset()` helper that builds
`` `${basePath}/File%20Name.jpg` `` URLs.

**Why:** They were briefly switched to `import x from '../public/File%20Name.jpg'`
(commits d5c2f08..ff3ad38). Vite/Rollup never percent-decode import specifiers,
and importing out of `public/` is unsupported, so the production build failed to
resolve them and the host kept serving a stale build with "photography to be
added" placeholders. Fixed in 81bc9be.

**How to apply:** To add a photo, drop the file in `public/` and reference it as
`asset('File%20Name.jpg')` (percent-encode spaces — this is a URL, not a path).
Do not add `import ... from '../public/...'`. If a photo genuinely needs Vite
asset hashing, move it into `src/` first and import with a literal space.
