#!/usr/bin/env node
// ============================================
// mcp-gsc-auth -- one-time OAuth + site selection
// ============================================
// Flow:
//   1. Loopback HTTP listener on a free port
//   2. Open browser to Google OAuth consent screen (webmasters.readonly scope)
//   3. Exchange code for tokens
//   4. Enumerate accessible GSC sites
//   5. User picks which site to use as default
//   6. Write credentials to ~/.config/mcp-gsc-nodejs/credentials.json

import { google } from "googleapis";
import http from "http";
import promptsImport from "prompts";
import { URL } from "url";
import { writeStoredCredentials, credentialsFilePath, CREDENTIALS_FILE_VERSION, type StoredCredentials } from "./credentials.js";
import { EMBEDDED_CLIENT_ID, EMBEDDED_CLIENT_SECRET } from "./embedded-secrets.js";
import { classifyError, GscAuthError } from "./errors.js";
import { findFreeLoopbackPort, openBrowser } from "./platform.js";
import { logger, withResilience } from "./resilience.js";

const prompts = (promptsImport as unknown as { default?: typeof promptsImport }).default ?? promptsImport;

const OAUTH_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";
const OAUTH_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";

interface CliArgs {
  siteUrl?: string;
  help: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") args.help = true;
    else if (a === "--site-url" && argv[i + 1]) {
      args.siteUrl = argv[++i];
    }
  }
  return args;
}

function printHelp(): void {
  process.stdout.write(
    [
      "mcp-gsc-auth -- authorize Claude to access your Google Search Console data",
      "",
      "Usage:",
      "  npx mcp-gsc-auth",
      "  npx mcp-gsc-auth --site-url https://example.com/",
      "",
      "Options:",
      "  --site-url <url>   Skip the site picker and use this property directly",
      "  -h, --help         Show this help",
      "",
      `Credentials are written to: ${credentialsFilePath}`,
      "",
    ].join("\n"),
  );
}

// ============================================
// OAUTH: LOOPBACK REDIRECT FLOW
// ============================================

function buildAuthUrl(clientId: string, redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: OAUTH_SCOPE,
    access_type: "offline",
    prompt: "consent",
    state,
  });
  return `${OAUTH_AUTH_URL}?${params.toString()}`;
}

interface AuthorizationCode {
  code: string;
  state: string;
}

async function waitForAuthorizationCode(
  port: number,
  expectedState: string,
  authUrl: string,
): Promise<AuthorizationCode> {
  return new Promise<AuthorizationCode>((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };

    const server = http.createServer((req, res) => {
      if (!req.url) {
        res.writeHead(404).end();
        return;
      }
      const parsed = new URL(req.url, `http://127.0.0.1:${port}`);
      const code = parsed.searchParams.get("code");
      const state = parsed.searchParams.get("state");
      const error = parsed.searchParams.get("error");

      if (error) {
        res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
        res.end(renderPage("Authorization was denied", `Google returned: ${escapeHtml(error)}. Close this tab and re-run the command.`));
        finish(() => { server.close(); reject(new GscAuthError(`OAuth denied: ${error}`)); });
        return;
      }

      if (!code) {
        res.writeHead(204).end();
        return;
      }

      if (state !== expectedState) {
        res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
        res.end(renderPage("Security check failed", "The state parameter did not match. Please re-run the command."));
        finish(() => { server.close(); reject(new GscAuthError("OAuth state mismatch")); });
        return;
      }

      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(renderPage("Signed in successfully", "You can close this tab and return to the terminal."));
      finish(() => {
        setTimeout(() => server.close(), 200);
        resolve({ code, state });
      });
    });

    server.on("error", (err) => {
      finish(() => reject(new Error(`Loopback server failed: ${err.message}`)));
    });

    server.listen(port, "127.0.0.1", () => {
      process.stderr.write(`\nOpening your browser to sign in with Google...\n`);
      process.stderr.write(`If it doesn't open automatically, visit:\n  ${authUrl}\n\n`);
      openBrowser(authUrl).catch((err) => {
        logger.warn({ err: err.message }, "openBrowser failed");
      });
    });

    setTimeout(() => {
      finish(() => { server.close(); reject(new Error("Timed out waiting for OAuth callback (5 minutes).")); });
    }, 5 * 60 * 1000);
  });
}

function renderPage(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"><title>${escapeHtml(title)}</title>
  <style>body{font:15px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;max-width:480px;margin:80px auto;padding:0 24px;color:#222}h1{font-size:22px;margin-bottom:12px}p{line-height:1.5}</style>
</head>
<body><h1>${escapeHtml(title)}</h1><p>${escapeHtml(body)}</p></body>
</html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

// ============================================
// TOKEN EXCHANGE
// ============================================

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope: string;
  token_type: string;
}

async function exchangeCodeForTokens(
  code: string,
  clientId: string,
  clientSecret: string,
  redirectUri: string,
): Promise<TokenResponse> {
  return withResilience(async () => {
    const body = new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    });
    const res = await fetch(OAUTH_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    const json = (await res.json()) as Record<string, unknown>;
    if (!res.ok || json.error) {
      const err = new Error(
        `Token exchange failed: ${json.error_description || json.error || res.statusText}`,
      );
      (err as any).status = res.status;
      (err as any).code = res.status;
      throw err;
    }
    return json as unknown as TokenResponse;
  }, "oauth.exchangeCode");
}

// ============================================
// SITE ENUMERATION
// ============================================

interface GscSite {
  siteUrl: string;
  permissionLevel: string;
}

async function enumerateSites(accessToken: string): Promise<GscSite[]> {
  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({ access_token: accessToken });

  const svc = google.searchconsole({ version: "v1", auth: oauth2Client });
  const resp = await withResilience(
    () => svc.sites.list(),
    "auth.listSites",
  );

  const sites = (resp.data.siteEntry || []).map((entry) => ({
    siteUrl: entry.siteUrl || "",
    permissionLevel: entry.permissionLevel || "",
  }));

  if (sites.length === 0) {
    throw new GscAuthError(
      "No Search Console properties found for this Google account. " +
        "Make sure you signed in with an account that has access to at least one property.",
    );
  }

  return sites;
}

// ============================================
// PICKER
// ============================================

async function pickSite(sites: GscSite[], presetSiteUrl?: string): Promise<GscSite> {
  if (presetSiteUrl) {
    const match = sites.find((s) => s.siteUrl === presetSiteUrl);
    if (!match) {
      throw new Error(
        `--site-url "${presetSiteUrl}" was not found among ${sites.length} accessible properties. ` +
          `Remove the flag to pick interactively.`,
      );
    }
    return match;
  }

  if (sites.length === 1) {
    process.stderr.write(`\nOnly one property accessible: ${sites[0].siteUrl}. Auto-selecting.\n`);
    return sites[0];
  }

  const choices = sites.map((site) => ({
    title: `${site.siteUrl}  (${site.permissionLevel})`,
    value: site,
  }));

  const response = await prompts(
    {
      type: "select",
      name: "site",
      message: "Which Search Console property should Claude use by default?",
      choices,
      initial: 0,
    },
    {
      onCancel: () => { throw new Error("Cancelled by user"); },
    },
  );

  if (!response.site) throw new Error("No site selected");
  return response.site as GscSite;
}

// ============================================
// MAIN
// ============================================

export async function run(argv: string[] = process.argv.slice(2)): Promise<void> {
  const args = parseArgs(argv);
  if (args.help) {
    printHelp();
    return;
  }

  const clientId = process.env.GOOGLE_GSC_CLIENT_ID?.trim() || EMBEDDED_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_GSC_CLIENT_SECRET?.trim() || EMBEDDED_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    process.stderr.write(
      "This build of mcp-gsc was published without embedded OAuth credentials.\n" +
        "Set GOOGLE_GSC_CLIENT_ID and GOOGLE_GSC_CLIENT_SECRET in your environment.\n",
    );
    process.exit(2);
  }

  const port = await findFreeLoopbackPort();
  const redirectUri = `http://127.0.0.1:${port}`;
  const state = randomState();
  const authUrl = buildAuthUrl(clientId, redirectUri, state);

  process.stderr.write("\n=== mcp-gsc authentication ===\n");

  const { code } = await waitForAuthorizationCode(port, state, authUrl);
  process.stderr.write("Authorization code received. Exchanging for tokens...\n");

  const tokens = await exchangeCodeForTokens(code, clientId, clientSecret, redirectUri);
  if (!tokens.refresh_token) {
    throw new GscAuthError(
      "Google did not return a refresh token. This can happen if you previously granted consent " +
        "to this app. Revoke access at https://myaccount.google.com/permissions and try again.",
    );
  }
  process.stderr.write("Tokens received. Fetching accessible Search Console properties...\n");

  const sites = await enumerateSites(tokens.access_token);
  const chosen = await pickSite(sites, args.siteUrl);

  const stored: StoredCredentials = {
    version: CREDENTIALS_FILE_VERSION,
    refresh_token: tokens.refresh_token,
    site_urls: sites.map((s) => s.siteUrl),
    primary_site_url: chosen.siteUrl,
    obtained_at: new Date().toISOString(),
    scopes: [OAUTH_SCOPE],
  };
  writeStoredCredentials(stored);

  process.stderr.write(
    [
      "",
      "Done.",
      "",
      `  Property:   ${chosen.siteUrl}`,
      `  Permission: ${chosen.permissionLevel}`,
      `  Saved to:   ${credentialsFilePath}`,
      "",
      "Next step: fully quit Claude Desktop (Cmd+Q / File > Exit) and reopen it.",
      'Then try: "List my Search Console properties"',
      "",
    ].join("\n"),
  );
}

function randomState(): string {
  const bytes = new Uint8Array(16);
  (globalThis.crypto as Crypto).getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ============================================
// ENTRY
// ============================================

// Always run when loaded as an entry point. The bin symlink name (mcp-gsc-auth)
// differs from the file name (auth-cli.js), so import.meta.url checks don't
// work reliably under npx. Since this module has no side effects when imported
// as a library (run() must be called explicitly), unconditional execution is safe.
run().catch((err) => {
  const classified = classifyError(err);
  process.stderr.write(`\n${classified.message}\n`);
  process.exit(1);
});
