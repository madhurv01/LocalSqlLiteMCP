// Next.js `output: "standalone"` does not copy static assets or public/ into
// .next/standalone. Do it here so `npm start` works without Docker.
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const standalone = resolve(root, ".next/standalone");

if (!existsSync(standalone)) {
  console.log("no standalone output; skipping asset copy");
  process.exit(0);
}

mkdirSync(resolve(standalone, ".next"), { recursive: true });
cpSync(resolve(root, ".next/static"), resolve(standalone, ".next/static"), { recursive: true });
if (existsSync(resolve(root, "public"))) {
  cpSync(resolve(root, "public"), resolve(standalone, "public"), { recursive: true });
}
console.log("copied static + public into .next/standalone");
