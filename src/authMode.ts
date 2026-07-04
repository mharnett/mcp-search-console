// ============================================
// Auth-mode selection (single decision point)
// ============================================
// mcp-gsc supports TWO auth models:
//   - service_account: a JSON keyfile whose PATH comes from
//     GOOGLE_APPLICATION_CREDENTIALS (or config.json `credentials_file`). No
//     refresh token; the runtime signs requests with the service account.
//   - oauth: a user refresh token (env GOOGLE_GSC_REFRESH_TOKEN, or a stored
//     credentials file written by the auth helper).
//
// This function makes the choice deterministically from resolved signals, with
// NO machine-local default: if nothing is configured it returns "unconfigured"
// so the caller can emit a clear onboarding error instead of silently assuming
// a service-account file that only exists on one developer's machine.

export interface AuthModeInputs {
  /** Absolute service-account keyfile path (from GOOGLE_APPLICATION_CREDENTIALS or config.json). "" if none. */
  credentialsFile: string;
  /** User-OAuth refresh token from env (GOOGLE_GSC_REFRESH_TOKEN). "" if none. */
  refreshToken: string;
  /** True if a stored OAuth credentials file (auth-helper output) exists on disk. */
  hasStoredCreds: boolean;
}

export type AuthMode = "service_account" | "oauth" | "unconfigured";

export interface AuthModeSelection {
  mode: AuthMode;
  /** Echoed back for service_account so the caller can load the keyfile. */
  credentialsFile: string;
}

/**
 * Decide the auth mode. Precedence:
 *   1. service_account — an explicit keyfile path wins (matches historical
 *      loadConfig precedence and is the most explicit signal).
 *   2. oauth — a refresh token (env) or a stored credentials file.
 *   3. unconfigured — no signal; caller must surface an onboarding error.
 */
export function selectAuthMode(inputs: AuthModeInputs): AuthModeSelection {
  const credentialsFile = (inputs.credentialsFile || "").trim();
  if (credentialsFile) {
    return { mode: "service_account", credentialsFile };
  }
  if ((inputs.refreshToken || "").trim() || inputs.hasStoredCreds) {
    return { mode: "oauth", credentialsFile: "" };
  }
  return { mode: "unconfigured", credentialsFile: "" };
}
