import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const directory = await mkdtemp(path.join(tmpdir(), "openapi-visualizer-verify-"));
  const output = path.join(directory, "verify.cjs");

try {
  await build({
    entryPoints: [new URL("./verify-openapi.ts", import.meta.url).pathname],
    bundle: true,
    platform: "node",
    format: "cjs",
    outfile: output,
    logLevel: "silent",
  });
  await import(pathToFileURL(output));
} finally {
  await rm(directory, { force: true, recursive: true });
}
