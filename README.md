<div align="center">

# API Atlas

**Your map to the API specification ecosystem — visualize, orchestrate, and validate, entirely in your browser.**

[English](./README.md) · [简体中文](./README.zh-CN.md)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![OpenAPI](https://img.shields.io/badge/OpenAPI-2.0%20%7C%203.0%20%7C%203.1%20%7C%203.2-6BA539)](https://www.openapis.org/)
[![Arazzo](https://img.shields.io/badge/Arazzo-1.0%20%7C%201.1-854CE6)](https://spec.openapis.org/arazzo/latest.html)
[![AsyncAPI](https://img.shields.io/badge/AsyncAPI-2.x%20%7C%203.x-F41D5E)](https://www.asyncapi.com/)
[![React](https://img.shields.io/badge/React-18-61DAFB)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6)](https://www.typescriptlang.org/)

*Formerly OpenAPI Visualizer*

</div>

---

## The Problem

Modern API ecosystems span multiple specification formats:

- **OpenAPI** describes *what* endpoints exist and how to call them
- **Arazzo** describes *how* to chain those endpoints into business workflows
- **AsyncAPI** describes *how* messages flow through event-driven channels

Each has its own tooling, but **no tool lets you see and work with all three together** — even though a real
business process crosses all boundaries. You end up with disconnected views, manual cross-referencing, and no
single place to validate that your workflow targets actually exist in your OpenAPI documents.

## What API Atlas Does

API Atlas is a **local-first, browser-based workspace** for the API specification ecosystem. It treats these
specs as one interconnected model, not isolated files:

| Surface | What you do |
|---|---|
| **API** | Explore OpenAPI/Swagger documents as progressive, layer-by-layer architecture graphs |
| **Flow** | Author, validate, and mock-execute Arazzo workflows against bound OpenAPI/AsyncAPI documents |

Think of it as:

- **OpenAPI is the terrain map** — what endpoints, schemas, and security schemes exist
- **Arazzo is the route map** — which paths to take, in what order, with what data
- **AsyncAPI is the weather map** — which message channels flow in which directions

All three maps live in **one atlas**, bound together in your browser.

## Highlights

### API Ecosystem Visualization

- **Progressive exploration:** root → paths/webhooks → operations → parameters/request/response → schemas → fields
- **True relationship model:** shared schemas, parameters, and security schemes remain reusable nodes, not duplicated trees
- **Full spec coverage:** OpenAPI 3.2 (including `QUERY`, `additionalOperations`, `$self`, streaming media types), 3.1, 3.0, and Swagger 2.0
- **Enterprise inspector:** parameters, request bodies, response models, schema constraints, source YAML, and incoming/outgoing relationships
- **Global search:** endpoints, operation IDs, schemas, fields, descriptions, component names
- **Visual model export:** normalized JSON graph for documentation and downstream analysis

### Arazzo Workflow Orchestration

- **Arazzo-native authoring:** import, edit, and export standard Arazzo 1.0/1.1 YAML/JSON with specification extensions preserved and round-trip verified
- **Cross-document binding:** bind Arazzo `sourceDescriptions` to local OpenAPI and AsyncAPI documents; remote URLs are never fetched
- **Semantic resolution:** `operationId`, `operationPath` (dot and JSON Pointer forms), and `channelPath` targets resolve against bound documents with actionable diagnostics
- **Official schema validation:** vendored Arazzo JSON Schemas (draft 2020-12) — the full 67-fixture official test corpus passes
- **Full selector engine:** RFC 9535 JSONPath (filters, functions, Nothing semantics), XPath 1.0, and JSON Pointer — shared by validation, criteria, and mock execution
- **Async step modeling:** AsyncAPI channel/operation/message indexing with send/receive actions, correlation IDs, and timeouts
- **Static execution plans:** topological ordering, binding resolution, dynamic parameter tracing, blocked-step analysis
- **In-memory mock execution:** animated step-by-step DAG playback with success/failure/blocked status, request previews (never sent), and criterion evaluation
- **Step inspector drawer:** full-screen detail with target binding, async settings, DAG dependencies, parameter mappings, outputs, source snippets, and diagnostics
- **Rich step cards:** action badges showing HTTP method, source, async action, parameter count, and request body — clickable method badges jump to the OpenAPI operation

## Quick Start

```bash
npm install
npm run dev
```

Open `http://localhost:5173` and click **Pet flow** to load the bundled demo (OpenAPI + AsyncAPI + Arazzo, pre-bound).

### Import your ecosystem

1. Click **Open file** (or paste YAML/JSON) to import your OpenAPI, Arazzo, or AsyncAPI documents
2. If importing an Arazzo workflow, also import the documents it references
3. Bind each source description to a compatible local document in the Flow sidebar
4. The workflow DAG resolves automatically — click any step for full details

### Run a mock execution

```json
{
  "inputs": { "requestId": "req-1", "petId": "pet-1" },
  "examples": {
    "listPets": { "statusCode": 200, "response": { "body": [{ "id": "pet-1", "name": "Rex" }] } },
    "confirmAdoptionEvent": { "message": { "payload": { "status": "confirmed", "petId": "pet-1" } } }
  }
}
```

Paste this into the Mock execution panel and click **Run mock** — the workflow DAG animates step-by-step. No network requests are made.

## Workflow Views

| View | Purpose |
|---|---|
| **Execution view** (default) | Pure workflow DAG — steps only, with call targets absorbed into step badges |
| **Structure view** | Full document topology — document → sources → workflows → steps → targets |

## Validation Pipeline

Every document passes through four validation layers:

1. **Parser validation** — structural requirements, version support, YAML/JSON syntax
2. **Official schema validation** — vendored Arazzo JSON Schemas with actionable messages
3. **Semantic validation** — duplicate IDs, dependency cycles, action shapes, target resolution
4. **Runtime expression validation** — JSONPath/XPath syntax, selector contexts, input/output references

## Architecture

```text
Browser (client-only, zero network egress)
├── App shell & surface routing (API / Flow)
├── Document import (paste / file / samples)
├── Three document engines
│   ├── OpenAPI engine (2.0 → 3.2)
│   ├── Arazzo parser/serializer (1.0/1.1)
│   └── AsyncAPI parser (2.x/3.x)
├── Document registry & workspace store
├── Semantic resolver & validators
│   ├── Capability indexes (OpenAPI + AsyncAPI)
│   └── Official schema validation
├── Selector engines (JSONPath · XPath · JSON Pointer)
├── Static plan & mock execution (preview-only)
└── Workflow Studio UI (DAG canvas · step drawer · editors)
```

<details>
<summary>📚 Detailed documentation</summary>

- [Arazzo Architecture](./docs/arazzo/architecture.md) — product scope, architecture decisions, module boundaries
- [Arazzo Roadmap](./docs/arazzo/roadmap.md) — delivery plan with 25 completed tasks
- [ADR-0001](./docs/arazzo/decisions/0001-arazzo-native-workflow-studio.md) — build an Arazzo-native workflow studio
- [Official Schema Test Corpus](./tests/arazzo-schema/) — 67 vendored fixtures from the OAI repository

</details>

## Roadmap

| Phase | Status | Scope |
|---|---|---|
| OpenAPI visualization | ✅ Done | 2.0 → 3.2 progressive graph, inspector, search, export |
| Arazzo workflow orchestration | ✅ Done | 1.0/1.1 authoring, validation, mock execution, selector engines |
| AsyncAPI document support | ✅ Done | 2.x/3.x parsing, channel/operation indexing, async step modeling |
| Real execution adapters | 🔜 Next | Opt-in server/browser runners with authentication |
| Team collaboration | 📋 Planned | Shared workspaces, comments, version comparison |
| More specifications | 🔍 Exploring | JSON Schema, gRPC/Proto, GraphQL SDL |

## Development

```bash
npm install        # Install dependencies
npm run dev        # Start dev server
npm run build      # TypeScript check + production build
npm run verify     # Full verification suite
npm run preview    # Preview production build
```

## Privacy

- All documents are parsed **in your browser** — nothing is uploaded
- Remote `sourceDescription` URLs are **never fetched** automatically
- Mock execution issues **zero network requests**
- `localStorage` stores only theme, inspector, and language preferences

## Language

The UI auto-detects your system language (Chinese/English) and supports manual switching via the button in the
bottom-right corner of any page.

## License

[MIT License](./LICENSE). Vendored Arazzo JSON Schemas and test fixtures are from the
[OAI/Arazzo-Specification repository](https://github.com/OAI/Arazzo-Specification) (Apache License 2.0).
