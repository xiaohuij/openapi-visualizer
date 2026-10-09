import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const directory = await mkdtemp(path.join(tmpdir(), "openapi-visualizer-verify-"));
const entryPoints = [
  ["OpenAPI", new URL("./verify-openapi.ts", import.meta.url).pathname],
  ["Arazzo", new URL("./verify-arazzo.ts", import.meta.url).pathname],
  ["ArazzoSchema", new URL("./verify-arazzo-schema.ts", import.meta.url).pathname],
];

try {
  for (const [name, entryPoint] of entryPoints) {
    const output = path.join(directory, `${name.toLowerCase()}.cjs`);
    await build({
      entryPoints: [entryPoint],
      bundle: true,
      platform: "node",
      format: "cjs",
      outfile: output,
      logLevel: "silent",
    });
    const module = await import(pathToFileURL(output));
    if (module.waitForVerification) await module.waitForVerification;
  }
} finally {
  await rm(directory, { force: true, recursive: true });
}
