import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  resolveOAuthCredentials,
  writeStoredCredentials,
  readStoredCredentials,
  CREDENTIALS_FILE_VERSION,
  type StoredCredentials,
} from "./credentials.js";

// The capability under test: resolveOAuthCredentials(path) reads the refresh
// token from a PER-CONFIG file, so multiple OAuth-mode instances can each use a
// different Google account (one per client) instead of sharing one global file.

const OAUTH_ENV = [
  "GOOGLE_GSC_CLIENT_ID",
  "GOOGLE_GSC_CLIENT_SECRET",
  "GOOGLE_GSC_REFRESH_TOKEN",
  "GOOGLE_GSC_SITE_URL",
] as const;

let tmp: string;
let savedEnv: Record<string, string | undefined>;

function storedFixture(token: string, site: string): StoredCredentials {
  return {
    version: CREDENTIALS_FILE_VERSION,
    refresh_token: token,
    site_urls: [site],
    primary_site_url: site,
    obtained_at: "2026-06-06T00:00:00Z",
    scopes: ["https://www.googleapis.com/auth/webmasters.readonly"],
  };
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "gsc-creds-"));
  savedEnv = {};
  for (const k of OAUTH_ENV) savedEnv[k] = process.env[k];
  // Provide client id/secret via env (build has no embedded secrets), and make
  // sure no env refresh token leaks in so the FILE is the only token source.
  process.env.GOOGLE_GSC_CLIENT_ID = "test-client-id";
  process.env.GOOGLE_GSC_CLIENT_SECRET = "test-client-secret";
  delete process.env.GOOGLE_GSC_REFRESH_TOKEN;
  delete process.env.GOOGLE_GSC_SITE_URL;
});

afterEach(() => {
  for (const k of OAUTH_ENV) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  rmSync(tmp, { recursive: true, force: true });
});

describe("resolveOAuthCredentials — per-config path", () => {
  // ANCHOR: a custom path is honored; the token comes from THAT file.
  it("reads the refresh token from the supplied path", () => {
    const p = join(tmp, "forcepoint-credentials.json");
    writeStoredCredentials(storedFixture("TOKEN_FORCEPOINT", "https://www.forcepoint.com/"), p);

    const resolved = resolveOAuthCredentials(p);

    expect(resolved.refresh_token).toBe("TOKEN_FORCEPOINT");
    expect(resolved.primary_site_url).toBe("https://www.forcepoint.com/");
    expect(resolved.site_urls).toContain("https://www.forcepoint.com/");
    expect(resolved.source).toBe("file");
  });

  // ANCHOR: two configs => two accounts, no cross-talk. This is the whole point
  // of the change (Forcepoint and Flowspace must not share one token file).
  it("isolates tokens across two different paths", () => {
    const a = join(tmp, "client-a.json");
    const b = join(tmp, "client-b.json");
    writeStoredCredentials(storedFixture("TOKEN_A", "https://a.example/"), a);
    writeStoredCredentials(storedFixture("TOKEN_B", "https://b.example/"), b);

    expect(resolveOAuthCredentials(a).refresh_token).toBe("TOKEN_A");
    expect(resolveOAuthCredentials(b).refresh_token).toBe("TOKEN_B");
    // Resolving A must not have mutated or bled into B.
    expect(resolveOAuthCredentials(a).primary_site_url).toBe("https://a.example/");
    expect(resolveOAuthCredentials(b).primary_site_url).toBe("https://b.example/");
  });

  // ANCHOR: missing file + no env token => throws, and the message names the
  // path we actually looked at (not the global default).
  it("throws referencing the supplied path when no token is found", () => {
    const missing = join(tmp, "does-not-exist.json");
    expect(() => resolveOAuthCredentials(missing)).toThrowError(/refresh_token/);
    expect(() => resolveOAuthCredentials(missing)).toThrowError(new RegExp(missing.replace(/[.\\/]/g, "\\$&")));
  });

  // EDGE: env refresh token takes precedence over the file (documented priority).
  it("lets an env refresh token override the file (source=mixed)", () => {
    const p = join(tmp, "client.json");
    writeStoredCredentials(storedFixture("FILE_TOKEN", "https://c.example/"), p);
    process.env.GOOGLE_GSC_REFRESH_TOKEN = "ENV_TOKEN";

    const resolved = resolveOAuthCredentials(p);

    expect(resolved.refresh_token).toBe("ENV_TOKEN");
    expect(resolved.source).toBe("mixed");
  });

  // Round-trips through the version gate so a future schema bump is caught.
  it("round-trips a written credentials file", () => {
    const p = join(tmp, "rt.json");
    writeStoredCredentials(storedFixture("RT", "https://rt.example/"), p);
    const back = readStoredCredentials(p);
    expect(back?.version).toBe(CREDENTIALS_FILE_VERSION);
    expect(back?.refresh_token).toBe("RT");
  });
});
