// ============================================
// CREDENTIAL LOADING & PERSISTENCE
// ============================================
// Priority order:
//   1. config.json + service account (existing multi-client setups)
//   2. GOOGLE_GSC_* env vars (explicit override)
//   3. Per-user OAuth credentials file (written by mcp-gsc-auth)
//   4. EMBEDDED_* constants (client_id, client_secret from build-time)

import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "fs";
import path from "path";
import { EMBEDDED_CLIENT_ID, EMBEDDED_CLIENT_SECRET } from "./embedded-secrets.js";
import { configDir, credentialsFilePath } from "./platform.js";
import { logger } from "./resilience.js";

export const CREDENTIALS_FILE_VERSION = 1;

export interface StoredCredentials {
  version: number;
  refresh_token: string;
  site_urls: string[];
  primary_site_url?: string;
  obtained_at: string;
  scopes: string[];
}

export interface ResolvedOAuthCredentials {
  client_id: string;
  client_secret: string;
  refresh_token: string;
  site_urls: string[];
  primary_site_url: string;
  source: "env" | "file" | "mixed";
}

const envTrimmed = (key: string): string =>
  (process.env[key] || "").trim().replace(/^["']|["']$/g, "");

// ============================================
// FILE I/O
// ============================================

export function readStoredCredentials(filePath: string = credentialsFilePath): StoredCredentials | null {
  if (!existsSync(filePath)) return null;
  try {
    const raw = readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    if (parsed.version !== CREDENTIALS_FILE_VERSION) {
      logger.warn(
        { path: filePath, version: parsed.version, expected: CREDENTIALS_FILE_VERSION },
        "Credentials file version mismatch",
      );
      return null;
    }
    return parsed as StoredCredentials;
  } catch (err) {
    logger.warn({ err, path: filePath }, "Failed to parse credentials file");
    return null;
  }
}

export function writeStoredCredentials(
  creds: StoredCredentials,
  filePath: string = credentialsFilePath,
): void {
  const dir = path.dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(filePath, JSON.stringify(creds, null, 2), { encoding: "utf-8" });
  try {
    chmodSync(filePath, 0o600);
  } catch {
    // Best-effort on POSIX
  }
}

// ============================================
// RESOLVE (read-time priority chain)
// ============================================

export function resolveOAuthCredentials(
  credsFilePath: string = credentialsFilePath,
): ResolvedOAuthCredentials {
  const client_id = envTrimmed("GOOGLE_GSC_CLIENT_ID") || EMBEDDED_CLIENT_ID;
  const client_secret = envTrimmed("GOOGLE_GSC_CLIENT_SECRET") || EMBEDDED_CLIENT_SECRET;

  const stored = readStoredCredentials(credsFilePath);
  const envRefresh = envTrimmed("GOOGLE_GSC_REFRESH_TOKEN");
  const envSiteUrl = envTrimmed("GOOGLE_GSC_SITE_URL");

  const refresh_token = envRefresh || stored?.refresh_token || "";
  const site_urls = stored?.site_urls || [];
  const primary_site_url = envSiteUrl || stored?.primary_site_url || site_urls[0] || "";

  const source: ResolvedOAuthCredentials["source"] =
    envRefresh && stored ? "mixed" : envRefresh ? "env" : stored ? "file" : "env";

  const missing: string[] = [];
  if (!client_id) missing.push("client_id");
  if (!client_secret) missing.push("client_secret");
  if (!refresh_token) missing.push("refresh_token");

  if (missing.length > 0) {
    throw new Error(buildMissingCredentialsMessage(missing, Boolean(stored)));
  }

  return { client_id, client_secret, refresh_token, site_urls, primary_site_url, source };
}

function buildMissingCredentialsMessage(missing: string[], hasFile: boolean): string {
  const runAuth = "npx mcp-gsc-auth";
  const lines: string[] = [
    `Missing GSC OAuth credentials: ${missing.join(", ")}.`,
    ``,
    `To get started, run:`,
    `    ${runAuth}`,
    ``,
    `This will open your browser, walk you through Google sign-in, let you pick which`,
    `Search Console property to use, and save the result to:`,
    `    ${credentialsFilePath}`,
  ];
  if (hasFile) {
    lines.push(
      ``,
      `A credentials file exists at ${credentialsFilePath} but is missing required fields.`,
      `Re-run the auth helper to refresh it.`,
    );
  }
  lines.push(
    ``,
    `Advanced: you can bypass the auth helper by setting these env vars:`,
    `  GOOGLE_GSC_CLIENT_ID, GOOGLE_GSC_CLIENT_SECRET, GOOGLE_GSC_REFRESH_TOKEN`,
    ``,
    `Or use a service account: set GOOGLE_APPLICATION_CREDENTIALS to a JSON key file.`,
  );
  return lines.join("\n");
}

export { configDir, credentialsFilePath } from "./platform.js";
