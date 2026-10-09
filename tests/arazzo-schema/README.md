# Official Arazzo schema test corpus

Vendored from the [OAI/Arazzo-Specification](https://github.com/OAI/Arazzo-Specification)
repository (`v1.1-dev` and `v1.0-dev` branches, `tests/schema/`), Apache License 2.0.

- `1.1/pass` and `1.1/fail` validate against `src/arazzo/schemas/arazzo-1.1.schema.json`
- `1.0/pass` and `1.0/fail` validate against `src/arazzo/schemas/arazzo-1.0.schema.json`

`npm run verify` executes the full corpus through the application's schema
validator integration.
