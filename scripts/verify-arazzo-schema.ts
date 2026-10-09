import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import YAML from "yaml";
import { validateArazzoSchemaStructure } from "../src/arazzo/schema-validator";
import { sampleArazzo } from "../src/lib/sample-arazzo";
import type { ArazzoSpecificationVersion } from "../src/arazzo/types";

function fixtureFiles(version: ArazzoSpecificationVersion, expectation: "pass" | "fail") {
  return readdirSync(`tests/arazzo-schema/${version}/${expectation}`, { withFileTypes: true })
    .filter(entry => entry.isFile() && /\.ya?ml$/.test(entry.name))
    .map(entry => `tests/arazzo-schema/${version}/${expectation}/${entry.name}`);
}

export const waitForVerification = (async () => {
  for (const version of ["1.1", "1.0"] as const) {
    for (const file of fixtureFiles(version, "pass")) {
      const instance = YAML.parse(readFileSync(file, "utf8"));
      const diagnostics = await validateArazzoSchemaStructure(instance, version, `official:${file}`);
      assert.deepEqual(
        diagnostics,
        [],
        `official ${version} pass fixture ${file} should be schema-valid`,
      );
    }
    for (const file of fixtureFiles(version, "fail")) {
      const instance = YAML.parse(readFileSync(file, "utf8"));
      const diagnostics = await validateArazzoSchemaStructure(instance, version, `official:${file}`);
      assert.ok(
        diagnostics.some(diagnostic => diagnostic.code === "ARAZZO_SCHEMA_INVALID"),
        `official ${version} fail fixture ${file} should produce a schema diagnostic`,
      );
    }
  }

  const bundledSample = YAML.parse(sampleArazzo);
  assert.deepEqual(
    await validateArazzoSchemaStructure(bundledSample, "1.1", "bundled-sample"),
    [],
    "the bundled Arazzo sample should satisfy the official schema",
  );

  const invalidStep = YAML.parse(`arazzo: 1.1.0
info:
  title: Invalid step shape
  version: 1.0.0
sourceDescriptions:
  - name: petstore
    type: openapi
    url: petstore.yaml
workflows:
  - workflowId: broken
    steps:
      - stepId: broken
        operationId: listPets
        parameters:
          - value: missing-name-and-in
`);
  const invalidStepDiagnostics = await validateArazzoSchemaStructure(invalidStep, "1.1", "invalid-step");
  assert.ok(
    invalidStepDiagnostics.some(diagnostic => diagnostic.code === "ARAZZO_SCHEMA_INVALID"),
    "locally invalid parameters should produce a schema diagnostic",
  );
  assert.match(
    invalidStepDiagnostics.find(diagnostic => diagnostic.pointer.includes("/parameters/"))?.message ?? "",
    /missing required propert/,
    "schema diagnostics should explain which properties are missing",
  );

  console.log(
    `Arazzo schema verification passed: official ${fixtureFiles("1.1", "pass").length + fixtureFiles("1.1", "fail").length} v1.1 and ${fixtureFiles("1.0", "pass").length + fixtureFiles("1.0", "fail").length} v1.0 fixtures, bundled sample, and local invalid-step coverage.`,
  );
})();
