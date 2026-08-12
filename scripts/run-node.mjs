import { spawn } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import { basename } from "node:path";
import { build } from "esbuild";

const testMode = process.argv[2] === "--test";
const entry = process.argv[testMode ? 3 : 2];
if (!entry) throw new Error("Usage: run-node.mjs [--test] <entry.ts>");

await rm(".test-dist", { recursive: true, force: true });
await mkdir(".test-dist", { recursive: true });
const outfile = `.test-dist/${basename(entry).replace(/\.ts$/, ".cjs")}`;

await build({
  entryPoints: [entry],
  outfile,
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
});

const child = spawn(process.execPath, testMode ? ["--test", outfile] : [outfile], {
  stdio: "inherit",
});
child.on("exit", (code) => process.exit(code ?? 1));
