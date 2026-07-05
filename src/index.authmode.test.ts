import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

// WIRING test: the RUNTIME (GscManager, via resolveRuntimeAuthMode) must make
// its service-account-vs-oauth-vs-unconfigured decision through selectAuthMode,
// NOT via the old inline `if (config.credentials_file)` branch. The old inline
// logic had no `unconfigured` mode — so the unconfigured->clear-error assertion
// below FAILS if the inline logic is ever restored or selectAuthMode is bypassed.

import { resolveRuntimeAuthMode, buildGscManager } from "./index.js";
import * as authMode from "./authMode.js";

const OAUTH_ENV = [
  "GOOGLE_GSC_CLIENT_ID",
  "GOOGLE_GSC_CLIENT_SECRET",
  "GOOGLE_GSC_REFRESH_TOKEN",
] as const;

let savedEnv: Record<string, string | undefined>;
let tmp: string;

function baseConfig(over: Partial<Parameters<typeof resolveRuntimeAuthMode>[0]> = {}) {
  return {
    credentials_file: "",
    oauth_credentials_file: "",
    oauth_scope: "https://www.googleapis.com/auth/webmasters.readonly",
    clients: {},
    ...over,
  };
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "gsc-authmode-"));
  savedEnv = {};
  for (const k of OAUTH_ENV) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of OAUTH_ENV) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  rmSync(tmp, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("resolveRuntimeAuthMode consults selectAuthMode (wiring)", () => {
  // NON-VACUITY: the runtime must actually call selectAuthMode. If the inline
  // branch is restored, selectAuthMode is never invoked and this fails.
  // A stored-creds path guaranteed NOT to exist, so the machine's real global
  // credentials file can't leak an "oauth is configured" signal into the tests.
  function noStored() {
    return { storedCredsPath: join(tmp, "does-not-exist.json"), env: {} as NodeJS.ProcessEnv };
  }

  it("delegates the decision to selectAuthMode", () => {
    const spy = vi.spyOn(authMode, "selectAuthMode");
    resolveRuntimeAuthMode(baseConfig({ credentials_file: "/some/sa.json" }), noStored());
    expect(spy).toHaveBeenCalledTimes(1);
    // The runtime must pass the SA path through as the credentialsFile signal.
    expect(spy.mock.calls[0][0].credentialsFile).toBe("/some/sa.json");
  });

  it("service-account path => service_account", () => {
    expect(
      resolveRuntimeAuthMode(baseConfig({ credentials_file: "/some/sa.json" }), noStored()).mode,
    ).toBe("service_account");
  });

  it("env refresh token, no SA => oauth", () => {
    expect(
      resolveRuntimeAuthMode(baseConfig(), {
        ...noStored(),
        env: { GOOGLE_GSC_REFRESH_TOKEN: "RT" } as NodeJS.ProcessEnv,
      }).mode,
    ).toBe("oauth");
  });

  it("stored OAuth credentials file (no env token, no SA) => oauth", () => {
    const credsFile = join(tmp, "stored.json");
    writeFileSync(credsFile, JSON.stringify({ version: 1, refresh_token: "T", site_urls: [] }));
    expect(
      resolveRuntimeAuthMode(baseConfig(), { storedCredsPath: credsFile, env: {} as NodeJS.ProcessEnv }).mode,
    ).toBe("oauth");
  });

  // PRECEDENCE (runtime wiring): when BOTH an explicit SA keyfile AND an OAuth
  // refresh token are configured, the runtime must resolve to service_account.
  // This pins the target precedence at the actual runtime entry point (not just
  // the pure selectAuthMode unit). Non-vacuous: if the decision were flipped to
  // OAuth-first, both signals present would resolve to "oauth" and this reddens.
  it("BOTH SA keyfile AND env refresh token => service_account (SA wins)", () => {
    expect(
      resolveRuntimeAuthMode(baseConfig({ credentials_file: "/some/sa.json" }), {
        ...noStored(),
        env: { GOOGLE_GSC_REFRESH_TOKEN: "RT" } as NodeJS.ProcessEnv,
      }).mode,
    ).toBe("service_account");
  });

  it("nothing configured => unconfigured (NOT a silent service_account default)", () => {
    // This is the case the old inline logic could not represent: with no SA path
    // and no OAuth signal it fell into the oauth branch and threw incidentally.
    expect(resolveRuntimeAuthMode(baseConfig(), noStored()).mode).toBe("unconfigured");
  });
});

describe("buildGscManager surfaces a clear onboarding error when unconfigured", () => {
  it("throws a GscAuthError naming the onboarding command, not an incidental resolve error", () => {
    let err: unknown;
    try {
      buildGscManager(baseConfig(), {
        storedCredsPath: join(tmp, "does-not-exist.json"),
        env: {} as NodeJS.ProcessEnv,
      });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(Error);
    // Must be the DISTINCT unconfigured onboarding message (names BOTH modes),
    // not the incidental "Missing GSC OAuth credentials" throw from the oauth
    // branch that the old inline logic fell into. This substring only appears in
    // the unconfigured path, so restoring the inline logic reddens this test.
    const m = (err as Error).message;
    expect(m).toMatch(/No GSC credentials configured\. Choose one auth mode/);
    expect(m).toMatch(/mcp-gsc-auth/);
    expect(m).toMatch(/GOOGLE_APPLICATION_CREDENTIALS/);
  });
});
