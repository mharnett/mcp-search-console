// ============================================
// CI guard: every per-client launcher must PIN its own OAuth refresh token.
// ============================================
// The server resolves the refresh token as:
//
//     GOOGLE_GSC_REFRESH_TOKEN (env)  ->  else  <configDir>/credentials.json
//
// There is exactly ONE credentials.json for the whole install, and `npx
// mcp-gsc-auth` overwrites it. Neither `oauth_credentials_file` nor
// `credentials_file` in a per-client config selects an OAuth token file —
// nothing reads the former, and the latter is service-account mode only.
//
// So a per-client launcher that does NOT export GOOGLE_GSC_REFRESH_TOKEN
// silently falls back to whichever client authorized last. It still starts
// cleanly and still answers `initialize` — it just authenticates as the WRONG
// Google account and returns another client's Search Console data, or none.
// That is a cross-client correctness bug that no unit test and no healthcheck
// (which only probes `initialize`) can catch.
//
// Real incident (2026-07-13): run-forcepoint.sh exported client_id/secret but
// not a refresh token, relying on an `oauth_credentials_file` key that is dead
// config. It had been reading a REVOKED token from the shared file; when Neon
// One re-authed, it silently began authenticating as the Neon One account.
//
// Invariant: every top-level run-<client>.sh (i.e. every launcher except the
// generic run-mcp.sh, which legitimately uses the shared file for a
// single-client install) must export BOTH:
//   - GOOGLE_GSC_REFRESH_TOKEN  (pins the identity)
//   - GOOGLE_GSC_SITE_URL       (pins the property)
// and must source the token from the Keychain, never inline it.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = __dirname;

// The generic launcher: single-client installs may use the shared
// credentials.json, so it is exempt from pinning.
const GENERIC_LAUNCHERS = new Set(["run-mcp.sh"]);

function perClientLaunchers() {
  return readdirSync(REPO)
    .filter((f) => /^run-.+\.sh$/.test(f))
    .filter((f) => !GENERIC_LAUNCHERS.has(f));
}

// Per-client launchers are gitignored (machine-local: absolute paths + Keychain
// service names), so they DO NOT exist in a clean CI checkout. This guard is
// therefore enforcing on any machine that actually has launchers — a developer
// box — and a no-op in CI, where the artifact it guards is absent. That is the
// correct shape: you cannot guard a file that isn't there. `it.each` over an
// empty list registers no cases, so CI stays green without a false assurance.
describe.skipIf(perClientLaunchers().length === 0)(
  "per-client GSC launchers pin their own refresh token",
  () => {
  const launchers = perClientLaunchers();

  it("finds the per-client launchers (guard is not vacuous on this machine)", () => {
    expect(launchers.length).toBeGreaterThan(0);
  });

  it.each(perClientLaunchers())("%s exports GOOGLE_GSC_REFRESH_TOKEN", (file) => {
    const src = readFileSync(path.join(REPO, file), "utf-8");
    expect(
      /export\s+GOOGLE_GSC_REFRESH_TOKEN=/.test(src),
      `${file} does not export GOOGLE_GSC_REFRESH_TOKEN, so it falls back to the ` +
        `shared credentials.json and will authenticate as whichever client ` +
        `authorized last.`,
    ).toBe(true);
  });

  it.each(perClientLaunchers())("%s exports GOOGLE_GSC_SITE_URL", (file) => {
    const src = readFileSync(path.join(REPO, file), "utf-8");
    expect(
      /export\s+GOOGLE_GSC_SITE_URL=/.test(src),
      `${file} does not pin GOOGLE_GSC_SITE_URL, so primary_site_url comes from ` +
        `the shared credentials.json and may point at another client's property.`,
    ).toBe(true);
  });

  it.each(perClientLaunchers())("%s sources its token from Keychain, not inline", (file) => {
    const src = readFileSync(path.join(REPO, file), "utf-8");
    const line = src.split("\n").find((l) => /export\s+GOOGLE_GSC_REFRESH_TOKEN=/.test(l)) ?? "";
    expect(
      /security\s+find-generic-password/.test(line),
      `${file} must read GOOGLE_GSC_REFRESH_TOKEN via \`security find-generic-password\`; ` +
        `a literal token in a launcher is a committed credential.`,
    ).toBe(true);
    // A refresh token is a long opaque string; catch an inlined one directly.
    expect(
      /GOOGLE_GSC_REFRESH_TOKEN="?1\/\/|GOOGLE_GSC_REFRESH_TOKEN="[A-Za-z0-9._-]{20,}"/.test(line),
      `${file} appears to inline a literal refresh token.`,
    ).toBe(false);
  });

  it("each launcher pins a DISTINCT keychain token (no cross-client reuse)", () => {
    const services = launchers.map((f) => {
      const src = readFileSync(path.join(REPO, f), "utf-8");
      const m = src.match(/GOOGLE_GSC_REFRESH_TOKEN="\$\(security find-generic-password[^)]*-s\s+(\S+)/);
      return m?.[1];
    });
    expect(services.every(Boolean), "a launcher has no resolvable keychain service name").toBe(true);
    expect(
      new Set(services).size,
      `launchers share a keychain token (${services.join(", ")}) — each client needs its own`,
    ).toBe(services.length);
  });
});
