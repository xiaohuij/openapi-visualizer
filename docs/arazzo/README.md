# Arazzo Workflow Studio

This directory records the design and delivery plan for adding Arazzo workflow
capabilities to the OpenAPI Visualizer. The feature is intentionally
**Arazzo-native**: Arazzo is the interchange and persistence format, while this
project provides the workspace, visualization, validation, and authoring
experience.

## Documents

- [Architecture](./architecture.md) — product scope, architecture decisions, and module boundaries.
- [Delivery roadmap](./roadmap.md) — ordered, verifiable implementation slices.
- [ADR-0001: Build an Arazzo-native workflow studio](./decisions/0001-arazzo-native-workflow-studio.md)

## Current status

The roadmap is implemented through Task 19. The application now supports local
OpenAPI/Arazzo workspaces, semantic resolution and validation, a read-only DAG,
step authoring and mapping edits, Arazzo YAML/JSON export, workflow
composition, AsyncAPI step modeling, static execution plans, mock execution,
and preview-only runner adapters. Use **Pet flow** in the top bar to load the
bundled OpenAPI 3.2 + Arazzo 1.1 sample.

## External references

- [Arazzo Specification v1.1.0](https://spec.openapis.org/arazzo/latest.html)
- [OpenAPI Initiative Arazzo overview](https://www.openapis.org/arazzo-specification)
- [OAI/Arazzo-Specification](https://github.com/OAI/Arazzo-Specification)
- [jentic/jentic-arazzo-tools](https://github.com/jentic/jentic-arazzo-tools)
