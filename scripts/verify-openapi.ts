import { readFileSync } from "node:fs";
import { parseOpenApiSource } from "../src/lib/visualizer";
import { isRecord } from "../src/lib/utils";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Verification failed: ${message}`);
}

const versionFixture = (version: string) => `openapi: ${version}\ninfo:\n  title: Version test\n  version: 1.0.0\npaths: {}`;
for (const version of ["3.0.4", "3.1.2", "3.2.0"]) {
  const result = parseOpenApiSource(versionFixture(version), `openapi-${version}.yaml`);
  assert(result.document, `${version} should parse`);
  assert(result.document?.stats.specification === `OpenAPI ${version}`, `${version} version should be retained`);
}

const swagger = parseOpenApiSource(
  `swagger: "2.0"\ninfo:\n  title: Swagger test\n  version: 1.0.0\npaths:\n  /things:\n    get:\n      responses:\n        '200':\n          description: OK`,
  "swagger.yaml",
);
assert(
  swagger.document?.stats.specification === "Swagger 2.0",
  `Swagger 2.0 should remain supported (received ${swagger.document?.stats.specification ?? swagger.error})`,
);

const sample = parseOpenApiSource(
  readFileSync("src/lib/modern-petstore-3.2.openapi.yaml", "utf8"),
  "modern-petstore-3.2.openapi.yaml",
);
assert(sample.document, "Modern PetStore 3.2 sample should parse");
assert(sample.document?.stats.unresolvedInternalRefs === 0, "sample should have no dangling internal references");
assert(
  [...sample.document?.models.values() ?? []].some(
    (model) => model.kind === "operation" && model.metadata.method === "QUERY",
  ),
  "sample should expose its QUERY operation",
);

const selfFieldName = "$" + "self";
const comprehensive = `openapi: 3.2.0
${selfFieldName}: https://api.example.test/openapi.json
info:
  title: Comprehensive 3.2 API
  version: 1.0.0
servers:
  - name: Production
    url: https://api.example.test
tags:
  - name: Store
    kind: category
  - name: Pets
    kind: resource
    parent: Store
    summary: Pet operations
paths:
  /pets:
    query:
      operationId: searchPets
      parameters:
        - name: filter
          in: querystring
          content:
            application/x-www-form-urlencoded:
              schema:
                type: object
      responses:
        '200':
          summary: Search result
          description: A page of pets
          content:
            application/json:
              $ref: '#/components/mediaTypes/pet-json'
    additionalOperations:
      COPY:
        operationId: copyPets
        responses:
          '200':
            description: Copied
security:
  - oauth: []
components:
  mediaTypes:
    pet-json:
      itemSchema:
        $ref: '#/components/schemas/Pet'
      examples:
        first:
          dataValue:
            name: Rex
          serializedValue: '{"name":"Rex"}'
      encoding:
        metadata:
          contentType: application/json
          prefixEncoding:
            - contentType: text/plain
          itemEncoding:
            contentType: application/json
  schemas:
    Pet:
      type: object
      allOf:
        - $ref: schemas/extended-pet.yaml
      discriminator:
        propertyName: kind
        defaultMapping: Cat
        mapping:
          cat: Cat
      xml:
        nodeType: element
    Cat:
      type: object
  securitySchemes:
    oauth:
      type: oauth2
      deprecated: true
      oauth2MetadataUrl: https://auth.example.test/.well-known/oauth-authorization-server
      flows:
        deviceAuthorization:
          deviceAuthorizationUrl: https://auth.example.test/device
          tokenUrl: https://auth.example.test/token
`;
const result = parseOpenApiSource(comprehensive, "openapi-3.2-comprehensive.yaml");
const document = result.document;
assert(document, `comprehensive 3.2 fixture should parse: ${result.error}`);
const models = [...document?.models.values() ?? []];
assert(document?.stats.additionalOperations === 1, "additional operation should be modeled");
assert(models.some((model) => model.metadata.method === "QUERY"), "QUERY should be modeled");
assert(models.some((model) => model.metadata.querystring === true), "querystring parameter should be modeled");
assert(models.some((model) => model.kind === "tag" && model.metadata.parent === "Store"), "tag hierarchy should be modeled");
assert(document?.stats.mediaTypes === 1, "reusable media type should be counted");
assert(document?.stats.streamingMediaTypes === 1, "itemSchema media type should be counted as sequential");
assert(models.some((model) => model.metadata.itemSchema === true), "itemSchema should be modeled");
assert(models.some((model) => model.kind === "example" && model.metadata.representation === "dataValue"), "3.2 examples should be modeled");
assert(
  models.some((model) => typeof model.metadata.encodingRole === "string" && model.metadata.encodingRole.startsWith("prefix:")),
  "prefixEncoding should be modeled",
);
assert(models.some((model) => model.metadata.encodingRole === "item"), "itemEncoding should be modeled");
assert(models.some((model) => model.kind === "response" && model.description === "Search result"), "response summary should be modeled");
assert(models.some((model) => isRecord(model.value) && isRecord(model.value.xml) && model.value.xml.nodeType === "element"), "XML nodeType should be retained");
assert(models.some((model) => model.kind === "server" && model.title === "Production"), "server name should be modeled");
assert(document?.edges.some((edge) => edge.label === "defaultMapping"), "discriminator default mapping should be connected");
const oauthScheme = models.find((model) => model.kind === "securityScheme");
assert(oauthScheme?.metadata.deprecated === true, "deprecated security scheme should be modeled");
assert(oauthScheme?.metadata.oauth2MetadataUrl === "https://auth.example.test/.well-known/oauth-authorization-server", "OAuth metadata URL should be retained");
assert(
  isRecord(oauthScheme?.value) && isRecord(oauthScheme.value.flows) && isRecord(oauthScheme.value.flows.deviceAuthorization),
  "deviceAuthorization flow should be retained",
);
const root = document?.models.get("visualizer:root");
assert(root?.metadata.self === "https://api.example.test/openapi.json", "$self should be attached to the root model");
assert(
  models.some((model) => model.kind === "externalRef" && model.title === "https://api.example.test/schemas/extended-pet.yaml"),
  "$self should establish the base URI for relative external references",
);
assert(document?.raw.$self === "https://api.example.test/openapi.json", "$self should be retained");

const invalid = parseOpenApiSource(versionFixture("4.0.0"), "openapi-4.0.yaml");
assert(invalid.error?.includes("3.2.x"), "unsupported future versions should fail clearly");

console.log(
  `OpenAPI verification passed: 3.0/3.1/3.2 parsing, 3.2 feature model, and PetStore sample (${sample.document?.models.size ?? 0} models).`,
);
