---
name: Vite HTML root URL handling
description: Vite production HTML processing can treat root-relative metadata URLs as local asset paths.
---

Avoid using a bare root-relative URL such as `/` in HTML metadata attributes that Vite processes as assets, especially canonical links.

**Why:** Vite can resolve `/` against the project root directory and then attempt to read that directory as a file, producing an `EISDIR` build failure.

**How to apply:** Use an absolute external canonical URL or generate the metadata at runtime; reproduce the exact production build locally with the artifact environment variables before publishing.