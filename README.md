# OpenAPI Visualizer

OpenAPI Visualizer is released under the [MIT License](./LICENSE).

OpenAPI Visualizer turns standard OpenAPI and Swagger YAML/JSON files into a progressive, interactive visualization.
It is designed for large, normalized enterprise API specifications: expand a domain layer by layer, click any node to
inspect its exact definition, and follow shared `$ref` relationships across operations and schemas.

## Highlights

- **Progressive exploration:** root → paths/webhooks → operations → parameters/request/response → schemas → fields.
- **Relationship model, not just a tree:** shared schemas, parameters, responses, request bodies, and security schemes remain reusable nodes.
- **Standard formats:** supports OpenAPI 3.1.x, 3.0.x, and Swagger 2.0 YAML or JSON.
- **Collapsible inspector:** operation parameters, request bodies, response models, schema constraints, source YAML, and incoming/outgoing relationships in a right-edge drawer.
- **Search:** global search across endpoint paths, operation IDs, schemas, fields, descriptions, component names, and pointers.
- **Light and dark themes:** follows the system preference by default and remembers your manual choice.
- **Anchor camera:** expanding or collapsing a node keeps that node centered after the visualization is relaid out.
- **Visual model export:** export a normalized visual model as JSON for documentation, automation, or downstream analysis.
- **Local processing:** files are parsed in the browser and are not uploaded.

## Visual model

The parser normalizes these standard API surfaces:

- `paths`, path-level parameters, and all HTTP operations
- OpenAPI 3.1 `webhooks`
- `components.schemas`
- `components.securitySchemes` / Swagger `securityDefinitions`
- reusable parameters, request bodies, responses, headers, examples, links, callbacks, and path items
- Swagger `definitions`, `parameters`, and `responses`
- request bodies, response content types, headers, and response schemas
- internal JSON Pointer `$ref` values and external reference nodes
- JSON Schema composition: `allOf`, `anyOf`, `oneOf`, arrays, nested objects, and common applicator schemas
- servers and tags

The renderer only displays nodes reachable from currently expanded nodes, so a large specification does not become an
unreadable one-shot diagram.

## Development

```bash
npm install
npm run dev
```

Build:

```bash
npm run build
```

Preview the production build:

```bash
npm run preview
```

## Bundled sample

The landing-page PetStore sample is adapted from the public
[Modern Petstore 3.2 specification](https://petstoreapi.com/v1/specs/modern-petstore-3.2.openapi.yaml). It is stored as
an OpenAPI 3.1.0 document so it remains within this project's current supported format. The adaptation removes
OpenAPI 3.2-only surfaces (`QUERY`, reusable media types, hierarchical tag fields, and `$self`) while retaining the
PetStore paths, schemas, security schemes, servers, and webhooks.

Current normalized size:

```text
12 normalized path nodes
18 operations
2 webhooks
15 normalized schema nodes
119 references
490 visual nodes
620 relationship edges
```

## Interaction

- Click a node to select it. The right drawer is collapsed by default to preserve a full-width canvas; use its attached edge button to pull the details open.
- Press `Escape` to close the details drawer. Your expanded/collapsed preference is remembered for the next visit.
- Double-click a node to expand or collapse its next layer.
- Press `+N` on a node to expand it and see how many children are available.
- Expanding or collapsing a node keeps the operated node centered after relayout.
- Search, then press Enter or choose a result to reveal and focus that node.
- Switch between left-to-right and top-to-bottom layered layouts.
- Filter by HTTP method.
- Switch between light and dark themes from the toolbar.
- Use **Reset** to return the canvas to the first layer.

## Technology

- React + TypeScript + Vite
- `@xyflow/react` for the interactive node-link canvas
- `@dagrejs/dagre` for layered node-link layout
- `yaml` for YAML and JSON parsing
- Zustand for document and visualization interaction state
- Tailwind-free handcrafted dark UI with accessibility-friendly controls
