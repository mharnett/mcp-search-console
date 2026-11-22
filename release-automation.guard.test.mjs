// ============================================
// CI guard: a release-please release publishes to npm, tests its Release PR
// and bumps server.json, all without a manual step.
// ============================================
// release-please creates its Release and pushes its Release PR branch with
// GITHUB_TOKEN, and events from that token do not trigger other workflows —
// except workflow_dispatch. So release-please.yml dispatches publish.yml on a
// new release, and test.yml on each Release PR branch it opens or updates.
// Publishing stays in publish.yml because npm's Trusted Publisher is
// registered to that filename; a publish job inside release-please.yml would
// fail OIDC.
//
// Each release also bumps server.json, the MCP Registry listing's manifest.
// Until 2026-11-22 nothing did, so the listing sat at 1.0.1 while npm
// reached 1.2.2. release-please-config.json lists server.json under
// extra-files.

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

const REPO = path.dirname(fileURLToPath(import.meta.url));
const wf = (name) => path.join(REPO, ".github/workflows", name);
// YAML with comment lines dropped, so prose about a trigger is not the trigger.
const code = (p) => readFileSync(p, "utf-8").split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
const readJson = (name) => JSON.parse(readFileSync(path.join(REPO, name), "utf-8"));
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

describe("release-please.yml dispatches publish.yml on a new release", () => {
  const yml = code(wf("release-please.yml"));

  it("gives the release-please step an id so its outputs are readable", () => {
    expect(yml).toMatch(/id:\s*release\b/);
  });

  it("dispatches publish.yml with the release tag, only when a release was created", () => {
    expect(yml).toMatch(/gh workflow run publish\.yml[^\n]*-f ref=\$\{\{\s*steps\.release\.outputs\.tag_name\s*\}\}/);
    expect(yml).toMatch(/if:\s*\$\{\{\s*steps\.release\.outputs\.release_created\s*\}\}/);
  });

  it("grants actions: write so GITHUB_TOKEN may dispatch", () => {
    expect(yml).toMatch(/actions:\s*write/);
  });

  it("does not publish to npm itself (Trusted Publisher is bound to publish.yml)", () => {
    expect(yml).not.toMatch(/npm publish/);
  });
});

describe("release-please.yml dispatches test.yml on each Release PR branch", () => {
  const yml = code(wf("release-please.yml"));

  it("runs only when release-please opened or updated a Release PR", () => {
    expect(yml).toMatch(/if:\s*\$\{\{\s*steps\.release\.outputs\.prs_created\s*==\s*'true'\s*\}\}/);
    expect(yml).toMatch(/PRS:\s*\$\{\{\s*steps\.release\.outputs\.prs\s*\}\}/);
  });

  it("dispatches test.yml on every Release PR head branch", () => {
    expect(yml).toMatch(/\.headBranchName\b/);
    expect(yml).toMatch(/gh workflow run test\.yml --repo "\$GITHUB_REPOSITORY" --ref "\$branch"/);
  });
});

describe("the dispatched workflows accept workflow_dispatch", () => {
  it("publish.yml takes the release tag as its ref input", () => {
    expect(code(wf("publish.yml"))).toMatch(/workflow_dispatch:\s*\n\s*inputs:\s*\n\s*ref:/);
  });

  it("test.yml can be dispatched", () => {
    expect(code(wf("test.yml"))).toMatch(/^\s*workflow_dispatch:/m);
  });
});

describe("each release bumps server.json (the MCP Registry listing)", () => {
  const pkg = readJson("package.json");
  const config = readJson("release-please-config.json");
  const manifest = readJson(".release-please-manifest.json");
  const server = readJson("server.json");
  // Top-level config is the default for every package; the "." entry wins.
  const root = { ...config, ...config.packages["."] };

  // Every string field named "version" in server.json, as a concrete
  // jsonpath: [["$.version", "1.2.3"], ["$.packages[0].version", "1.2.3"]].
  const versionFields = (node, at = "$") => {
    if (Array.isArray(node)) return node.flatMap((v, i) => versionFields(v, `${at}[${i}]`));
    if (node && typeof node === "object") {
      return Object.entries(node).flatMap(([k, v]) =>
        k === "version" && typeof v === "string" ? [[`${at}.${k}`, v]] : versionFields(v, `${at}.${k}`),
      );
    }
    return [];
  };
  // The JSONPath subset extra-files uses here: dotted keys and [*].
  const selects = (jsonpath, concrete) =>
    new RegExp(`^${escapeRe(jsonpath).replace(/\\\[\\\*\\\]/g, "\\[\\d+\\]")}$`).test(concrete);

  const fields = versionFields(server);
  const jsonpaths = (root["extra-files"] ?? [])
    .filter((f) => typeof f === "object" && f.type === "json" && f.path === "server.json")
    .map((f) => f.jsonpath);

  it("release-please.yml loads release-please-config.json (a release-type input skips it, and its extra-files)", () => {
    const yml = code(wf("release-please.yml"));
    expect(yml).toMatch(/config-file:\s*release-please-config\.json/);
    expect(yml).toMatch(/manifest-file:\s*\.release-please-manifest\.json/);
    expect(yml).not.toMatch(/release-type:/);
  });

  it("lists server.json as a json extra-file for $.version and every $.packages[*].version", () => {
    expect([...jsonpaths].sort()).toEqual(["$.packages[*].version", "$.version"]);
  });

  it("those jsonpaths reach every version field in server.json, and each reaches one", () => {
    expect(fields.length).toBeGreaterThanOrEqual(2);
    const missed = fields.filter(([at]) => !jsonpaths.some((jp) => selects(jp, at))).map(([at]) => at);
    expect(missed).toEqual([]);
    const dead = jsonpaths.filter((jp) => !fields.some(([at]) => selects(jp, at)));
    expect(dead).toEqual([]);
  });

  it("server.json's versions equal package.json's version", () => {
    const stale = fields.filter(([, v]) => v !== pkg.version).map(([at, v]) => `${at}=${v}`);
    expect(stale, `package.json is ${pkg.version}`).toEqual([]);
  });

  it("the manifest pins package.json's version", () => {
    expect(manifest["."]).toBe(pkg.version);
  });

  it("the tag format matches the last release's, so release-please finds it", () => {
    const component = root["include-component-in-tag"] === false ? "" : `${root.component ?? pkg.name}-`;
    const heading = readFileSync(path.join(REPO, "CHANGELOG.md"), "utf-8").match(
      new RegExp(`^## \\[${escapeRe(pkg.version)}\\]\\([^)]*/compare/[^)]*\\.\\.\\.([^)]+)\\)`, "m"),
    );
    expect(heading, `CHANGELOG.md has no compare-link heading for ${pkg.version}`).not.toBeNull();
    expect(heading[1]).toBe(`${component}v${pkg.version}`);
  });
});
