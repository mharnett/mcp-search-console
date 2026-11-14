import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, realpathSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { pathToFileURL } from "url";
import { isMainModule } from "./entry-point.js";

// npx / npm bins launch the package through node_modules/.bin/<name>, a symlink to
// dist/index.js. process.argv[1] keeps the symlink path, so matching on the file
// name misses it and main() never runs (server exits 0, client sees CONNECTION_CLOSED).
describe("isMainModule", () => {
  let dir: string;
  let moduleFile: string;
  let moduleUrl: string;

  beforeAll(() => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), "entry-point-")));
    mkdirSync(join(dir, "pkg", "dist"), { recursive: true });
    mkdirSync(join(dir, "node_modules", ".bin"), { recursive: true });
    moduleFile = join(dir, "pkg", "dist", "index.js");
    writeFileSync(moduleFile, "");
    writeFileSync(join(dir, "other.js"), "");
    symlinkSync(moduleFile, join(dir, "node_modules", ".bin", "mcp-google-gsc"));
    symlinkSync(moduleFile, join(dir, "node_modules", ".bin", "mcp-gsc"));
    moduleUrl = pathToFileURL(moduleFile).href;
  });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("is true when node runs the file directly (node dist/index.js)", () => {
    expect(isMainModule(moduleFile, moduleUrl)).toBe(true);
  });

  it("is true for the npx bin symlink .bin/mcp-google-gsc", () => {
    expect(isMainModule(join(dir, "node_modules", ".bin", "mcp-google-gsc"), moduleUrl)).toBe(true);
  });

  it("is true for any other bin name symlinked to the file (.bin/mcp-gsc)", () => {
    expect(isMainModule(join(dir, "node_modules", ".bin", "mcp-gsc"), moduleUrl)).toBe(true);
  });

  it("is false when another script imports the module (tests, library use)", () => {
    expect(isMainModule(join(dir, "other.js"), moduleUrl)).toBe(false);
  });

  it("is false for a different file that is also named index.js", () => {
    mkdirSync(join(dir, "elsewhere"), { recursive: true });
    writeFileSync(join(dir, "elsewhere", "index.js"), "");
    expect(isMainModule(join(dir, "elsewhere", "index.js"), moduleUrl)).toBe(false);
  });

  it("is false when argv[1] is missing or points at nothing", () => {
    expect(isMainModule(undefined, moduleUrl)).toBe(false);
    expect(isMainModule(join(dir, "does-not-exist"), moduleUrl)).toBe(false);
  });
});
