# Vendored Arazzo JSON Schemas

These schemas are vendored from the OpenAPI Initiative's
[Arazzo-Specification repository](https://github.com/OAI/Arazzo-Specification)
(`src/schemas/validation/schema.yaml` on the `v1.1-dev` and `v1.0-dev`
branches) and converted to JSON. They are licensed under the Apache License 2.0.

The official test corpus under `tests/arazzo-schema/` is vendored from the same
repository's `tests/schema/` directories.

Both are local resources: the application never fetches remote schemas at
runtime. When upgrading Arazzo support, refresh these files from the official
repository and re-run `npm run verify`.
