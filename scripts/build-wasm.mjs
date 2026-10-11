import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export async function buildWasm() {
  await new Promise((resolve, reject) => {
    const child = spawn(
      "cargo",
      [
        "build",
        "--manifest-path",
        "wasm/Cargo.toml",
        "--release",
        "--target",
        "wasm32-unknown-unknown",
      ],
      { stdio: "inherit" },
    );
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0
        ? resolve()
        : reject(
            new Error(
              "Wasm build failed. Install Rust and run: rustup target add wasm32-unknown-unknown",
            ),
          ),
    );
  });
  return readFile("wasm/target/wasm32-unknown-unknown/release/figmagent_core.wasm");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await buildWasm();
