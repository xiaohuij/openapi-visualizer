# Arazzo Workflow Studio architecture

## 1. Product goal

Upgrade the OpenAPI Visualizer from an API structure explorer into a combined
API capability and workflow workspace.

The new experience is:

> An Arazzo Workflow Studio that uses Arazzo as the standard workflow
> description format and the existing OpenAPI graph as the source of API
> capabilities, providing workflow import, visualization, semantic validation,
> authoring, expression binding, and export.

The core user value is:

1. Import OpenAPI documents and Arazzo documents into one local workspace.
2. Resolve Arazzo steps to the OpenAPI operations they call.
3. Author workflows from existing API operations instead of hand-writing YAML.
4. Validate references, dependencies, mappings, expressions, and actions.
5. Export standard Arazzo YAML or JSON, not a private workflow format.

## 2. Non-goals for the first releases

The first milestones do not include:

- A production workflow execution engine.
- Automatic external API calls after importing a document.
- Server-side credential storage.
- Replacing the existing OpenAPI graph.
- Treating a private visual-model JSON as the long-term workflow format.
- Making an unstable third-party runner a core dependency.

Execution is introduced later as an isolated, opt-in adapter layer.

## 3. Specification maturity assessment

Arazzo is an OpenAPI Initiative specification, not a community draft. Arazzo
1.1.0 is the current published specification. An Arazzo Description must contain
a valid `arazzo` version, `info`, at least one source description, and at least
one workflow. See the
[Arazzo Specification v1.1.0](https://spec.openapis.org/arazzo/latest.html).

Arazzo 1.1 adds capabilities that are central to this feature:

- AsyncAPI source descriptions and async send/receive steps.
- Explicit step dependencies.
- Reusable sub-workflow calls.
- JSONPath, XPath, and JSONPointer selectors.
- Identity-based document references through `$self`.
- Clearer runtime-expression semantics.

The official OpenAPI Initiative overview and specification repository list a
growing ecosystem of editors, validators, parsers, resolvers, generators, and
runners. The specification is therefore mature enough to adopt as the source
format. The runner ecosystem is still young enough that the visualizer should
not couple its core architecture to one runner.

Jentic's Arazzo tooling is useful as a reference for module boundaries, but it
currently advertises Arazzo 1.0.x support and OpenAPI 2.0/3.0.x/3.1.x source
descriptions; its runner is explicitly under heavy development. Since this
project already supports OpenAPI 3.2, Jentic is not adopted as the primary
infrastructure dependency.

## 4. Architecture decisions

### Arazzo is the long-term source format

Internal ASTs, editor state, graph models, and execution plans are derived and
temporary. Arazzo YAML/JSON is the interchange and export format.

### Model against Arazzo 1.1, read 1.0.x

The internal model targets Arazzo 1.1 semantics. The parser accepts Arazzo
1.0.x documents for compatibility and records their version. Unsupported or
future versions are rejected with a clear diagnostic.

### Keep execution out of the first core

A workflow executor must eventually handle authentication, secrets, CORS,
retries, durable state, concurrency, event correlation, audit, and observability.
These concerns are deliberately separated from parsing and authoring. The first
execution-related deliverable is a static execution plan, not a live runner.

### Keep Arazzo modules separate from the OpenAPI parser

`src/lib/visualizer.ts` already owns OpenAPI normalization and visual-model
construction. Arazzo gets its own domain module and is bridged to OpenAPI
through a document registry and semantic resolver.

## 5. High-level data flow

```text
OpenAPI YAML/JSON
      |
      v
Existing OpenAPI parser
      |
      v
OpenAPI Visual Document
      |
      v
API capability index
      ^
      |
      | sourceDescriptions
      |
Arazzo YAML/JSON
      |
      v
Arazzo parser
      |
      v
Arazzo document model
      |
      v
Semantic resolver + validator
      |
      v
Workflow graph model
      |
      +-------------------+
      |                   |
      v                   v
Workflow canvas       Diagnostics
Inspector/editor
      |
      v
Arazzo serializer
```

Later execution follows a separate path:

```text
Arazzo document
   |
   v
Semantic graph
   |
   v
Execution plan compiler
   |
   v
Runner adapter
   |
   +--> Mock runner
   +--> Opt-in browser dry-run runner
   +--> Future server runner
   +--> Future external Arazzo runner
```

## 6. Module design

### `src/arazzo`

- `types.ts` — Arazzo document and object types.
- `diagnostics.ts` — severity, location, and diagnostic helpers.
- `parser.ts` — YAML/JSON parsing and baseline structural validation.
- `validator.ts` — semantic and product validation.
- `semantic-resolver.ts` — resolves source descriptions and step targets.
- `serializer.ts` — serializes the edited model back to Arazzo.
- `graph-builder.ts` — converts semantic output into a workflow graph.
- `runtime-expression/` — parsing, validation, and evaluation.
- `selectors/` — JSONPointer and RFC 9535 JSONPath (slices, unions, recursive
  descent, filters, and function extensions).
- `xpath.ts` — XPath 1.0 parsing, truthiness, and node string-value evaluation
  over XML string contexts.
- `schema-validator.ts` — official-schema structural validation with vendored
  1.0/1.1 JSON Schemas and on-demand draft-2020-12 validation chunks.
- `schemas/` — vendored official Arazzo JSON Schemas (Apache 2.0, attributed).

### `src/asyncapi`

- `types.ts` — AsyncAPI 2.x/3.x read model for channels, operations, and messages.
- `parser.ts` — AsyncAPI YAML/JSON parsing with local message `$ref` resolution.

### `src/workflow`

- `document-registry.ts` — locally imported OpenAPI/Arazzo/AsyncAPI documents.
- `capability-index.ts` — OpenAPI operation, parameter, request, and response index.
- `asyncapi-capability-index.ts` — AsyncAPI operation, channel/action, message, and pointer index.
- `commands.ts` — editor commands and future undo/redo boundaries.
- `editor-state.ts` — transient editing state.
- `store.ts` — Zustand workflow workspace state.
- `execution-plan.ts` — static execution planning.
- `mock-execution.ts` — in-memory expression, selector, criteria, action, and step simulation.
- `runners.ts` — runner adapter contracts and preview-only adapter implementations.

### `src/components/workflow`

- Workflow Studio shell.
- Workflow list and source-description panel.
- Workflow canvas.
- Step inspector.
- Operation picker.
- Expression and selector builders.
- Diagnostics and execution-plan panels.

## 7. Workspace documents

The first workspace supports multiple local OpenAPI documents and one or more
local Arazzo documents. Arazzo source-description URLs are not fetched
automatically. Users can bind a source description to a locally imported file.
This preserves the project's local-processing promise.

```ts
type WorkspaceDocumentKind = "openapi" | "arazzo" | "asyncapi";
```

Remote fetching may be added later behind explicit user action and a security
review.

## 8. Semantic resolution

The semantic resolver turns workflow references into concrete, navigable
objects:

```text
step.operationId
  -> sourceDescriptions[name]
  -> OpenAPI document
  -> operation
  -> parameters / request body / responses
  -> OpenAPI visual node
```

Resolution must be partial-failure tolerant. One unresolved step must not make
the entire document unusable. Unresolved targets remain visible as first-class
graph nodes and produce actionable diagnostics.

## 9. Workflow graph model

Workflow graphs must support directed acyclic graphs, not a linear list. The
model separately represents:

- Structural containment.
- Step dependencies.
- Operation calls.
- Sub-workflow calls.
- Parameter and request-body mappings.
- Success and failure control flow.
- Input and output selection.

The visual layout may be automatic at first. Canvas positions are not written
to standard Arazzo fields. If layout persistence is added later, it will use a
clearly namespaced extension such as `x-openapi-visualizer`.

## 10. Validation model

Validation has four layers:

1. **Syntax** — YAML/JSON parsing and root shape.
2. **Structure** — required fields, arrays, enums, and object types.
3. **Semantics** — duplicate IDs, dependency cycles, operation resolution,
   workflow-call resolution, expression context, and selector validity.
4. **Product lint** — usability checks such as missing descriptions, unsafe
   hardcoded secrets, and missing failure handling.

All layers share the diagnostic model so the future UI can present one coherent
list.

## 11. Security principles

- Imported documents are untrusted input.
- Do not automatically execute workflows.
- Do not automatically fetch source-description URLs.
- Do not persist credentials in localStorage or exported Arazzo.
- Dry-run execution must be explicitly enabled.
- Runtime expressions and selectors require bounded, error-safe evaluation.
- Future remote fetching requires explicit consent, response-size limits, and
  SSRF protections.

## 12. Execution phases

1. **Static execution plan** — topology, targets, required inputs, expected
   outputs, unresolved bindings, and control-flow edges; no network activity.
2. **Mock execution** — examples or user-entered data evaluate expressions,
   selectors, success criteria, and failure actions.
3. **Opt-in browser dry run** — explicit user action, user-supplied in-memory
   credentials, request preview, and clear CORS guidance.
4. **Runner service or external runner adapter** — production execution,
   durable state, secrets, retries, and observability remain outside the
   parsing/authoring core.
