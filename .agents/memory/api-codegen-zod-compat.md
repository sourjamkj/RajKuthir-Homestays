---
name: API codegen and Zod compatibility
description: OpenAPI hints can emit validators unsupported by the workspace's installed Zod version.
---

When adding OpenAPI schemas, prefer validator-compatible primitive hints unless the installed Zod version is known to support newer helpers such as `url()` and `int()`.

**Why:** The workspace currently generates Zod schemas with the installed package version, and newer Orval output can select helpers that are not present at runtime or during typechecking.

**How to apply:** After codegen, run the library typecheck immediately; codegen can overwrite compatibility edits, so validate the regenerated output before moving on and keep the OpenAPI hints as conservative as practical.