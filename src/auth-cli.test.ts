import { describe, it, expect } from "vitest";
import { buildAuthUrl, resolveAuthScope } from "./auth-cli.js";
import { computeCodeChallenge } from "./pkce.js";
import { DEFAULT_GSC_SCOPE } from "./oauthScope.js";

// The runtime onboarding path (mcp-gsc-auth) must match the standalone helper:
//   - PKCE S256 (code_challenge + code_challenge_method)
//   - canonical loopback redirect http://localhost:<port>/callback
//   - scope resolved from config (oauth.scope), NOT hardcoded
//
// buildAuthUrl and resolveAuthScope are the pure, importable pieces. Importing
// this module must NOT start the OAuth loopback server (the live run() is
// guarded behind a main check).

describe("auth-cli buildAuthUrl (PKCE, canonical redirect, config scope)", () => {
  const base = {
    clientId: "cid.apps.googleusercontent.com",
    redirectUri: "http://localhost:8123/callback",
    scope: "https://www.googleapis.com/auth/webmasters.readonly",
    state: "state123",
    codeChallenge: "CHALLENGE",
  };

  it("targets Google's auth endpoint", () => {
    const url = new URL(buildAuthUrl(base));
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
  });

  it("carries PKCE S256 params", () => {
    const url = new URL(buildAuthUrl(base));
    expect(url.searchParams.get("code_challenge")).toBe("CHALLENGE");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  });

  it("carries access_type=offline and prompt=consent", () => {
    const url = new URL(buildAuthUrl(base));
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
  });

  it("uses the canonical loopback redirect (/callback, host localhost)", () => {
    const url = new URL(buildAuthUrl(base));
    const redirect = url.searchParams.get("redirect_uri");
    expect(redirect).toBe("http://localhost:8123/callback");
    expect(redirect).toMatch(/\/callback$/);
    expect(redirect).not.toContain("127.0.0.1");
  });

  it("carries the scope it was given (not a hardcoded one)", () => {
    const url = new URL(buildAuthUrl({ ...base, scope: "SCOPE_FROM_CONFIG" }));
    expect(url.searchParams.get("scope")).toBe("SCOPE_FROM_CONFIG");
  });

  it("uses a real PKCE challenge end-to-end (challenge derives from a verifier)", () => {
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    const challenge = computeCodeChallenge(verifier);
    const url = new URL(buildAuthUrl({ ...base, codeChallenge: challenge }));
    expect(url.searchParams.get("code_challenge")).toBe(challenge);
  });
});

describe("auth-cli resolveAuthScope (from config)", () => {
  it("falls back to the read-only webmasters default when config absent", () => {
    // A path that does not exist -> default. Same contract as the runtime.
    const scope = resolveAuthScope("/no/such/config.json");
    expect(scope).toBe(DEFAULT_GSC_SCOPE);
    expect(scope).toBe("https://www.googleapis.com/auth/webmasters.readonly");
  });
});
