import { describe, it, expect } from "vitest";
import { selectAuthMode } from "./authMode.js";

// The runtime supports TWO auth models:
//   - service_account: a JSON keyfile whose PATH comes from
//     GOOGLE_APPLICATION_CREDENTIALS (or config.json credentials_file).
//   - oauth: a user refresh token (env GOOGLE_GSC_REFRESH_TOKEN or a stored
//     credentials file written by the auth helper).
//
// selectAuthMode is the single decision point. No machine-local default path
// may leak in — if neither signal is present it must NOT silently pick SA.

describe("selectAuthMode", () => {
  // ANCHOR: an explicit service-account keyfile path => service_account.
  it("picks service_account when a credentials_file path is present", () => {
    const m = selectAuthMode({ credentialsFile: "/some/sa.json", refreshToken: "", hasStoredCreds: false });
    expect(m.mode).toBe("service_account");
    expect(m.credentialsFile).toBe("/some/sa.json");
  });

  // ANCHOR: an env refresh token => oauth, even if no SA path.
  it("picks oauth when a refresh token is present and no SA path", () => {
    const m = selectAuthMode({ credentialsFile: "", refreshToken: "RT", hasStoredCreds: false });
    expect(m.mode).toBe("oauth");
  });

  // ANCHOR: a stored OAuth credentials file (auth helper output) => oauth.
  it("picks oauth when a stored credentials file exists", () => {
    const m = selectAuthMode({ credentialsFile: "", refreshToken: "", hasStoredCreds: true });
    expect(m.mode).toBe("oauth");
  });

  // ANCHOR: SA path WINS over OAuth signals when both present (SA is explicit,
  // and matches historical precedence in loadConfig()).
  it("prefers service_account when both a SA path and a refresh token are present", () => {
    const m = selectAuthMode({ credentialsFile: "/sa.json", refreshToken: "RT", hasStoredCreds: true });
    expect(m.mode).toBe("service_account");
  });

  // ANCHOR: nothing configured => a clear error signal, NOT a silent SA default.
  it("returns unconfigured (no silent default) when no signal is present", () => {
    const m = selectAuthMode({ credentialsFile: "", refreshToken: "", hasStoredCreds: false });
    expect(m.mode).toBe("unconfigured");
  });
});
