# Arazzo Workflow Studio delivery roadmap

Tasks are intentionally split into increments that keep the application
buildable and verifiable. The current implementation batch covers Task 0 through
Task 19.

## Milestone 1 — Read-only Workflow Studio

Users can import Arazzo and OpenAPI documents, inspect workflows and steps, see
semantic diagnostics, and navigate from an Arazzo step to its OpenAPI operation.

### Task 0: Record the design

Create the Arazzo architecture and roadmap documents and record the primary
architecture decision.

**Acceptance criteria**

- [x] Architecture decisions are documented.
- [x] Arazzo 1.1 is identified as the target model.
- [x] Direct dependence on an unstable runner is rejected.
- [x] Execution is planned as a later adapter.

**Dependencies:** none.

### Task 1: Define Arazzo types and diagnostics

Create a UI-independent Arazzo document model and shared diagnostic model.

**Acceptance criteria**

- [x] Root, info, source descriptions, workflows, and steps are represented.
- [x] Parameters, request bodies, criteria, success actions, failure actions,
      selectors, and workflow calls can be represented.
- [x] Diagnostics carry severity, code, message, pointer, and document ID.
- [x] Types do not depend on React or the existing OpenAPI visualizer.

**Dependencies:** Task 0.

### Task 2: Implement the Arazzo parser

Parse YAML/JSON into the document model and reject unsupported versions with
clear diagnostics.

**Acceptance criteria**

- [x] YAML and JSON are supported.
- [x] Arazzo 1.0.x and 1.1.x are supported.
- [x] Parse errors produce diagnostics.
- [x] Raw data, JSON pointers, and specification extensions are retained.
- [x] A verification script exercises valid and invalid fixtures.
- [x] `npm run build` and `npm run verify` pass.

**Dependencies:** Task 1.

### Task 3: Add the workspace document registry

Manage multiple local OpenAPI/Arazzo documents and bind Arazzo source
descriptions to local files without automatic remote fetching.

**Acceptance criteria**

- [x] Multiple local documents can coexist in the registry.
- [x] Same-file imports replace the existing entry.
- [x] Source descriptions bind only to a compatible local document kind.
- [x] Removing a document clears bindings that reference it.
- [x] The UI separates the API graph and Workflow Studio surfaces.
- [x] Remote source-description URLs are not fetched automatically.
- [x] `npm run build` and `npm run verify` pass.

**Dependencies:** Task 2.

### Task 4: Build the OpenAPI capability index

Index operations by operation ID and method/path, including parameters, request
bodies, response schemas, and visual-node IDs.

**Acceptance criteria**

- [x] Operations are indexed by operationId.
- [x] Operations are indexed by method + path within a document.
- [x] Parameters and required flags are retained.
- [x] Request-body content types and schemas are retained.
- [x] Response status codes, content types, and schemas are retained.
- [x] Visual-node IDs are retained for later graph navigation.
- [x] OpenAPI 3.x and Swagger 2.0 documents are exercised by verification.

**Dependencies:** Task 3.

### Task 5: Implement Arazzo semantic resolution

Resolve source descriptions and operation/workflow targets while preserving
unresolved targets as visible nodes.

**Acceptance criteria**

- [x] Source description bindings are resolved.
- [x] Literal `operationId` targets resolve to OpenAPI operations.
- [x] `$sourceDescriptions` method/path expressions resolve to OpenAPI operations.
- [x] Workflow calls resolve within the current Arazzo document.
- [x] Workflow calls can resolve through a bound Arazzo source description.
- [x] Unresolved targets remain represented as unresolved result nodes.
- [x] Unresolved targets produce actionable diagnostics.

**Dependencies:** Task 4.

### Task 6: Implement validator MVP

Validate required structure, duplicate identifiers, dependencies, cycles,
action shape, and target resolution.

**Acceptance criteria**

- [x] Duplicate source-description names are reported.
- [x] Duplicate workflow IDs and step IDs are reported.
- [x] Missing `dependsOn` targets are reported.
- [x] Dependency cycles are reported with a readable cycle path.
- [x] Steps cannot silently declare conflicting operation and workflow targets.
- [x] Success and failure action types are validated.
- [x] Goto action targets are validated.
- [x] Missing local source bindings produce a product warning.
- [x] Operation and workflow target resolution diagnostics come from the semantic resolver.

**Dependencies:** Task 5.

### Task 7: Implement the read-only workflow graph

Render workflows, source descriptions, steps, dependencies, calls, and
unresolved nodes with automatic layout.

**Acceptance criteria**

- [x] Semantic output is converted to a UI-independent workflow graph model.
- [x] Document, source-description, workflow, step, operation-target,
  workflow-target, and unresolved-target nodes are represented.
- [x] Containment, `dependsOn`, operation-call, workflow-call, and unresolved-call
  edges are represented.
- [x] Step order is derived from dependency edges rather than assumed to be linear.
- [x] Unresolved targets and missing dependencies remain visible.
- [x] Dagre automatically lays out the read-only React Flow canvas.
- [x] Graph construction is exercised by the verification script.
- [x] `npm run build` and `npm run verify` pass.

**Dependencies:** Task 6.

### Task 8: Implement step inspection and OpenAPI navigation

Show step details, source snippets, diagnostics, and resolved-operation links.

**Acceptance criteria**

- [x] A step can be selected from the graph or workflow list.
- [x] The inspector shows workflow, step, target, dependency, description, and
  pointer context.
- [x] Parameters, request bodies, actions, and outputs are rendered.
- [x] Step-scoped parser, semantic, and validator diagnostics are grouped together.
- [x] The original YAML/JSON source range is displayed as a snippet.
- [x] Resolved OpenAPI operations link back to the API graph and reveal the
  operation node.
- [x] Source snippets are exercised by verification.
- [x] `npm run build` and `npm run verify` pass.

**Dependencies:** Task 7.

### Task 9: Complete the Workflow Studio shell

Add the workspace entry point, workflow list, source-description panel, and
diagnostics panel without regressing the existing API graph.

**Acceptance criteria**

- [x] API and Flow surfaces share the top-level application shell.
- [x] Opening an Arazzo document enters Workflow Studio.
- [x] Local workspace documents can be selected and removed.
- [x] Source descriptions can be bound to compatible local documents.
- [x] Workflows, steps, targets, and dependencies remain readable without the canvas.
- [x] Parser, semantic, and validator diagnostics are shown in one panel.
- [x] Remote source-description URLs are still not fetched automatically.
- [x] A bundled Pet flow sample loads OpenAPI and Arazzo documents and binds their source description.
- [x] The existing OpenAPI graph remains available through the API surface.
- [x] `npm run build` and `npm run verify` pass.

**Dependencies:** Task 8.

## Milestone 2 — Authoring and export

Users create workflows from OpenAPI operations, edit mappings and actions, and
export standard Arazzo.

### Task 10: Implement the editor command model

Introduce immutable document commands and prepare undo/redo boundaries.

**Acceptance criteria**

- [x] Editor commands are explicit, typed values rather than direct store mutations.
- [x] Commands update the normalized Arazzo model and raw document together.
- [x] Editing preserves the original input document immutably.
- [x] Step create/update/remove and workflow metadata commands are supported.
- [x] Edited documents retain specification extensions and can be reparsed as Arazzo.
- [x] Invalid commands return actionable diagnostics without replacing the document.
- [x] Pure undo/redo history boundaries are provided for the future editor shell.
- [x] Commands and history are exercised by verification.
- [x] `npm run build` and `npm run verify` pass.

### Task 11: Implement the Arazzo serializer

Export the edited model as standard YAML/JSON and verify import/export
round-tripping.

**Acceptance criteria**

- [x] Arazzo documents can be exported as YAML.
- [x] Arazzo documents can be exported as formatted JSON.
- [x] Serialization uses the raw canonical document, preserving extensions and `$self`.
- [x] YAML and JSON exports reparse without diagnostics.
- [x] Editor commands use the same serializer for generated source text.
- [x] Workflow Studio can export the active document as YAML or JSON.
- [x] Import/export round-trips are exercised by verification.
- [x] `npm run build` and `npm run verify` pass.

### Task 12: Create steps from OpenAPI operations

Add an `Add to workflow` path that creates a step and initial mappings.

**Acceptance criteria**

- [x] The OpenAPI operation inspector offers an `Add to workflow` action.
- [x] The target Arazzo document and workflow can be selected.
- [x] Operation steps receive a unique, readable `stepId`.
- [x] Bound operations use `$sourceDescriptions` method/path expressions.
- [x] Literal operation IDs remain available when a unique source is not bound.
- [x] Required parameters receive initial parameter mappings.
- [x] Required request bodies receive an initial content type and payload object.
- [x] Adding a step updates the workspace through the command model.
- [x] Undo/redo boundaries are available in Workflow Studio.
- [x] A successful add switches to the workflow graph surface.
- [x] Workspace command editing and undo/redo are exercised by verification.
- [x] `npm run build` and `npm run verify` pass.

### Task 13: Implement parameter and request-body editing

Bind static values and runtime expressions to target schemas.

**Acceptance criteria**

- [x] Step parameters can be added, edited, and removed.
- [x] Parameter names and locations remain editable.
- [x] Values support strings, numbers, booleans, JSON/YAML structures, and `$` runtime expressions.
- [x] Parameters are matched to resolved OpenAPI parameter metadata.
- [x] Target parameter type and required state are shown.
- [x] Missing required parameters can be added in one action.
- [x] Request bodies can be enabled, disabled, and edited.
- [x] Request-body content types are constrained to the operation when available.
- [x] Request payloads support static JSON/YAML values and runtime expressions.
- [x] Mapping edits go through the immutable command model and undo boundary.
- [x] Runtime expressions remain strings through command serialization and reparse.
- [x] `npm run build` and `npm run verify` pass.

### Task 14: Implement runtime-expression and selector MVP

Parse and validate workflow inputs, step outputs, JSONPointer, and core
JSONPath expressions.

**Acceptance criteria**

- [x] `$inputs`, `$steps`, `$workflows`, and `$sourceDescriptions` expression roots are parsed.
- [x] Workflow input references are checked against declared workflow parameters.
- [x] Step output references are checked against declared producing steps and outputs.
- [x] Reading a step without an explicit dependency produces a warning.
- [x] Workflow output and source-description references are validated.
- [x] Embedded expressions in parameter values and request payloads are scanned recursively.
- [x] JSONPointer syntax, escapes, evaluation, and missing values are handled.
- [x] Core JSONPath child, index, wildcard, and recursive segments are parsed and evaluated.
- [x] Selector evaluation has bounded depth and result limits.
- [x] JSONPath and JSONPointer selectors are validated.
- [x] Runtime and selector diagnostics appear in Workflow Studio.
- [x] Valid and invalid expressions/selectors are exercised by verification.
- [x] `npm run build` and `npm run verify` pass.

## Milestone 3 — Advanced workflow semantics

### Task 15: Support workflow composition

Resolve sub-workflow calls, map inputs/outputs, and detect recursive calls.

**Acceptance criteria**

- [x] Local workflow calls retain direct references to the target workflow.
- [x] `$sourceDescriptions` workflow-call expressions resolve to a named Arazzo source.
- [x] Literal external calls continue to resolve through a bound Arazzo source.
- [x] Resolved workflow targets retain target document ID and pointer context.
- [x] Required sub-workflow inputs are checked.
- [x] Unknown sub-workflow input mappings are reported.
- [x] Sub-workflow output mappings are checked against declared outputs.
- [x] Recursive local and cross-document call cycles are detected.
- [x] Composition diagnostics appear in Workflow Studio.
- [x] Local, external, invalid-mapping, and recursive fixtures are verified.
- [x] `npm run build` and `npm run verify` pass.

### Task 16: Support async steps and full DAG editing

Model send/receive, correlation, timeout, parallel branches, joins, and cycles.

**Acceptance criteria**

- [x] Arazzo 1.1 `action`, `channelPath`, `correlationId`, and `timeout` fields are modeled.
- [x] `send` and `receive` actions are validated for AsyncAPI targets.
- [x] `correlationId` is restricted to receive steps.
- [x] `timeout` must be a non-negative integer.
- [x] Receive steps are warned when success criteria are absent.
- [x] Async targets remain visible even when their AsyncAPI source is not locally bound.
- [x] Channel calls are represented as distinct graph nodes and edges.
- [x] Official schema-based workflow inputs and output maps are supported alongside the earlier array form.
- [x] Nested workflow input expressions such as `$inputs.productDetails.productId` are accepted.
- [x] Step dependencies can be edited as a checkbox DAG.
- [x] Dependencies can be cleared without corrupting normalized or raw Arazzo.
- [x] Multiple incoming dependency edges model parallel branches and joins.
- [x] Dependency cycles remain validator errors.
- [x] Valid, invalid, fan-out/fan-in, and dependency-clearing fixtures are verified.
- [x] `npm run build` and `npm run verify` pass.

## Milestone 4 — Planning and simulation

### Task 17: Implement execution-plan compilation

Produce a static topology and binding plan without network activity.

**Acceptance criteria**

- [x] Resolved workflows compile into a typed static execution plan.
- [x] Steps are ordered topologically from `dependsOn`.
- [x] Fan-out and join topology retain multiple prerequisites.
- [x] Dependency cycles produce an explicit plan diagnostic and partial plan.
- [x] Operation, workflow, AsyncAPI, and unresolved targets are represented.
- [x] Parameter, request-body, output, action, async, correlation, and timeout bindings are retained.
- [x] Runtime-expression bindings are marked dynamic without being evaluated.
- [x] Unbound AsyncAPI and unresolved operation bindings are marked blocked.
- [x] The plan explicitly declares `static-only` network policy and `none` fetch policy.
- [x] Workflow Studio displays the read-only static plan.
- [x] Compilation performs no network activity.
- [x] Resolved, unresolved, async, and parallel-join plans are exercised by verification.
- [x] `npm run build` and `npm run verify` pass.

### Task 18: Implement mock execution

Evaluate expressions, selectors, criteria, and actions against examples or
user-provided data.

**Acceptance criteria**

- [x] Mock execution accepts user-provided inputs and per-step examples.
- [x] `$inputs`, `$steps`, `$response`, `$message`, and `$statusCode` values are evaluated.
- [x] Nested input and step-output paths are supported.
- [x] JSON Pointer suffixes and embedded brace expressions are supported.
- [x] Parameter and request-body bindings are materialized in memory.
- [x] JSONPath, JSON Pointer, regex, and simple criteria are evaluated.
- [x] Successful and failed criteria paths are represented.
- [x] Step outputs are evaluated through selectors or runtime expressions.
- [x] Success and failure actions are selected without running retry loops.
- [x] Async receive success, outputs, and timeout behavior can be mocked.
- [x] Unresolved targets remain blocked.
- [x] Mock execution explicitly declares `mock-only` network policy and `none` fetch policy.
- [x] The UI provides an in-browser mock context editor and result list.
- [x] No network request is issued by mock execution.
- [x] Success, failure, runtime-expression, selector, action, and async-timeout fixtures are verified.
- [x] `npm run build` and `npm run verify` pass.

## Milestone 5 — Real execution adapters

### Task 19: Define runner adapters

Add a runner interface with mock, opt-in browser dry-run, future server-runner,
and external-runner implementations.

**Acceptance criteria**

- [x] A common runner adapter contract is defined.
- [x] Each adapter declares network policy and mock/preview/live capabilities.
- [x] The mock adapter performs in-memory execution only.
- [x] The browser dry-run adapter executes mocks and returns request previews.
- [x] Request previews retain method, path, query, headers, content type, and body.
- [x] Previews explicitly warn about base URL, authentication, CORS, and credentials.
- [x] Server and external adapters remain non-live and return actionable diagnostics.
- [x] Future adapters retain request previews without enabling execution.
- [x] Workflow Studio shows request previews as preview-only.
- [x] No adapter issues a network request in this release.
- [x] Mock, dry-run, server, and external adapters are exercised by verification.
- [x] `npm run build` and `npm run verify` pass.
