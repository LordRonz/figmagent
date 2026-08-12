import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { context } from "esbuild";

const watch = process.argv.includes("--watch");

await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });

const code = await context({
  entryPoints: ["src/code.ts"],
  outfile: "dist/code.js",
  bundle: true,
  platform: "browser",
  format: "iife",
  target: "es2020",
  logLevel: "info",
});

const ui = await context({
  entryPoints: ["src/ui.ts"],
  bundle: true,
  platform: "browser",
  format: "iife",
  target: "es2020",
  write: false,
  logLevel: "info",
});

async function buildUi() {
  const result = await ui.rebuild();
  const script = result.outputFiles[0]?.text;
  if (!script) throw new Error("The UI bundle was empty");
  const template = await readFile("src/ui.html", "utf8");
  await writeFile("dist/ui.html", template.replace("/*__UI_SCRIPT__*/", script));
}

if (watch) {
  await code.watch();
  await buildUi();
  console.log("Watching plugin sources. Re-run after UI changes to refresh ui.html.");
} else {
  await Promise.all([code.rebuild(), buildUi()]);
  await Promise.all([code.dispose(), ui.dispose()]);
}
