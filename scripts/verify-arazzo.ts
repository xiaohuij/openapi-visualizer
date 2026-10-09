import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validateArazzoWorkflowComposition } from "../src/arazzo/composition";
import { buildArazzoWorkflowGraph } from "../src/arazzo/graph-builder";
import { parseArazzoSource } from "../src/arazzo/parser";
import { validateArazzoRuntimeExpressions } from "../src/arazzo/runtime-expression";
import { serializeArazzoDocument } from "../src/arazzo/serializer";
import {
  evaluateJsonPath,
  evaluateJsonPointer,
  parseJsonPath,
  parseJsonPointer,
} from "../src/arazzo/selectors";
import { arazzoSourceSnippet } from "../src/arazzo/source-snippet";
import { parseSourceDescriptionPointer, resolveArazzoDocument } from "../src/arazzo/semantic-resolver";
import { validateArazzoDocument } from "../src/arazzo/validator";
import { parseAsyncApiSource } from "../src/asyncapi/parser";
import { parseOpenApiSource } from "../src/lib/visualizer";
import { sampleArazzo } from "../src/lib/sample-arazzo";
import { sampleAsyncApi } from "../src/lib/sample-asyncapi";
import { DocumentRegistry } from "../src/workflow/document-registry";
import { OpenApiCapabilityIndex } from "../src/workflow/capability-index";
import { AsyncApiCapabilityIndex } from "../src/workflow/asyncapi-capability-index";
import { compileArazzoExecutionPlan } from "../src/workflow/execution-plan";
import { executeArazzoMockPlan } from "../src/workflow/mock-execution";
import { getArazzoRunnerAdapter } from "../src/workflow/runners";
import { useWorkflowStore } from "../src/workflow/store";
import {
  applyArazzoEditorCommand,
  applyToArazzoEditorHistory,
  createArazzoEditorHistory,
  redoArazzoEditorHistory,
  undoArazzoEditorHistory,
} from "../src/workflow/commands";

const validArazzo = `arazzo: 1.1.0
$self: https://example.test/workflows/arazzo.yaml
info:
  title: Pet workflow
  version: 1.0.0
  description: Adopt and update a pet
sourceDescriptions:
  - name: petstore
    type: openapi
    url: modern-petstore-3.2.openapi.yaml
workflows:
  - workflowId: adoptPet
    summary: Adopt a pet
    steps:
      - stepId: listPets
        description: List available pets
        operationId: listPets
        parameters:
          - name: limit
            in: query
            value: 10
        onSuccess:
          - type: proceed
        outputs:
          - name: firstPetId
            selector:
              type: jsonpath
              context: $response.body
              selector: $[0].id
      - stepId: updatePet
        description: Mark the selected pet as adopted
        operationId: updatePet
        dependsOn:
          - listPets
components:
  parameters:
    limit:
      value: 10
x-openapi-visualizer:
  experimental: true
`;

const valid = parseArazzoSource(validArazzo, "pet-workflow.arazzo.yaml");
assert.deepEqual(valid.diagnostics, [], "valid Arazzo fixture should not produce diagnostics");
assert.equal(valid.document?.version, "1.1.0");
assert.equal(valid.document?.specificationVersion, "1.1");
assert.equal(valid.document?.self, "https://example.test/workflows/arazzo.yaml");
assert.equal(valid.document?.info.title, "Pet workflow");
assert.equal(valid.document?.info.pointer, "#/info");
assert.equal(valid.document?.sourceDescriptions[0]?.pointer, "#/sourceDescriptions/0");
assert.equal(valid.document?.sourceDescriptions[0]?.name, "petstore");
assert.equal(valid.document?.workflows[0]?.workflowId, "adoptPet");
assert.equal(valid.document?.workflows[0]?.pointer, "#/workflows/0");
assert.equal(valid.document?.workflows[0]?.steps.length, 2);
assert.equal(valid.document?.workflows[0]?.steps[1]?.pointer, "#/workflows/0/steps/1");
assert.equal(valid.document?.workflows[0]?.steps[1]?.dependsOn?.[0], "listPets");
assert.match(
  arazzoSourceSnippet(validArazzo, "#/workflows/0/steps/1") ?? "",
  /stepId: updatePet/,
  "source snippets should locate the original YAML range for a step",
);
assert.deepEqual(
  valid.document?.components?.parameters,
  { limit: { value: 10 } },
  "component containers should remain available as raw data in Phase 1",
);

const jsonPointer = parseJsonPointer("/pets/0/name~1suffix");
assert.deepEqual(jsonPointer.value, ["pets", "0", "name/suffix"]);
assert.equal(parseJsonPointer("pets/0")?.error, "A JSON Pointer must be empty or start with /.");
assert.equal(
  evaluateJsonPointer({ pets: [{ "name/suffix": "Rex" }] }, "/pets/0/name~1suffix").value,
  "Rex",
);
const jsonPath = parseJsonPath("$['pets'][0].name");
assert.deepEqual(jsonPath.value, [
  { type: "child", selectors: [{ kind: "name", name: "pets" }] },
  { type: "child", selectors: [{ kind: "index", index: 0 }] },
  { type: "child", selectors: [{ kind: "name", name: "name" }] },
]);
assert.match(parseJsonPath("$.pets[")?.error ?? "", /A JSONPath bracket is missing \]/);
assert.deepEqual(
  evaluateJsonPath({ pets: [{ name: "Rex" }] }, "$.pets[*].name").value,
  ["Rex"],
);
assert.deepEqual(
  evaluateJsonPath({ nested: { pet: { id: 7 } }, other: { pet: { id: 8 } } }, "$..pet.id").value,
  [7, 8],
);

// --- Full RFC 9535 JSONPath coverage ---
const selectorCatalog = {
  store: { region: "cn-north", open: true, "weird'name": "escaped" },
  maxPrice: 100,
  pets: [
    { id: 1, name: "Rex", species: "dog", price: 120, tags: ["big", "loud"] },
    { id: 2, name: "Milo", species: "cat", price: 80, tags: ["quiet"] },
    { id: 3, name: "Bella", species: "dog", price: 150, tags: [] },
  ],
  archived: { pets: [{ id: 9, name: "Old", species: "dog" }] },
};

const select = (path: string) => evaluateJsonPath(selectorCatalog, path).value;
assert.deepEqual(select("$.pets[-1]"), [{ id: 3, name: "Bella", species: "dog", price: 150, tags: [] }], "negative indexes select from the end");
assert.deepEqual(select("$.pets[1:].name"), ["Milo", "Bella"], "slices support open ends");
assert.deepEqual(select("$.pets[:2].name"), ["Rex", "Milo"], "slices support open starts");
assert.deepEqual(select("$.pets[::2].name"), ["Rex", "Bella"], "slices support steps");
assert.deepEqual(select("$.pets[::-1].name"), ["Bella", "Milo", "Rex"], "negative steps reverse arrays");
assert.deepEqual(select("$.pets[0,2].name"), ["Rex", "Bella"], "unions combine index selectors");
assert.deepEqual(select("$.store['region','open']"), ["cn-north", true], "unions combine name selectors");
assert.deepEqual(select("$..id"), [1, 2, 3, 9], "recursive descent visits nested containers");
assert.deepEqual(select("$..tags[*]"), ["big", "loud", "quiet"], "recursive descent supports bracketed wildcards");
assert.deepEqual(select("$.store['weird\\'name']"), ["escaped"], "quoted names support escapes");
assert.deepEqual(
  select("$.pets[ ? @.species == 'dog' ].name"),
  ["Rex", "Bella"],
  "equality filters tolerate inner whitespace",
);
assert.deepEqual(select("$.pets[?@.price > 100].name"), ["Rex", "Bella"], "order filters compare numbers");
assert.deepEqual(
  select("$.pets[?@.species == 'dog' && @.price < 130].name"),
  ["Rex"],
  "filters combine with &&",
);
assert.deepEqual(
  select("$.pets[?@.species == 'cat' || @.id == 3].name"),
  ["Milo", "Bella"],
  "filters combine with ||",
);
assert.deepEqual(select("$.pets[?!(@.species == 'dog')].name"), ["Milo"], "filters support negation and parentheses");
assert.deepEqual(select("$.pets[?@.name =~ /R.*/].name"), ["Rex"], "regex filters match substrings");
assert.deepEqual(
  select("$.pets[?@.price > $.maxPrice].name"),
  ["Rex", "Bella"],
  "filters can compare against root-relative paths",
);
assert.deepEqual(select("$.pets[?@.tags[0] == 'big'].name"), ["Rex"], "filter paths support nested indexes");
assert.deepEqual(select("$.store[?@ == true]"), [true], "filters can compare the current node");
assert.deepEqual(select("$.pets[?length(@.tags) > 1].name"), ["Rex"], "length() counts array members");
assert.deepEqual(select("$.pets[?count(@.tags[*]) == 2].name"), ["Rex"], "count() counts selected nodes");
assert.deepEqual(select("$.pets[?match(@.species, 'dog')].name"), ["Rex", "Bella"], "match() requires a full string match");
assert.deepEqual(select("$.pets[?search(@.name, '^R')].name"), ["Rex"], "search() finds partial matches");
assert.deepEqual(select("$.pets[?value(@.id) == 2].name"), ["Milo"], "value() extracts the first node");
assert.deepEqual(select("$.pets[?length(@.missing) == 0]"), [], "missing function arguments produce Nothing");
assert.match(
  parseJsonPath("$.pets[?@.tags[*] == 'big']")?.error ?? "",
  /Comparison operands must use singular queries/,
  "non-singular comparison operands are rejected",
);
assert.match(
  parseJsonPath("$.pets[?@.name =~ 'Rex']")?.error ?? "",
  /right side of =~ must be a \/regex\/ literal/,
  "regex comparisons require regex literals",
);
assert.match(
  parseJsonPath("$.pets[0:3:0]")?.error ?? "",
  /slice step cannot be zero/,
  "zero slice steps are rejected",
);
assert.deepEqual(
  validateArazzoRuntimeExpressions(valid.document!),
  [],
  "valid runtime expressions and selectors should not produce diagnostics",
);

const runtimeArazzo = parseArazzoSource(
  `arazzo: 1.1.0
info:
  title: Runtime expressions
  version: 1.0.0
sourceDescriptions:
  - name: petstore
    type: openapi
    url: catalog-api.yaml
workflows:
  - workflowId: expressionFlow
    parameters:
      - name: limit
      - name: token
    outputs:
      - name: petId
        selector:
          type: jsonpointer
          context: $response.body
          selector: /pet/id
    steps:
      - stepId: list
        operationId: listPets
        outputs:
          - name: petId
            selector:
              type: jsonpath
              context: $response.body
              selector: $.id
      - stepId: update
        operationId: updatePet
        dependsOn:
          - list
        parameters:
          - name: limit
            in: query
            value: $inputs.limit
          - name: petId
            in: path
            value: $steps.list.outputs.petId
          - name: missingInput
            in: query
            value: $inputs.missing
          - name: missingOutput
            in: query
            value: $steps.list.outputs.missing
        requestBody:
          contentType: application/json
          payload:
            token: $inputs.token
        outputs:
          - name: broken
            selector:
              type: jsonpath
              context: $response.body
              selector: $.pet[
`,
  "runtime-expressions.arazzo.yaml",
);
assert.ok(runtimeArazzo.document, "runtime-expression fixture should parse");
const runtimeDiagnostics = validateArazzoRuntimeExpressions(runtimeArazzo.document);
for (const code of [
  "ARAZZO_WORKFLOW_INPUT_UNRESOLVED",
  "ARAZZO_STEP_OUTPUT_UNRESOLVED",
  "ARAZZO_SELECTOR_INVALID",
]) {
  assert.ok(
    runtimeDiagnostics.some(diagnostic => diagnostic.code === code),
    `runtime-expression validator should report ${code}`,
  );
}

const asyncArazzo = parseArazzoSource(
  `arazzo: 1.1.0
info:
  title: Async order workflow
  version: 1.0.0
sourceDescriptions:
  - name: orders
    type: asyncapi
    url: orders.asyncapi.yaml
workflows:
  - workflowId: placeAndConfirm
    inputs:
      type: object
      required:
        - correlationId
        - productDetails
      properties:
        correlationId:
          type: string
        productDetails:
          type: object
    steps:
      - stepId: placeOrder
        operationId: $sourceDescriptions.orders.placeOrder
        action: send
        parameters:
          - name: requestId
            in: header
            value: $inputs.correlationId
        requestBody:
          contentType: application/json
          payload:
            productId: $inputs.productDetails.productId
      - stepId: confirmOrder
        operationId: $sourceDescriptions.orders.confirmOrder
        action: receive
        correlationId: $inputs.correlationId
        timeout: 6000
        dependsOn:
          - placeOrder
        successCriteria:
          - condition: $message.payload.status == confirmed
        outputs:
          orderId: $message.payload.orderId
`,
  "async-order.arazzo.yaml",
);
assert.ok(asyncArazzo.document, "official async step fixture should parse");
assert.equal(
  validateArazzoDocument(asyncArazzo.document).filter(diagnostic => diagnostic.severity === "error").length,
  0,
  "valid async steps should not produce validator errors",
);
assert.deepEqual(
  validateArazzoRuntimeExpressions(asyncArazzo.document).filter(diagnostic => diagnostic.severity === "error"),
  [],
  "valid async runtime expressions should resolve against schema workflow inputs",
);
const asyncRegistry = new DocumentRegistry();
const asyncEntry = asyncRegistry.upsertArazzo(asyncArazzo.document, asyncArazzo.diagnostics);
const asyncResolution = resolveArazzoDocument(
  asyncArazzo.document,
  asyncRegistry,
  new OpenApiCapabilityIndex([]),
);
assert.equal(asyncResolution.workflows[0]?.steps[0]?.target.kind, "asyncapi-target");
const asyncGraph = buildArazzoWorkflowGraph(asyncResolution);
assert.ok(asyncGraph.nodes.some(node => node.kind === "asyncapi-target"));
assert.ok(asyncGraph.edges.some(edge => edge.relation === "channel-call"));
assert.ok(
  asyncGraph.edges.some(
    edge =>
      edge.relation === "depends-on" &&
      asyncGraph.nodes.find(node => node.id === edge.source)?.stepId === "placeOrder" &&
      asyncGraph.nodes.find(node => node.id === edge.target)?.stepId === "confirmOrder",
  ),
);
const asyncExecutionPlan = compileArazzoExecutionPlan(asyncResolution);
assert.equal(asyncExecutionPlan.unresolvedTargets.length, 2);
assert.equal(asyncExecutionPlan.workflows[0]?.steps[1]?.async?.action, "receive");
assert.equal(asyncExecutionPlan.workflows[0]?.steps[1]?.async?.timeout, 6000);
const asyncMockResult = executeArazzoMockPlan(asyncExecutionPlan, {
  inputs: {
    correlationId: "order-1",
    productDetails: { productId: "product-1" },
  },
  examples: {
    confirmOrder: { message: { payload: { status: "confirmed", orderId: "order-9" } } },
  },
});
assert.equal(asyncMockResult.workflows[0]?.steps[0]?.status, "succeeded");
assert.equal(asyncMockResult.workflows[0]?.steps[1]?.status, "succeeded");
assert.equal(asyncMockResult.workflows[0]?.steps[1]?.outputs.orderId, "order-9");
const asyncTimeoutResult = executeArazzoMockPlan(asyncExecutionPlan, {
  inputs: {
    correlationId: "order-1",
    productDetails: { productId: "product-1" },
  },
  examples: { confirmOrder: { timeout: true } },
});
assert.equal(asyncTimeoutResult.workflows[0]?.steps[1]?.status, "failed");
assert.match(asyncTimeoutResult.workflows[0]?.steps[1]?.failureReason ?? "", /Timed out/);
void asyncEntry;

const clearDependency = applyArazzoEditorCommand(valid.document!, {
  type: "arazzo/updateStep",
  workflowId: "adoptPet",
  stepId: "updatePet",
  patch: { dependsOn: null },
});
assert.ok(clearDependency.document, "clearing a DAG dependency should produce a document");
assert.equal(clearDependency.document.workflows[0]?.steps[1]?.dependsOn, undefined);
const clearDependencyRoundTrip = parseArazzoSource(
  clearDependency.document.sourceText,
  "clear-dependency.arazzo.yaml",
);
assert.ok(clearDependencyRoundTrip.document);
assert.equal(clearDependencyRoundTrip.document.workflows[0]?.steps[1]?.dependsOn, undefined);
assert.equal(valid.document?.workflows[0]?.steps[1]?.dependsOn?.[0], "listPets");

const invalidAsync = parseArazzoSource(
  `arazzo: 1.1.0
info:
  title: Invalid async
  version: 1.0.0
sourceDescriptions:
  - name: orders
    type: asyncapi
    url: orders.asyncapi.yaml
workflows:
  - workflowId: broken
    steps:
      - stepId: broken
        operationId: $sourceDescriptions.orders.placeOrder
        channelPath: $sourceDescriptions.orders/channels/place
        action: publish
        correlationId: $inputs.correlationId
        timeout: -1
`,
  "invalid-async.arazzo.yaml",
);
assert.ok(invalidAsync.document, "invalid async fixture should parse structurally");
const invalidAsyncDiagnostics = validateArazzoDocument(invalidAsync.document);
for (const code of [
  "ARAZZO_STEP_TARGET_CONFLICT",
  "ARAZZO_CHANNEL_TARGET_INVALID",
  "ARAZZO_ASYNC_ACTION_INVALID",
  "ARAZZO_CORRELATION_ACTION_INVALID",
  "ARAZZO_STEP_TIMEOUT_INVALID",
]) {
  assert.ok(
    invalidAsyncDiagnostics.some(diagnostic => diagnostic.code === code),
    `async validator should report ${code}`,
  );
}

const parallelJoin = parseArazzoSource(
  `arazzo: 1.1.0
info:
  title: Parallel join
  version: 1.0.0
sourceDescriptions:
  - name: api
    type: openapi
    url: catalog-api.yaml
workflows:
  - workflowId: fanOutFanIn
    steps:
      - stepId: start
        operationId: listPets
      - stepId: left
        operationId: createPet
        dependsOn:
          - start
      - stepId: right
        operationId: updatePet
        dependsOn:
          - start
      - stepId: join
        operationId: listPets
        dependsOn:
          - left
          - right
`,
  "parallel-join.arazzo.yaml",
);
assert.ok(parallelJoin.document, "parallel-join fixture should parse");
const parallelRegistry = new DocumentRegistry();
parallelRegistry.upsertArazzo(parallelJoin.document, parallelJoin.diagnostics);
const parallelGraph = buildArazzoWorkflowGraph(
  resolveArazzoDocument(parallelJoin.document, parallelRegistry, new OpenApiCapabilityIndex([])),
);
assert.equal(
  parallelGraph.edges.filter(
    edge =>
      edge.relation === "depends-on" &&
      parallelGraph.nodes.find(node => node.id === edge.target)?.stepId === "join",
  ).length,
  2,
  "a join should preserve multiple incoming dependency edges",
);
const parallelPlan = compileArazzoExecutionPlan(
  resolveArazzoDocument(parallelJoin.document, parallelRegistry, new OpenApiCapabilityIndex([])),
);
const parallelOrder = parallelPlan.workflows[0]?.steps.map(step => step.stepId) ?? [];
assert.ok(parallelOrder.indexOf("start") < parallelOrder.indexOf("left"));
assert.ok(parallelOrder.indexOf("start") < parallelOrder.indexOf("right"));
assert.ok(parallelOrder.indexOf("left") < parallelOrder.indexOf("join"));
assert.ok(parallelOrder.indexOf("right") < parallelOrder.indexOf("join"));
assert.deepEqual(
  (valid.document?.raw["x-openapi-visualizer"] as Record<string, unknown> | undefined),
  { experimental: true },
  "specification extensions should be retained",
);

const addStepResult = applyArazzoEditorCommand(valid.document!, {
  type: "arazzo/addStep",
  workflowId: "adoptPet",
  stepId: "createPet",
  operationId: "createPet",
  description: "Create the selected pet record",
  parameters: [{ name: "tenant", in: "header", value: "public" }],
  requestBody: { contentType: "application/json", payload: { name: "Rex" } },
});
assert.deepEqual(addStepResult.diagnostics, [], "adding a valid step should not produce command diagnostics");
assert.ok(addStepResult.document, "adding a valid step should produce a document");
assert.equal(valid.document?.workflows[0]?.steps.length, 2, "editor commands must not mutate the input document");
assert.equal(addStepResult.document.workflows[0]?.steps.length, 3);
const editedRoundTrip = parseArazzoSource(addStepResult.document.sourceText, "edited.arazzo.yaml");
assert.ok(editedRoundTrip.document, "edited Arazzo YAML should round-trip through the parser");
assert.equal(editedRoundTrip.document.workflows[0]?.steps[2]?.stepId, "createPet");
assert.deepEqual(
  editedRoundTrip.document.workflows[0]?.steps[2]?.parameters,
  [{ name: "tenant", in: "header", value: "public" }],
);
assert.deepEqual(
  editedRoundTrip.document.workflows[0]?.steps[2]?.requestBody,
  { contentType: "application/json", payload: { name: "Rex" } },
);

const updateMappingsResult = applyArazzoEditorCommand(valid.document!, {
  type: "arazzo/updateStep",
  workflowId: "adoptPet",
  stepId: "listPets",
  patch: {
    parameters: [{ name: "limit", in: "query", value: "$inputs.limit" }],
    requestBody: { contentType: "application/json", payload: { filters: "$steps.listPets.output" } },
  },
});
assert.ok(updateMappingsResult.document, "mapping update should produce a document");
assert.equal(
  updateMappingsResult.document.workflows[0]?.steps[0]?.parameters?.[0]?.value,
  "$inputs.limit",
  "runtime expressions should remain strings",
);
const removeBodyResult = applyArazzoEditorCommand(updateMappingsResult.document, {
  type: "arazzo/updateStep",
  workflowId: "adoptPet",
  stepId: "listPets",
  patch: { requestBody: null },
});
assert.ok(removeBodyResult.document, "clearing a request body should produce a document");
assert.equal(removeBodyResult.document.workflows[0]?.steps[0]?.requestBody, undefined);
const removeBodyRoundTrip = parseArazzoSource(removeBodyResult.document.sourceText, "remove-body.arazzo.yaml");
assert.ok(removeBodyRoundTrip.document);
assert.equal(removeBodyRoundTrip.document.workflows[0]?.steps[0]?.requestBody, undefined);
assert.deepEqual(
  editedRoundTrip.document.raw["x-openapi-visualizer"],
  valid.document?.raw["x-openapi-visualizer"],
);
assert.deepEqual(
  applyArazzoEditorCommand(valid.document!, {
    type: "arazzo/addStep",
    workflowId: "missing",
    stepId: "step",
    operationId: "op",
  }).diagnostics.map(diagnostic => diagnostic.code),
  ["ARAZZO_COMMAND_WORKFLOW_NOT_FOUND"],
);

let editorHistory = createArazzoEditorHistory(valid.document!);
editorHistory = applyToArazzoEditorHistory(editorHistory, {
  type: "arazzo/updateWorkflowMetadata",
  workflowId: "adoptPet",
  summary: "Edited adoption flow",
});
editorHistory = applyToArazzoEditorHistory(editorHistory, {
  type: "arazzo/updateStep",
  workflowId: "adoptPet",
  stepId: "updatePet",
  patch: { description: "Apply the adoption update" },
});
assert.equal(editorHistory.present.workflows[0]?.summary, "Edited adoption flow");
assert.equal(editorHistory.present.workflows[0]?.steps[1]?.description, "Apply the adoption update");
editorHistory = undoArazzoEditorHistory(editorHistory);
assert.equal(editorHistory.present.workflows[0]?.steps[1]?.description, "Mark the selected pet as adopted");
editorHistory = undoArazzoEditorHistory(editorHistory);
assert.equal(editorHistory.present.workflows[0]?.summary, "Adopt a pet");
editorHistory = redoArazzoEditorHistory(editorHistory);
editorHistory = redoArazzoEditorHistory(editorHistory);
assert.equal(editorHistory.present.workflows[0]?.summary, "Edited adoption flow");
assert.equal(editorHistory.present.workflows[0]?.steps[1]?.description, "Apply the adoption update");

const validJson = parseArazzoSource(
  JSON.stringify({
    arazzo: "1.0.1",
    info: { title: "JSON workflow", version: "1.0.0" },
    sourceDescriptions: [{ name: "api", type: "openapi", url: "api.json" }],
    workflows: [
      { workflowId: "callApi", steps: [{ stepId: "start", operationId: "list" }] },
    ],
  }),
  "workflow.arazzo.json",
);
assert.deepEqual(validJson.diagnostics, [], "Arazzo JSON fixture should parse");
assert.equal(validJson.document?.specificationVersion, "1.0");

const yamlExport = serializeArazzoDocument(valid.document!);
const yamlRoundTrip = parseArazzoSource(yamlExport, "round-trip.arazzo.yaml");
assert.deepEqual(yamlRoundTrip.diagnostics, [], "serialized Arazzo YAML should reparse without errors");
assert.equal(yamlRoundTrip.document?.workflows[0]?.steps[1]?.stepId, "updatePet");
assert.deepEqual(
  yamlRoundTrip.document?.raw["x-openapi-visualizer"],
  valid.document?.raw["x-openapi-visualizer"],
  "YAML export should retain specification extensions",
);
const jsonExport = serializeArazzoDocument(valid.document!, "json");
const jsonRoundTrip = parseArazzoSource(jsonExport, "round-trip.arazzo.json");
assert.deepEqual(jsonRoundTrip.diagnostics, [], "serialized Arazzo JSON should reparse without errors");
assert.equal(jsonRoundTrip.document?.info.title, "Pet workflow");
assert.equal(jsonRoundTrip.document?.self, valid.document?.self);

const unsupportedVersion = parseArazzoSource(
  validArazzo.replace("arazzo: 1.1.0", "arazzo: 2.0.0"),
  "future.arazzo.yaml",
);
assert.equal(unsupportedVersion.document, undefined, "unsupported Arazzo versions should not produce a document");
assert.ok(
  unsupportedVersion.diagnostics.some((diagnostic) => diagnostic.code === "ARAZZO_VERSION_UNSUPPORTED"),
  "unsupported Arazzo versions should produce a clear diagnostic",
);

const invalidYaml = parseArazzoSource("arazzo: [", "invalid.arazzo.yaml");
assert.equal(invalidYaml.document, undefined);
assert.ok(invalidYaml.diagnostics.some((diagnostic) => diagnostic.code === "ARAZZO_PARSE_FAILED"));

const missingRequired = parseArazzoSource("arazzo: 1.1.0\ninfo:\n  title: Missing fields\n", "missing.arazzo.yaml");
assert.equal(missingRequired.document, undefined);
for (const code of [
  "ARAZZO_INFO_VERSION_REQUIRED",
  "ARAZZO_SOURCE_DESCRIPTIONS_REQUIRED",
  "ARAZZO_WORKFLOWS_REQUIRED",
]) {
  assert.ok(
    missingRequired.diagnostics.some((diagnostic) => diagnostic.code === code),
    `missing required fixture should report ${code}`,
  );
}

const registry = new DocumentRegistry();
assert.ok(valid.document, "registry fixture requires a parsed Arazzo document");
const arazzoEntry = registry.upsertArazzo(valid.document, valid.diagnostics);
const openApiFixture = (title: string) => parseOpenApiSource(
  `openapi: 3.2.0\ninfo:\n  title: ${title}\n  version: 1.0.0\npaths: {}`,
  "api.yaml",
);
const firstApi = openApiFixture("First API");
const secondApi = openApiFixture("Second API");
assert.ok(firstApi.document && secondApi.document, "OpenAPI registry fixtures should parse");
registry.upsertOpenApi(firstApi.document);
const firstApiEntry = registry.upsertOpenApi(secondApi.document);
assert.equal(registry.listOpenApi().length, 1, "same-file replacement should not duplicate documents");

const binding = registry.bindSourceDescription(
  arazzoEntry.id,
  "petstore",
  firstApiEntry.id,
);
assert.ok(binding, "source descriptions should bind to a matching local document");
assert.equal(registry.resolveSourceDescription(arazzoEntry.id, "petstore")?.target.id, firstApiEntry.id);
assert.equal(
  registry.bindSourceDescription(arazzoEntry.id, "petstore", arazzoEntry.id),
  undefined,
  "source descriptions must not bind to an incompatible document kind",
);

registry.remove(firstApiEntry.id);
assert.equal(registry.getBinding(arazzoEntry.id, "petstore"), undefined, "removing a target should clear its bindings");
assert.equal(registry.listArazzo().length, 1);

const catalogApi = parseOpenApiSource(
  `openapi: 3.2.0
info:
  title: Catalog API
  version: 1.0.0
paths:
  /pets:
    get:
      operationId: listPets
      summary: List pets
      parameters:
        - name: limit
          in: query
          required: false
          schema:
            type: integer
      responses:
        '200':
          description: A pet list
          content:
            application/json:
              schema:
                type: array
    post:
      operationId: createPet
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
      responses:
        '201':
          description: Created
  /pets/{petId}:
    patch:
      operationId: updatePet
      parameters:
        - name: petId
          in: path
          required: true
          schema:
            type: string
      responses:
        '200':
          description: Updated`,
  "catalog-api.yaml",
);
assert.ok(catalogApi.document, "capability OpenAPI fixture should parse");
const catalogEntry = registry.upsertOpenApi(catalogApi.document);
const capabilities = new OpenApiCapabilityIndex(registry.listOpenApi());
const listPets = capabilities.findByOperationId("listPets", catalogEntry.id)[0];
assert.ok(listPets, "capability index should find operations by operationId");
assert.equal(listPets.method, "GET");
assert.equal(listPets.path, "/pets");
assert.equal(listPets.parameters[0]?.name, "limit");
assert.equal(listPets.responses[0]?.content[0]?.contentType, "application/json");
const createPet = capabilities.findByMethodPath("post", "/pets", catalogEntry.id);
assert.ok(createPet, "capability index should find operations by method and path");
assert.equal(createPet.requestBody?.required, true);
assert.equal(createPet.requestBody?.content[0]?.contentType, "application/json");

// --- Task 20: AsyncAPI capability index ---
const asyncApiV3 = parseAsyncApiSource(
  `asyncapi: 3.0.0
info:
  title: Order broker
  version: 1.0.0
channels:
  placeOrder:
    address: orders/place
    title: Place order
    messages:
      place.message:
        payload:
          type: object
          required:
            - productId
          properties:
            productId:
              type: string
  orderConfirmation:
    address: orders/confirm
    messages:
      confirm.message:
        payload:
          type: object
          properties:
            status:
              type: string
            orderId:
              type: string
operations:
  placeOrder:
    action: send
    summary: Publish an order
    channel:
      $ref: '#/channels/placeOrder'
    messages:
      - $ref: '#/channels/placeOrder/messages/place.message'
  confirmOrder:
    action: receive
    summary: Receive order confirmation
    channel:
      $ref: '#/channels/orderConfirmation'
    messages:
      - $ref: '#/channels/orderConfirmation/messages/confirm.message'
`,
  "orders-v3.asyncapi.yaml",
);
assert.deepEqual(asyncApiV3.diagnostics, [], "AsyncAPI 3.x fixture should parse without diagnostics");
assert.ok(asyncApiV3.document, "AsyncAPI 3.x fixture should produce a document");
assert.equal(asyncApiV3.document.specificationVersion, "3");
assert.deepEqual(
  asyncApiV3.document.operations.map(operation => [operation.operationId, operation.action, operation.channelId]),
  [
    ["placeOrder", "send", "placeOrder"],
    ["confirmOrder", "receive", "orderConfirmation"],
  ],
);

const asyncApiV2 = parseAsyncApiSource(
  `asyncapi: 2.6.0
info:
  title: Legacy order broker
  version: 1.0.0
channels:
  placeOrder:
    publish:
      operationId: placeOrder
      message:
        payload:
          type: object
  orderConfirmation:
    subscribe:
      operationId: confirmOrder
      message:
        payload:
          type: object
`,
  "orders-v2.asyncapi.yaml",
);
assert.deepEqual(asyncApiV2.diagnostics, [], "AsyncAPI 2.x fixture should parse without diagnostics");
assert.ok(asyncApiV2.document, "AsyncAPI 2.x fixture should produce a document");
assert.equal(asyncApiV2.document.specificationVersion, "2");
assert.deepEqual(
  asyncApiV2.document.operations.map(operation => [operation.operationId, operation.action, operation.channelId]),
  [
    ["placeOrder", "publish", "placeOrder"],
    ["confirmOrder", "subscribe", "orderConfirmation"],
  ],
);

const asyncApiRegistry = new DocumentRegistry();
const asyncV3Entry = asyncApiRegistry.upsertAsyncApi(asyncApiV3.document, asyncApiV3.diagnostics);
const asyncV2Entry = asyncApiRegistry.upsertAsyncApi(asyncApiV2.document, asyncApiV2.diagnostics);
assert.equal(asyncApiRegistry.listAsyncApi().length, 2, "AsyncAPI documents should coexist in the registry");
const asyncApiIndex = new AsyncApiCapabilityIndex(asyncApiRegistry.listAsyncApi());

const placeOrderByChannel = asyncApiIndex.findByChannelAction("placeOrder", "send", asyncV3Entry.id);
assert.ok(placeOrderByChannel, "AsyncAPI index should find operations by channel and send action");
assert.equal(placeOrderByChannel.normalizedAction, "send");
assert.equal(placeOrderByChannel.channelAddress, "orders/place");
assert.equal(placeOrderByChannel.messages.length, 1);
assert.deepEqual(
  placeOrderByChannel.messages[0]?.value,
  { payload: { type: "object", required: ["productId"], properties: { productId: { type: "string" } } } },
  "local message $ref targets should resolve within the same AsyncAPI document",
);

const confirmOrderById = asyncApiIndex.findByOperationId("confirmOrder", asyncV3Entry.id)[0];
assert.ok(confirmOrderById, "AsyncAPI index should find operations by operationId");
assert.equal(confirmOrderById.pointer, "#/operations/confirmOrder");

const v2Confirm = asyncApiIndex.findByOperationId("confirmOrder", asyncV2Entry.id)[0];
assert.ok(v2Confirm, "AsyncAPI 2.x operationIds should be indexed");
assert.equal(v2Confirm.action, "subscribe");
assert.equal(v2Confirm.normalizedAction, "receive");
assert.ok(
  asyncApiIndex.findByChannelAction("orderConfirmation", "receive", asyncV2Entry.id),
  "send/receive lookups should match legacy publish/subscribe declarations",
);

// --- Task 21: operationPath resolution ---
const dotPointer = parseSourceDescriptionPointer("$sourceDescriptions.catalog.paths./pets/{petId}.patch");
assert.deepEqual(dotPointer, {
  sourceName: "catalog",
  container: "paths",
  pointer: "/paths/~1pets~1{petId}/patch",
  segments: ["/pets/{petId}", "patch"],
  path: "/pets/{petId}",
  method: "patch",
});
const urlPointer = parseSourceDescriptionPointer("{$sourceDescriptions.catalog.url}#/paths/~1pets~1{petId}/patch");
assert.equal(urlPointer?.sourceName, "catalog");
assert.equal(urlPointer?.method, "patch");
assert.equal(urlPointer?.path, "/pets/{petId}");
assert.equal(urlPointer?.pointer, "/paths/~1pets~1{petId}/patch");

const hooksApi = parseOpenApiSource(
  `openapi: 3.2.0
info:
  title: Webhook API
  version: 1.0.0
webhooks:
  newPet:
    post:
      operationId: newPetEvent
      responses:
        '200':
          description: OK
`,
  "hooks-api.yaml",
);
assert.ok(hooksApi.document, "OpenAPI webhook fixture should parse");

const pathArazzo = parseArazzoSource(
  `arazzo: 1.1.0
info:
  title: Path targets
  version: 1.0.0
sourceDescriptions:
  - name: catalog
    type: openapi
    url: catalog-api.yaml
  - name: hooks
    type: openapi
    url: hooks-api.yaml
  - name: orders
    type: asyncapi
    url: orders-v3.asyncapi.yaml
workflows:
  - workflowId: pathTargets
    steps:
      - stepId: dotList
        operationPath: $sourceDescriptions.catalog.paths./pets.get
      - stepId: pointerUpdate
        operationPath: '{$sourceDescriptions.catalog.url}#/paths/~1pets~1{petId}/patch'
      - stepId: webhookPost
        operationPath: $sourceDescriptions.hooks.webhooks.newPet.post
      - stepId: asyncSend
        operationPath: $sourceDescriptions.orders.channels.placeOrder.send
      - stepId: asyncReceiveChannel
        channelPath: '{$sourceDescriptions.orders.url}#/channels/orderConfirmation'
        action: receive
      - stepId: asyncByOperationId
        operationId: $sourceDescriptions.orders.confirmOrder
        action: receive
        dependsOn:
          - asyncReceiveChannel
`,
  "path-targets.arazzo.yaml",
);
assert.ok(pathArazzo.document, "operationPath fixture should parse");
assert.deepEqual(
  validateArazzoDocument(pathArazzo.document).filter(diagnostic => diagnostic.severity === "error"),
  [],
  "valid operationPath and channelPath expressions should pass validation",
);

const pathRegistry = new DocumentRegistry();
const pathCatalogEntry = pathRegistry.upsertOpenApi(catalogApi.document!);
const pathHooksEntry = pathRegistry.upsertOpenApi(hooksApi.document!);
const pathOrdersEntry = pathRegistry.upsertAsyncApi(asyncApiV3.document!, asyncApiV3.diagnostics);
const pathArazzoEntry = pathRegistry.upsertArazzo(pathArazzo.document!, pathArazzo.diagnostics);
assert.ok(pathRegistry.bindSourceDescription(pathArazzoEntry.id, "catalog", pathCatalogEntry.id));
assert.ok(pathRegistry.bindSourceDescription(pathArazzoEntry.id, "hooks", pathHooksEntry.id));
assert.ok(pathRegistry.bindSourceDescription(pathArazzoEntry.id, "orders", pathOrdersEntry.id));

const pathResolution = resolveArazzoDocument(
  pathArazzo.document!,
  pathRegistry,
  new OpenApiCapabilityIndex(pathRegistry.listOpenApi()),
  asyncApiIndex,
);
assert.deepEqual(pathResolution.diagnostics, [], "bound operationPath targets should resolve without diagnostics");
const pathSteps = pathResolution.workflows[0]?.steps ?? [];
assert.equal(pathSteps.length, 6);
assert.equal(pathSteps[0]?.target.kind, "openapi-operation");
if (pathSteps[0]?.target.kind === "openapi-operation") {
  assert.equal(pathSteps[0].target.operation.method.toLowerCase(), "get");
  assert.equal(pathSteps[0].target.operation.path, "/pets");
}
assert.equal(pathSteps[1]?.target.kind, "openapi-operation");
if (pathSteps[1]?.target.kind === "openapi-operation") {
  assert.equal(pathSteps[1].target.operation.method.toLowerCase(), "patch");
  assert.equal(pathSteps[1].target.operation.path, "/pets/{petId}");
}
assert.equal(pathSteps[2]?.target.kind, "openapi-operation");
if (pathSteps[2]?.target.kind === "openapi-operation") {
  assert.equal(pathSteps[2].target.operation.webhook, true);
  assert.equal(pathSteps[2].target.operation.operationId, "newPetEvent");
}
assert.equal(pathSteps[3]?.target.kind, "asyncapi-target");
if (pathSteps[3]?.target.kind === "asyncapi-target") {
  assert.equal(pathSteps[3].target.resolved, true);
  assert.equal(pathSteps[3].target.operation?.channelId, "placeOrder");
  assert.equal(pathSteps[3].target.operation?.action, "send");
}
assert.equal(pathSteps[4]?.target.kind, "asyncapi-target");
if (pathSteps[4]?.target.kind === "asyncapi-target") {
  assert.equal(pathSteps[4].target.resolved, true);
  assert.equal(pathSteps[4].target.operation?.channelId, "orderConfirmation");
  assert.equal(pathSteps[4].target.operation?.normalizedAction, "receive");
}
assert.equal(pathSteps[5]?.target.kind, "asyncapi-target");
if (pathSteps[5]?.target.kind === "asyncapi-target") {
  assert.equal(pathSteps[5].target.operation?.operationId, "confirmOrder");
}

const pathGraph = buildArazzoWorkflowGraph(pathResolution);
assert.ok(
  pathGraph.nodes.some(node => node.kind === "asyncapi-target" && node.title === "placeOrder · send"),
  "resolved async graph nodes should describe their channel and action",
);
const pathPlan = compileArazzoExecutionPlan(pathResolution);
assert.deepEqual(pathPlan.unresolvedTargets, [], "bound async targets should not be listed as unresolved");
assert.equal(pathPlan.workflows[0]?.steps[4]?.target.kind, "asyncapi-target");
if (pathPlan.workflows[0]?.steps[4]?.target.kind === "asyncapi-target") {
  assert.equal(pathPlan.workflows[0].steps[4].target.channelId, "orderConfirmation");
  assert.equal(pathPlan.workflows[0].steps[4].target.action, "receive");
}

const invalidPathArazzo = parseArazzoSource(
  `arazzo: 1.1.0
info:
  title: Invalid path targets
  version: 1.0.0
sourceDescriptions:
  - name: catalog
    type: openapi
    url: catalog-api.yaml
workflows:
  - workflowId: broken
    steps:
      - stepId: relativePath
        operationPath: catalog-api.yaml#/paths/~1pets/get
      - stepId: missingMethod
        operationPath: $sourceDescriptions.catalog.paths./pets
`,
  "invalid-paths.arazzo.yaml",
);
assert.ok(invalidPathArazzo.document, "invalid operationPath fixture should parse structurally");
const invalidPathDiagnostics = validateArazzoDocument(invalidPathArazzo.document);
for (const code of ["ARAZZO_OPERATION_PATH_INVALID", "ARAZZO_OPERATION_PATH_METHOD_REQUIRED"]) {
  assert.ok(
    invalidPathDiagnostics.some(diagnostic => diagnostic.code === code),
    `operationPath validator should report ${code}`,
  );
}

const workflowAsyncStore = useWorkflowStore.getState();
assert.ok(
  workflowAsyncStore.loadAsyncApiSource(asyncApiV3.document!.sourceText, "orders-v3.asyncapi.yaml"),
  "workspace store should load AsyncAPI documents",
);
assert.ok(
  workflowAsyncStore.loadArazzoSource(pathArazzo.document!.sourceText, "path-targets.arazzo.yaml"),
  "workspace store should load the operationPath Arazzo fixture",
);
const storeArazzoId = useWorkflowStore.getState().activeArazzoDocumentId!;
const storeAsyncEntry = useWorkflowStore.getState().registry.listAsyncApi()[0];
assert.ok(storeAsyncEntry, "loaded AsyncAPI document should appear in the workspace registry");
assert.equal(
  useWorkflowStore.getState().registry.getBinding(storeArazzoId, "orders"),
  undefined,
  "async source starts unbound",
);
assert.ok(
  useWorkflowStore.getState().bindSourceDescription(storeArazzoId, "orders", storeAsyncEntry.id),
  "workspace store should bind AsyncAPI source descriptions to local documents",
);
assert.ok(
  useWorkflowStore.getState().loadOpenApiSource(catalogApi.document!.sourceText, "catalog-api.yaml"),
  "catalog fixture should load into the workspace store",
);
const storeOpenApiEntry = useWorkflowStore.getState().registry.listOpenApi().find(
  entry => entry.fileName === "catalog-api.yaml",
);
assert.ok(storeOpenApiEntry, "catalog fixture should be available through the workspace store");
assert.ok(
  useWorkflowStore.getState().bindSourceDescription(storeArazzoId, "catalog", storeOpenApiEntry.id),
  "OpenAPI source binding should work alongside AsyncAPI sources",
);
assert.ok(
  useWorkflowStore.getState().loadOpenApiSource(hooksApi.document!.sourceText, "hooks-api.yaml"),
  "webhook fixture should load into the workspace store",
);
const storeHooksEntry = useWorkflowStore.getState().registry.listOpenApi().find(
  entry => entry.fileName === "hooks-api.yaml",
);
assert.ok(storeHooksEntry, "webhook fixture should be registered");
assert.ok(
  useWorkflowStore.getState().bindSourceDescription(storeArazzoId, "hooks", storeHooksEntry.id),
  "webhook source binding should work through the workspace store",
);
const storeArazzoEntry = useWorkflowStore.getState().registry.get(storeArazzoId);
assert.ok(storeArazzoEntry?.kind === "arazzo" && storeArazzoEntry.document);
const storeResolution = resolveArazzoDocument(
  storeArazzoEntry.document,
  useWorkflowStore.getState().registry,
  new OpenApiCapabilityIndex(useWorkflowStore.getState().registry.listOpenApi()),
  new AsyncApiCapabilityIndex(useWorkflowStore.getState().registry.listAsyncApi()),
);
assert.equal(
  storeResolution.diagnostics.filter(diagnostic => diagnostic.severity === "error").length,
  0,
  "workspace-bound operationPath workflow should resolve without errors",
);
assert.equal(
  storeResolution.workflows[0]?.steps.filter(step => step.target.kind === "asyncapi-target" && step.target.resolved).length,
  3,
  "all async steps should resolve through workspace bindings",
);

const workspaceStore = useWorkflowStore.getState();
assert.ok(workspaceStore.loadOpenApiSource(catalogApi.document!.sourceText, "catalog-api.yaml"));
assert.ok(workspaceStore.loadArazzoSource(validArazzo, "pet-workflow.arazzo.yaml"));
const workspaceArazzoId = useWorkflowStore.getState().activeArazzoDocumentId!;
assert.ok(
  workspaceStore.editArazzoDocument({
    type: "arazzo/addStep",
    workflowId: "adoptPet",
    stepId: "createPet",
    operationId: "$sourceDescriptions.petstore.paths./pets.post",
    parameters: [{ name: "tenant", in: "header", value: "public" }],
    requestBody: { contentType: "application/json", payload: { name: "Rex" } },
  }),
);
const editedWorkspaceEntry = workspaceStore.registry.get(workspaceArazzoId);
assert.equal(editedWorkspaceEntry?.kind, "arazzo");
if (editedWorkspaceEntry?.kind === "arazzo") {
  assert.equal(editedWorkspaceEntry.document?.workflows[0]?.steps.length, 3);
  assert.deepEqual(
    editedWorkspaceEntry.document?.workflows[0]?.steps[2]?.requestBody,
    { contentType: "application/json", payload: { name: "Rex" } },
  );
}
workspaceStore.undoArazzoEdit(workspaceArazzoId);
const undoneWorkspaceEntry = workspaceStore.registry.get(workspaceArazzoId);
assert.equal(
  undoneWorkspaceEntry?.kind === "arazzo" ? undoneWorkspaceEntry.document?.workflows[0]?.steps.length : undefined,
  2,
  "workspace undo should restore the previous Arazzo document",
);
workspaceStore.redoArazzoEdit(workspaceArazzoId);
const redoneWorkspaceEntry = workspaceStore.registry.get(workspaceArazzoId);
assert.equal(
  redoneWorkspaceEntry?.kind === "arazzo" ? redoneWorkspaceEntry.document?.workflows[0]?.steps.length : undefined,
  3,
  "workspace redo should replay the add-step command",
);

const bundledSample = parseArazzoSource(sampleArazzo, "sample-pet-workflow.arazzo.yaml");
assert.ok(bundledSample.document, "bundled Arazzo sample should parse");
const sampleRegistry = new DocumentRegistry();
const bundledOpenApi = parseOpenApiSource(
  readFileSync("src/lib/modern-petstore-3.2.openapi.yaml", "utf8"),
  "modern-petstore-3.2.openapi.yaml",
);
assert.ok(bundledOpenApi.document, "bundled OpenAPI sample should parse");
sampleRegistry.upsertOpenApi(bundledOpenApi.document);
const bundledAsyncApi = parseAsyncApiSource(sampleAsyncApi, "sample-pet-events.asyncapi.yaml");
assert.deepEqual(
  bundledAsyncApi.diagnostics,
  [],
  "bundled AsyncAPI sample should parse without diagnostics",
);
assert.ok(bundledAsyncApi.document, "bundled AsyncAPI sample should produce a document");
const sampleAsyncEntry = sampleRegistry.upsertAsyncApi(bundledAsyncApi.document, bundledAsyncApi.diagnostics);
const sampleArazzoEntry = sampleRegistry.upsertArazzo(bundledSample.document, bundledSample.diagnostics);
sampleRegistry.bindSourceDescription(
  sampleArazzoEntry.id,
  "petstore",
  "openapi:modern-petstore-3.2.openapi.yaml",
);
assert.ok(
  sampleRegistry.bindSourceDescription(sampleArazzoEntry.id, "events", sampleAsyncEntry.id),
  "bundled AsyncAPI sample should bind to the bundled Arazzo sample",
);
const sampleResolution = resolveArazzoDocument(
  bundledSample.document,
  sampleRegistry,
  new OpenApiCapabilityIndex(sampleRegistry.listOpenApi()),
  new AsyncApiCapabilityIndex(sampleRegistry.listAsyncApi()),
);
assert.deepEqual(
  sampleResolution.diagnostics,
  [],
  "bundled Arazzo sample should resolve against the bundled OpenAPI sample",
);
assert.equal(
  sampleResolution.workflows[1]?.steps[1]?.target.kind,
  "asyncapi-target",
  "bundled sample should model the adoption confirmation asynchronously",
);
if (sampleResolution.workflows[1]?.steps[1]?.target.kind === "asyncapi-target") {
  assert.equal(sampleResolution.workflows[1].steps[1].target.resolved, true);
  assert.equal(sampleResolution.workflows[1].steps[1].target.operation?.channelId, "adoptionConfirmed");
}
assert.equal(
  sampleResolution.workflows[0]?.steps[1]?.target.kind,
  "openapi-operation",
  "bundled sample should resolve the JSON Pointer operationPath form",
);

const swaggerApi = parseOpenApiSource(
  `swagger: "2.0"
info:
  title: Legacy API
  version: 1.0.0
paths:
  /things:
    get:
      operationId: listThings
      parameters:
        - name: limit
          in: query
          type: integer
      responses:
        '200':
          description: OK`,
  "legacy-api.json",
);
assert.ok(swaggerApi.document, "Swagger capability fixture should parse");
const swaggerEntry = registry.upsertOpenApi(swaggerApi.document);
assert.equal(
  capabilities.findByOperationId("listThings", swaggerEntry.id).length,
  0,
  "indexes are immutable and must not silently include later documents",
);
const rebuiltCapabilities = new OpenApiCapabilityIndex(registry.listOpenApi());
assert.equal(rebuiltCapabilities.findByOperationId("listThings", swaggerEntry.id).length, 1);

assert.ok(registry.bindSourceDescription(arazzoEntry.id, "petstore", catalogEntry.id), "semantic fixture requires a source binding");
const semanticResolution = resolveArazzoDocument(valid.document, registry, capabilities);
assert.deepEqual(semanticResolution.diagnostics, [], "resolved semantic fixture should not produce diagnostics");
const executionPlan = compileArazzoExecutionPlan(semanticResolution);
assert.equal(executionPlan.networkPolicy, "static-only");
assert.equal(executionPlan.fetchPolicy, "none");
assert.deepEqual(executionPlan.unresolvedTargets, []);
assert.deepEqual(
  executionPlan.workflows[0]?.steps.map(step => step.stepId),
  ["listPets", "updatePet"],
);
assert.equal(executionPlan.workflows[0]?.steps[0]?.target.kind, "openapi-operation");
assert.equal(executionPlan.workflows[0]?.steps[0]?.parameters[0]?.dynamic, false);

const mockExecutionArazzo = parseArazzoSource(
  `arazzo: 1.1.0
info:
  title: Mock execution
  version: 1.0.0
sourceDescriptions:
  - name: petstore
    type: openapi
    url: catalog-api.yaml
workflows:
  - workflowId: mockFlow
    steps:
      - stepId: list
        operationId: listPets
        successCriteria:
          - condition: $statusCode == 200
        onSuccess:
          - name: continue
            type: end
        outputs:
          petId:
            type: jsonpath
            context: $response.body
            selector: $.id
      - stepId: update
        operationId: updatePet
        dependsOn:
          - list
        parameters:
          - name: petId
            in: path
            value: $steps.list.outputs.petId
        requestBody:
          contentType: application/json
          payload:
            authorization: Bearer {$inputs.token}
`,
  "mock-execution.arazzo.yaml",
);
assert.ok(mockExecutionArazzo.document, "mock execution fixture should parse");
const mockRegistry = new DocumentRegistry();
const mockArazzoEntry = mockRegistry.upsertArazzo(mockExecutionArazzo.document, mockExecutionArazzo.diagnostics);
mockRegistry.upsertOpenApi(catalogApi.document!);
mockRegistry.bindSourceDescription(mockArazzoEntry.id, "petstore", "openapi:catalog-api.yaml");
const mockPlan = compileArazzoExecutionPlan(
  resolveArazzoDocument(
    mockExecutionArazzo.document,
    mockRegistry,
    new OpenApiCapabilityIndex(mockRegistry.listOpenApi()),
  ),
);
const mockResult = executeArazzoMockPlan(mockPlan, {
  inputs: { token: "mock-token" },
  examples: {
    list: { statusCode: 200, response: { body: { id: 7 } } },
    update: { statusCode: 200, response: { body: { saved: true } } },
  },
});
assert.equal(mockResult.networkPolicy, "mock-only");
assert.equal(mockResult.fetchPolicy, "none");
assert.equal(mockResult.workflows[0]?.steps[0]?.status, "succeeded");
assert.deepEqual(mockResult.workflows[0]?.steps[0]?.outputs.petId, [7]);
assert.deepEqual(mockResult.workflows[0]?.steps[1]?.parameters.petId, [7]);
assert.deepEqual(
  mockResult.workflows[0]?.steps[1]?.requestBody,
  { authorization: "Bearer mock-token" },
);
assert.equal(mockResult.workflows[0]?.steps[0]?.action?.type, "end");

const failedMockResult = executeArazzoMockPlan(mockPlan, {
  inputs: { token: "mock-token" },
  examples: {
    list: { statusCode: 500, response: { body: { id: 7 } } },
    update: { statusCode: 200, response: { body: { saved: true } } },
  },
});
assert.equal(failedMockResult.workflows[0]?.steps[0]?.status, "failed");
assert.equal(failedMockResult.workflows[0]?.steps[0]?.criteria[0]?.passed, false);

const filterExecutionArazzo = parseArazzoSource(
  `arazzo: 1.1.0
info:
  title: Filtered mock execution
  version: 1.0.0
sourceDescriptions:
  - name: petstore
    type: openapi
    url: catalog-api.yaml
workflows:
  - workflowId: filterFlow
    steps:
      - stepId: search
        operationId: listPets
        successCriteria:
          - type: jsonpath
            context: $response.body
            condition: $.pets[?@.status == 'available']
        outputs:
          availableNames:
            type: jsonpath
            context: $response.body
            selector: $.pets[?@.status == 'available' && @.price < 100].name
`,
  "filter-execution.arazzo.yaml",
);
assert.ok(filterExecutionArazzo.document, "filter execution fixture should parse");
assert.deepEqual(
  validateArazzoRuntimeExpressions(filterExecutionArazzo.document).filter(diagnostic => diagnostic.severity === "error"),
  [],
  "filter selectors should pass runtime-expression validation",
);
const filterRegistry = new DocumentRegistry();
const filterArazzoEntry = filterRegistry.upsertArazzo(filterExecutionArazzo.document, filterExecutionArazzo.diagnostics);
filterRegistry.upsertOpenApi(catalogApi.document!);
filterRegistry.bindSourceDescription(filterArazzoEntry.id, "petstore", "openapi:catalog-api.yaml");
const filterPlan = compileArazzoExecutionPlan(
  resolveArazzoDocument(
    filterExecutionArazzo.document,
    filterRegistry,
    new OpenApiCapabilityIndex(filterRegistry.listOpenApi()),
  ),
);
const filterPets = [
  { name: "Rex", status: "available", price: 120 },
  { name: "Milo", status: "available", price: 80 },
  { name: "Burnt", status: "adopted", price: 60 },
];
const filterMockResult = executeArazzoMockPlan(filterPlan, {
  inputs: {},
  examples: {
    search: { statusCode: 200, response: { body: { pets: filterPets } } },
  },
});
assert.equal(filterMockResult.workflows[0]?.steps[0]?.status, "succeeded");
assert.equal(filterMockResult.workflows[0]?.steps[0]?.criteria[0]?.passed, true);
assert.deepEqual(
  filterMockResult.workflows[0]?.steps[0]?.outputs.availableNames,
  ["Milo"],
  "filter output selectors should materialize through mock execution",
);
const filterFailureResult = executeArazzoMockPlan(filterPlan, {
  inputs: {},
  examples: {
    search: { statusCode: 200, response: { body: { pets: [{ name: "Burnt", status: "adopted", price: 60 }] } } },
  },
});
assert.equal(filterFailureResult.workflows[0]?.steps[0]?.status, "failed");
assert.equal(filterFailureResult.workflows[0]?.steps[0]?.criteria[0]?.passed, false);

const runnerMockContext = {
  inputs: { token: "runner-token" },
  examples: {
    list: { statusCode: 200, response: { body: { id: 8 } } },
    update: { statusCode: 200, response: { body: { saved: true } } },
  },
};
const mockRunner = getArazzoRunnerAdapter("mock");
const mockRunnerResult = mockRunner.execute(mockPlan, runnerMockContext);
assert.equal(mockRunner.networkPolicy, "mock-only");
assert.equal(mockRunner.capabilities.liveExecution, false);
assert.equal(mockRunnerResult.result?.workflows[0]?.steps[0]?.status, "succeeded");
assert.equal(mockRunnerResult.requestPreviews.length, 2);

const dryRunRunner = getArazzoRunnerAdapter("browser-dry-run");
const dryRunResult = dryRunRunner.execute(mockPlan, runnerMockContext);
assert.equal(dryRunRunner.networkPolicy, "preview-only");
assert.equal(dryRunResult.requestPreviews[0]?.method, "GET");
assert.equal(dryRunResult.requestPreviews[0]?.path, "/pets");
assert.match(dryRunResult.requestPreviews[0]?.note ?? "", /Base URL/);

const serverRunnerResult = getArazzoRunnerAdapter("server").execute(mockPlan, runnerMockContext);
assert.equal(serverRunnerResult.result, undefined);
assert.equal(serverRunnerResult.requestPreviews.length, 2);
assert.ok(
  serverRunnerResult.diagnostics.some(diagnostic => diagnostic.code === "ARAZZO_RUNNER_NOT_IMPLEMENTED"),
);
const externalRunnerResult = getArazzoRunnerAdapter("external").execute(mockPlan, runnerMockContext);
assert.equal(externalRunnerResult.result, undefined);
assert.ok(
  externalRunnerResult.diagnostics.some(diagnostic => diagnostic.code === "ARAZZO_RUNNER_NOT_IMPLEMENTED"),
);
const listPetStep = semanticResolution.workflows[0]?.steps[0];
assert.equal(listPetStep?.target.kind, "openapi-operation");
if (listPetStep?.target.kind === "openapi-operation") {
  assert.equal(listPetStep.target.operation.operationId, "listPets");
  assert.equal(listPetStep.target.sourceName, "petstore");
}

const expressionArazzo = parseArazzoSource(
  validArazzo.replace("operationId: listPets", "operationId: $sourceDescriptions.petstore.paths./pets.get"),
  "expression.arazzo.yaml",
);
assert.ok(expressionArazzo.document, "source-description expression fixture should parse");
registry.upsertArazzo(expressionArazzo.document, expressionArazzo.diagnostics);
assert.ok(
  registry.bindSourceDescription(expressionArazzo.document.documentId, "petstore", catalogEntry.id),
  "expression fixture requires a source binding",
);
const expressionResolution = resolveArazzoDocument(expressionArazzo.document, registry, capabilities);
assert.equal(expressionResolution.diagnostics.length, 0);
assert.equal(expressionResolution.workflows[0]?.steps[0]?.target.kind, "openapi-operation");

const unresolvedArazzo = parseArazzoSource(
  validArazzo.replace("operationId: updatePet", "operationId: doesNotExist"),
  "unresolved.arazzo.yaml",
);
assert.ok(unresolvedArazzo.document, "unresolved semantic fixture should parse");
registry.upsertArazzo(unresolvedArazzo.document, unresolvedArazzo.diagnostics);
registry.bindSourceDescription(unresolvedArazzo.document.documentId, "petstore", catalogEntry.id);
const unresolvedResolution = resolveArazzoDocument(unresolvedArazzo.document, registry, capabilities);
assert.ok(
  unresolvedResolution.diagnostics.some((diagnostic) => diagnostic.code === "ARAZZO_OPERATION_UNRESOLVED"),
  "semantic resolver should report an unresolved operation target",
);
const unresolvedExecutionPlan = compileArazzoExecutionPlan(unresolvedResolution);
assert.equal(unresolvedExecutionPlan.unresolvedTargets.length, 1);
assert.equal(unresolvedExecutionPlan.workflows[0]?.steps[1]?.resolved, false);

const semanticGraph = buildArazzoWorkflowGraph(semanticResolution);
const semanticKinds = new Set(semanticGraph.nodes.map((node) => node.kind));
for (const kind of ["document", "source", "workflow", "step", "operation-target"]) {
  assert.ok(semanticKinds.has(kind as (typeof semanticGraph.nodes)[number]["kind"]), `workflow graph should contain ${kind} nodes`);
}
assert.equal(
  semanticGraph.nodes.filter((node) => node.kind === "operation-target").length,
  2,
  "workflow graph should deduplicate resolved operation targets",
);
assert.ok(
  semanticGraph.edges.some(
    edge =>
      edge.relation === "depends-on" &&
      semanticGraph.nodes.find((node) => node.id === edge.source)?.stepId === "listPets" &&
      semanticGraph.nodes.find((node) => node.id === edge.target)?.stepId === "updatePet",
  ),
  "workflow graph should represent dependsOn as a directed edge",
);
assert.equal(
  semanticGraph.edges.filter((edge) => edge.relation === "operation-call").length,
  2,
  "each operation step should have an operation-call edge",
);
assert.ok(
  semanticGraph.edges.some(
    edge =>
      edge.relation === "contains" &&
      semanticGraph.nodes.find((node) => node.id === edge.target)?.kind === "operation-target",
  ),
  "resolved operations should remain attached to their source description",
);

const unresolvedGraph = buildArazzoWorkflowGraph(unresolvedResolution);
assert.ok(
  unresolvedGraph.nodes.some(node => node.kind === "unresolved-target" && !node.resolved),
  "unresolved targets should remain visible graph nodes",
);
assert.ok(
  unresolvedGraph.edges.some(edge => edge.relation === "unresolved-call"),
  "unresolved steps should connect to their unresolved target node",
);

const workflowCallArazzo = parseArazzoSource(
  `arazzo: 1.1.0
info:
  title: Workflow composition
  version: 1.0.0
sourceDescriptions:
  - name: api
    type: openapi
    url: catalog-api.yaml
workflows:
  - workflowId: reusable
    steps:
      - stepId: list
        operationId: listPets
  - workflowId: caller
    steps:
      - stepId: callReusable
        workflowId: reusable
`,
  "composition.arazzo.yaml",
);
assert.ok(workflowCallArazzo.document, "workflow-call fixture should parse");
registry.upsertArazzo(workflowCallArazzo.document, workflowCallArazzo.diagnostics);
registry.bindSourceDescription(workflowCallArazzo.document.documentId, "api", catalogEntry.id);
const workflowCallResolution = resolveArazzoDocument(
  workflowCallArazzo.document,
  registry,
  new OpenApiCapabilityIndex(registry.listOpenApi()),
);
const workflowCallGraph = buildArazzoWorkflowGraph(workflowCallResolution);
assert.ok(
  workflowCallGraph.edges.some(
    edge =>
      edge.relation === "workflow-call" &&
      workflowCallGraph.nodes.find((node) => node.id === edge.target)?.workflowId === "reusable",
  ),
  "sub-workflow calls should point at the workflow node",
);

const reusableWorkflowDocument = parseArazzoSource(
  `arazzo: 1.1.0
info:
  title: Reusable workflows
  version: 1.0.0
sourceDescriptions:
  - name: api
    type: openapi
    url: catalog-api.yaml
workflows:
  - workflowId: shipOrder
    parameters:
      - name: orderId
        required: true
    outputs:
      - name: confirmationId
    steps:
      - stepId: ship
        operationId: updatePet
`,
  "reusable-workflows.arazzo.yaml",
);
assert.ok(reusableWorkflowDocument.document, "reusable workflow fixture should parse");
const reusableWorkflowEntry = registry.upsertArazzo(
  reusableWorkflowDocument.document,
  reusableWorkflowDocument.diagnostics,
);

const compositionCaller = parseArazzoSource(
  `arazzo: 1.1.0
info:
  title: Composition caller
  version: 1.0.0
sourceDescriptions:
  - name: library
    type: arazzo
    url: reusable-workflows.arazzo.yaml
workflows:
  - workflowId: checkout
    steps:
      - stepId: ship
        workflowId: $sourceDescriptions.library.shipOrder
        parameters:
          - name: orderId
            value: $inputs.orderId
          - name: warehouse
            value: west
        outputs:
          - name: confirmationId
          - name: trackingId
`,
  "composition-caller.arazzo.yaml",
);
assert.ok(compositionCaller.document, "composition caller fixture should parse");
registry.upsertArazzo(compositionCaller.document, compositionCaller.diagnostics);
registry.bindSourceDescription(
  compositionCaller.document.documentId,
  "library",
  reusableWorkflowEntry.id,
);
const externalCallResolution = resolveArazzoDocument(
  compositionCaller.document,
  registry,
  new OpenApiCapabilityIndex(registry.listOpenApi()),
);
const externalCallTarget = externalCallResolution.workflows[0]?.steps[0]?.target;
assert.equal(externalCallTarget?.kind, "workflow");
if (externalCallTarget?.kind === "workflow") {
  assert.equal(externalCallTarget.targetDocumentId, reusableWorkflowEntry.id);
  assert.equal(externalCallTarget.workflow.workflowId, "shipOrder");
  assert.equal(externalCallTarget.targetPointer, "#/workflows/0");
}
const compositionDiagnostics = validateArazzoWorkflowComposition(compositionCaller.document, registry);
assert.ok(
  compositionDiagnostics.some(diagnostic => diagnostic.code === "ARAZZO_WORKFLOW_INPUT_MAPPING_UNKNOWN"),
  "composition validator should report unknown workflow input mappings",
);
assert.ok(
  compositionDiagnostics.some(diagnostic => diagnostic.code === "ARAZZO_WORKFLOW_OUTPUT_MAPPING_UNRESOLVED"),
  "composition validator should report unknown workflow output mappings",
);

const recursiveComposition = parseArazzoSource(
  `arazzo: 1.1.0
info:
  title: Recursive composition
  version: 1.0.0
sourceDescriptions:
  - name: api
    type: openapi
    url: catalog-api.yaml
workflows:
  - workflowId: first
    steps:
      - stepId: callSecond
        workflowId: second
  - workflowId: second
    steps:
      - stepId: callFirst
        workflowId: first
`,
  "recursive-composition.arazzo.yaml",
);
assert.ok(recursiveComposition.document, "recursive composition fixture should parse");
registry.upsertArazzo(recursiveComposition.document, recursiveComposition.diagnostics);
assert.ok(
  validateArazzoWorkflowComposition(recursiveComposition.document, registry)
    .some(diagnostic => diagnostic.code === "ARAZZO_WORKFLOW_RECURSION"),
  "composition validator should detect recursive workflow calls",
);

assert.deepEqual(
  validateArazzoDocument(valid.document).filter((diagnostic) => diagnostic.severity === "error"),
  [],
  "valid Arazzo fixture should not have validator errors",
);
const invalidControlArazzo = parseArazzoSource(
  `arazzo: 1.1.0
info:
  title: Invalid controls
  version: 1.0.0
sourceDescriptions:
  - name: api
    type: openapi
    url: api.yaml
  - name: API
    type: openapi
    url: api.yaml
workflows:
  - workflowId: broken
    steps:
      - stepId: first
        operationId: listPets
        dependsOn:
          - second
        onSuccess:
          - type: goto
      - stepId: second
        operationId: updatePet
        dependsOn:
          - first
        onFailure:
          - type: end
            stepId: missing
  - workflowId: broken
    steps:
      - stepId: first
        operationId: listPets
        operationPath: '#/paths/~1pets/get'
      - stepId: first
        operationId: createPet
        workflowId: missing
`,
  "invalid-control.arazzo.yaml",
);
assert.ok(invalidControlArazzo.document, "invalid control fixture should parse structurally");
const controlDiagnostics = validateArazzoDocument(invalidControlArazzo.document);
for (const code of [
  "ARAZZO_SOURCE_NAME_DUPLICATE",
  "ARAZZO_DEPENDENCY_CYCLE",
  "ARAZZO_ACTION_GOTO_TARGET_REQUIRED",
  "ARAZZO_ACTION_STEP_UNRESOLVED",
  "ARAZZO_WORKFLOW_ID_DUPLICATE",
  "ARAZZO_STEP_TARGET_CONFLICT",
  "ARAZZO_STEP_ID_DUPLICATE",
]) {
  assert.ok(
    controlDiagnostics.some((diagnostic) => diagnostic.code === code),
    `control-flow validator should report ${code}`,
  );
}

console.log(
  "Arazzo verification passed: parsing, registry, OpenAPI/AsyncAPI capability indexes, operationPath and channelPath resolution, RFC 9535 JSONPath selectors, control-flow validation, workflow graph construction, source snippets, editor commands, serialization, operation-to-step authoring, mapping edits, runtime expressions, workflow composition, async DAG modeling, static execution plans, mock execution, and runner adapters.",
);
