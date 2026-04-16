#!/usr/bin/env node
// ============================================
// BUILD: TS -> dist/ JS + .d.ts
// ============================================

import { build } from "esbuild";
import { execSync } from "child_process";
import { writeFileSync, readdirSync, statSync, rmSync, existsSync } from "fs";
import { join } from "path";

const SRC = "src";
const OUT = "dist";

// 1. Clean
if (existsSync(OUT)) {
  rmSync(OUT, { recursive: true, force: true });
}

// 2. Collect source entry points
function walkTs(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...walkTs(full));
    } else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts") && !entry.endsWith(".d.ts")) {
      out.push(full);
    }
  }
  return out;
}

const entryPoints = walkTs(SRC);

// 3. Build-time secret injection
function defineFromEnv(key) {
  const val = process.env[key] || "";
  return JSON.stringify(val);
}

const define = {
  "process.env.EMBEDDED_CLIENT_ID": defineFromEnv("EMBEDDED_CLIENT_ID"),
  "process.env.EMBEDDED_CLIENT_SECRET": defineFromEnv("EMBEDDED_CLIENT_SECRET"),
};

const missingEmbedded = Object.entries(define)
  .filter(([, v]) => v === '""')
  .map(([k]) => k.replace("process.env.", ""));

if (missingEmbedded.length > 0) {
  process.stderr.write(
    `Warning: Build-time secrets missing: ${missingEmbedded.join(", ")}\n` +
      `End users will need to set GOOGLE_GSC_* env vars themselves.\n`,
  );
}

// 4. esbuild
await build({
  entryPoints,
  outdir: OUT,
  outbase: SRC,
  platform: "node",
  format: "esm",
  target: "node18",
  bundle: false,
  sourcemap: true,
  logLevel: "info",
  define,
});

// 5. .d.ts via tsc
execSync("tsc --emitDeclarationOnly --declaration --outDir dist", {
  stdio: "inherit",
});

// 6. Build-info
let sha = "unknown";
try {
  sha = execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] })
    .toString()
    .trim();
} catch {}

writeFileSync(
  join(OUT, "build-info.json"),
  JSON.stringify(
    { sha, builtAt: new Date().toISOString(), embeddedSecrets: missingEmbedded.length === 0 },
    null,
    2,
  ),
);

process.stdout.write(`Build complete (${entryPoints.length} files, sha=${sha}, embedded=${missingEmbedded.length === 0})\n`);
