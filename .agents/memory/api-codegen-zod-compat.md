---
name: API codegen and Zod compatibility
description: OpenAPI hints can emit validators unsupported by the workspace's installed Zod version.
---

When adding OpenAPI schemas, prefer validator-compatible primitive hints unless the installed Zod version is known to support newer helpers such as `url()` and `int()`.

**Why:** The workspace currently generates Zod schemas with the installed package version, and newer Orval output can select helpers that are not present at runtime or during typechecking.

**How to apply:** After codegen, run the library typecheck immediately; if generated schemas use unsupported helpers, remove nonessential OpenAPI format/integer hints and regenerate rather than editing generated files.