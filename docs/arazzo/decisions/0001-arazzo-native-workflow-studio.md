# ADR-0001: Build an Arazzo-native workflow studio

## Status

Accepted

## Date

2026-10-07

## Context

The OpenAPI Visualizer already normalizes and visualizes OpenAPI documents,
including OpenAPI 3.2. The next major capability is API workflow orchestration.
Arazzo is the OpenAPI Initiative specification for describing deterministic API
workflows.

There are three possible strategies:

1. Embed an existing Arazzo toolkit and build only a UI around it.
2. Invent a private workflow format and runtime.
3. Make Arazzo the source format and build this project's workspace,
   semantic graph, authoring, and validation experience around it.

Current third-party runner maturity is uneven. Jentic's useful toolkit targets
Arazzo 1.0.x in its current documentation and its runner is not yet stable or
published. It does not cover this project's OpenAPI 3.2 positioning.

## Decision

Implement an Arazzo-native Workflow Studio:

- Use Arazzo YAML/JSON as the long-term interchange and persistence format.
- Model against Arazzo 1.1 while reading Arazzo 1.0.x.
- Keep parser, resolver, validator, graph, editor, serializer, and runner
  concerns separate.
- Bridge Arazzo to the existing OpenAPI graph through a local document
  registry and semantic resolver.
- Do not adopt a third-party runner as core infrastructure in the first
  milestones.
- Add execution later through static plans, mock execution, and isolated
  adapters.

## Consequences

The project owns more parsing and semantic-resolution code than it would if it
wrapped a complete toolkit. In exchange, it preserves its OpenAPI 3.2 support,
avoids coupling to unstable runner APIs, and keeps workflow files interoperable
with the emerging Arazzo ecosystem.

A private visual format may exist internally, but users will not be locked into
it because the project's export and source format remain Arazzo.

