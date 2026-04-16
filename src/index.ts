#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { readFileSync, existsSync } from "fs";
import { join, dirname, resolve, isAbsolute } from "path";
import { google, searchconsole_v1 } from "googleapis";
import { GoogleAuth, OAuth2Client } from "googleapis-common";
import {
  GscAuthError,
  GscRateLimitError,
  GscServiceError,
  classifyError,
  validateCredentials,
} from "./errors.js";
import { resolveOAuthCredentials } from "./credentials.js";
import { EMBEDDED_CLIENT_ID, EMBEDDED_CLIENT_SECRET } from "./embedded-secrets.js";
import { tools } from "./tools.js";
import { withResilience, safeResponse, logger } from "./resilience.js";
import v8 from "v8";

// CLI package info
const __cliPkg = JSON.parse(readFileSync(join(dirname(new URL(import.meta.url).pathname), "..", "package.json"), "utf-8"));

// Log build fingerprint at startup
try {
  const __buildInfoDir = dirname(new URL(import.meta.url).pathname);
  const buildInfo = JSON.parse(readFileSync(join(__buildInfoDir, "build-info.json"), "utf-8"));
  console.error(`[build] SHA: ${buildInfo.sha} (${buildInfo.builtAt})`);
} catch {
  console.error(`[build] ${__cliPkg.name}@${__cliPkg.version} (dev mode)`);
}

// Version safety: warn if running a deprecated or dangerously old version
const __minimumSafeVersion = "1.0.5"; // minimum version with input sanitization
const __semverLt = (a: string, b: string) => { const pa = a.split(".").map(Number), pb = b.split(".").map(Number); for (let i = 0; i < 3; i++) { if ((pa[i] || 0) < (pb[i] || 0)) return true; if ((pa[i] || 0) > (pb[i] || 0)) return false; } return false; };
if (__semverLt(__cliPkg.version, __minimumSafeVersion)) {
  console.error(`[WARNING] Running deprecated version ${__cliPkg.version}. Minimum safe version is ${__minimumSafeVersion}. Please upgrade.`);
}

// CLI flags
if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.error(`${__cliPkg.name} v${__cliPkg.version}\n`);
  console.error(`Usage: ${__cliPkg.name} [options]\n`);
  console.error("MCP server communicating via stdio. Configure in your .mcp.json.\n");
  console.error("Options:");
  console.error("  --help, -h       Show this help message");
  console.error("  --version, -v    Show version number");
  console.error(`\nDocumentation: https://github.com/mharnett/mcp-search-console`);
  process.exit(0);
}
if (process.argv.includes("--version") || process.argv.includes("-v")) {
  console.error(__cliPkg.version);
  process.exit(0);
}

// Startup: detect npx vs direct node
if (process.argv[1]?.includes('.npm/_npx')) {
  console.error("[startup] Running via npx -- first run may be slow due to package resolution");
}

// Startup: check heap size
const heapLimit = v8.getHeapStatistics().heap_size_limit;
if (heapLimit < 256 * 1024 * 1024) {
  console.error(`[startup] WARNING: Heap limit is ${Math.round(heapLimit / 1024 / 1024)}MB`);
}

// ============================================
// ENV VAR TRIMMING
// ============================================

const envTrimmed = (key: string): string => (process.env[key] || "").trim().replace(/^["']|["']$/g, "");

// ============================================
// CONFIGURATION
// ============================================

interface ClientConfig {
  name: string;
  folder: string;
  site_url: string;
}

interface Config {
  credentials_file: string;
  clients: Record<string, ClientConfig>;
}

function loadConfig(): Config {
  // Try config.json (for multi-client setups)
  const configPath = join(dirname(new URL(import.meta.url).pathname), "..", "config.json");
  if (existsSync(configPath)) {
    const raw = JSON.parse(readFileSync(configPath, "utf-8"));
    const rawCf = raw.credentials_file || envTrimmed("GOOGLE_APPLICATION_CREDENTIALS");
    return {
      credentials_file: rawCf && !isAbsolute(rawCf) ? resolve(rawCf) : rawCf,
      clients: raw.clients || {},
    };
  }

  // Fall back to env vars for service account
  const rawCredsFile = envTrimmed("GOOGLE_APPLICATION_CREDENTIALS");
  const credsFile = rawCredsFile && !isAbsolute(rawCredsFile) ? resolve(rawCredsFile) : rawCredsFile;
  if (credsFile) {
    return {
      credentials_file: credsFile,
      clients: {},
    };
  }

  // Fall back to OAuth credentials (from mcp-gsc-auth or env vars)
  // Return empty credentials_file to signal OAuth mode
  return {
    credentials_file: "",
    clients: {},
  };
}

function getClientFromWorkingDir(config: Config, cwd: string): ClientConfig | null {
  for (const [key, client] of Object.entries(config.clients)) {
    if (cwd.startsWith(client.folder) || cwd.includes(key)) {
      return client;
    }
  }
  return null;
}

function getDefaultSiteUrl(config: Config): string | null {
  const clients = Object.values(config.clients);
  return clients.length > 0 ? clients[0].site_url : null;
}

// ============================================
// DATE HELPERS
// ============================================

// Note: resolveDate uses UTC dates via toISOString(). GSC data is in the property's timezone.
// At 11PM PT, "today" resolves to tomorrow in UTC. Users should be aware of this timezone behavior.
function resolveDate(dateStr: string): string {
  const today = new Date();
  if (dateStr === "today") {
    return today.toISOString().slice(0, 10);
  }
  const match = dateStr.match(/^(\d+)daysAgo$/);
  if (match) {
    const days = parseInt(match[1], 10);
    const d = new Date(today);
    d.setDate(d.getDate() - days);
    return d.toISOString().slice(0, 10);
  }
  return dateStr; // assume YYYY-MM-DD
}

// ============================================
// DIMENSION FILTER PARSING
// ============================================

interface DimensionFilter {
  dimension: string;
  operator: string;
  expression: string;
}

function parseDimensionFilter(filterStr: string): DimensionFilter | null {
  if (!filterStr) return null;

  const operators = [
    "includingRegex", "excludingRegex",
    "notContains", "notEquals",
    "contains", "equals",
  ];

  for (const op of operators) {
    const parts = filterStr.split(` ${op} `, 2);
    if (parts.length === 2) {
      return {
        dimension: parts[0].trim(),
        operator: op,
        expression: parts[1].trim(),
      };
    }
  }

  return null;
}

// ============================================
// GOOGLE SEARCH CONSOLE API CLIENT
// ============================================

class GscManager {
  private config: Config;
  private service: searchconsole_v1.Searchconsole | null = null;
  private authMode: "service_account" | "oauth" = "service_account";

  constructor(config: Config) {
    this.config = config;

    if (config.credentials_file) {
      // Service account mode
      const creds = validateCredentials(config.credentials_file);
      if (!creds.valid) {
        const msg = `[STARTUP ERROR] Missing required credentials: ${creds.missing.join(", ")}. MCP will not function.`;
        console.error(msg);
        throw new GscAuthError(msg);
      }
      this.authMode = "service_account";
    } else {
      // OAuth mode -- resolve will throw with helpful message if no credentials found
      resolveOAuthCredentials(); // validates credentials exist
      this.authMode = "oauth";
    }
  }

  private getService(): searchconsole_v1.Searchconsole {
    if (!this.service) {
      if (this.authMode === "service_account") {
        const auth = new google.auth.GoogleAuth({
          keyFile: this.config.credentials_file,
          scopes: ["https://www.googleapis.com/auth/webmasters.readonly"],
        });
        this.service = google.searchconsole({ version: "v1", auth });
        console.error(`[startup] Service account loaded from: ${this.config.credentials_file}`);
      } else {
        const resolved = resolveOAuthCredentials();
        const oauth2Client = new google.auth.OAuth2(
          resolved.client_id,
          resolved.client_secret,
        );
        oauth2Client.setCredentials({ refresh_token: resolved.refresh_token });
        this.service = google.searchconsole({ version: "v1", auth: oauth2Client });
        console.error(`[startup] OAuth credentials loaded (source: ${resolved.source})`);
      }
    }
    return this.service;
  }

  async listSites(): Promise<any> {
    const svc = this.getService();
    return withResilience(async () => {
      const resp = await svc.sites.list();
      const sites = (resp.data.siteEntry || []).map((entry) => ({
        site_url: entry.siteUrl || "",
        permission_level: entry.permissionLevel || "",
      }));
      return { sites, count: sites.length };
    }, "gsc_list_sites");
  }

  async searchAnalytics(options: {
    startDate: string;
    endDate: string;
    dimensions: string[];
    searchType: string;
    dimensionFilter: string;
    rowLimit: number;
    aggregationType: string;
    siteUrl: string;
  }): Promise<any> {
    const svc = this.getService();
    const siteUrl = options.siteUrl || getDefaultSiteUrl(this.config);
    if (!siteUrl) {
      return { error: "No site_url provided and none found in config" };
    }

    const rowLimit = Math.min(Math.max(1, options.rowLimit), 25000);
    const startDate = resolveDate(options.startDate);
    const endDate = resolveDate(options.endDate);

    // Future date validation (skip relative dates like "90daysAgo")
    const today_gsc = new Date().toISOString().slice(0, 10);
    if (startDate && !options.startDate.includes("daysAgo") && !options.startDate.includes("yesterday") && !options.startDate.includes("today") && startDate > today_gsc) {
      return { error: `start_date "${startDate}" is in the future. Reports only cover historical data.` };
    }

    const requestBody: any = {
      startDate,
      endDate,
      dimensions: options.dimensions,
      type: options.searchType,
      rowLimit,
      aggregationType: options.aggregationType,
    };

    const parsed = parseDimensionFilter(options.dimensionFilter);
    if (parsed) {
      requestBody.dimensionFilterGroups = [{
        filters: [{
          dimension: parsed.dimension,
          operator: parsed.operator,
          expression: parsed.expression,
        }],
      }];
    }

    return withResilience(async () => {
      const resp = await svc.searchanalytics.query({
        siteUrl,
        requestBody,
      });

      const rows = (resp.data.rows || []).map((row) => {
        const r: Record<string, any> = {};
        for (let i = 0; i < options.dimensions.length; i++) {
          if (row.keys && i < row.keys.length) {
            r[options.dimensions[i]] = row.keys[i];
          }
        }
        r.clicks = row.clicks || 0;
        r.impressions = row.impressions || 0;
        r.ctr = Math.round((row.ctr || 0) * 10000) / 10000;
        r.position = Math.round((row.position || 0) * 10) / 10;
        return r;
      });

      return {
        rows,
        row_count: rows.length,
        date_range: `${startDate} to ${endDate}`,
        site_url: siteUrl,
      };
    }, "gsc_search_analytics");
  }

  async inspection(url: string, siteUrl: string): Promise<any> {
    const svc = this.getService();
    const resolvedSiteUrl = siteUrl || getDefaultSiteUrl(this.config);
    if (!resolvedSiteUrl) {
      return { error: "No site_url provided and none found in config" };
    }

    return withResilience(async () => {
      try {
        const resp = await svc.urlInspection.index.inspect({
          requestBody: {
            inspectionUrl: url,
            siteUrl: resolvedSiteUrl,
          },
        });

        const result = resp.data.inspectionResult || {};
        const indexStatus = result.indexStatusResult || {};
        const mobile = result.mobileUsabilityResult || {};
        const rich = result.richResultsResult || {};

        return {
          url,
          site_url: resolvedSiteUrl,
          index_status: {
            verdict: indexStatus.verdict || "UNKNOWN",
            coverage_state: indexStatus.coverageState || "",
            indexing_state: indexStatus.indexingState || "",
            last_crawl_time: indexStatus.lastCrawlTime || "",
            page_fetch_state: indexStatus.pageFetchState || "",
            robots_txt_state: indexStatus.robotsTxtState || "",
            crawled_as: indexStatus.crawledAs || "",
            referring_urls: indexStatus.referringUrls || [],
          },
          mobile_usability: {
            verdict: mobile.verdict || "UNKNOWN",
            issues: (mobile.issues || []).map((i: any) => i.issueType || ""),
          },
          rich_results: {
            verdict: rich.verdict || "UNKNOWN",
          },
        };
      } catch (err) {
        return { error: String(err), url, site_url: resolvedSiteUrl };
      }
    }, "gsc_inspection");
  }
}

// ============================================
// MCP SERVER
// ============================================

const config = loadConfig();
const gscManager = new GscManager(config);

const server = new Server(
  {
    name: __cliPkg.name,
    version: __cliPkg.version,
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "gsc_get_client_context": {
        const cwd = args?.working_directory as string;
        const client = getClientFromWorkingDir(config, cwd);
        if (!client) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                error: "No client found for working directory",
                working_directory: cwd,
                available_clients: Object.entries(config.clients).map(([k, v]) => ({
                  key: k,
                  name: v.name,
                  folder: v.folder,
                })),
              }, null, 2),
            }],
          };
        }
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              client_name: client.name,
              site_url: client.site_url,
              folder: client.folder,
            }, null, 2),
          }],
        };
      }

      case "gsc_list_sites": {
        const result = await gscManager.listSites();
        return {
          content: [{
            type: "text",
            text: JSON.stringify(safeResponse(result, "listSites"), null, 2),
          }],
        };
      }

      case "gsc_search_analytics": {
        const dimensions = ((args?.dimensions as string) || "query")
          .split(",")
          .map((d: string) => d.trim())
          .filter(Boolean);

        const result = await gscManager.searchAnalytics({
          startDate: (args?.start_date as string) || "90daysAgo",
          endDate: (args?.end_date as string) || "today",
          dimensions,
          searchType: (args?.search_type as string) || "web",
          dimensionFilter: (args?.dimension_filter as string) || "",
          rowLimit: (args?.row_limit as number) || 100,
          aggregationType: (args?.aggregation_type as string) || "auto",
          siteUrl: (args?.site_url as string) || "",
        });

        return {
          content: [{
            type: "text",
            text: JSON.stringify(safeResponse(result, "searchAnalytics"), null, 2),
          }],
        };
      }

      case "gsc_inspection": {
        const result = await gscManager.inspection(
          args?.url as string,
          (args?.site_url as string) || "",
        );
        return {
          content: [{
            type: "text",
            text: JSON.stringify(result, null, 2),
          }],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (rawError: any) {
    const error = classifyError(rawError);
    logger.error({ error_type: error.name, message: error.message }, "Tool call failed");

    const response: Record<string, unknown> = {
      error: true,
      error_type: error.name,
      message: error.message,
      server: __cliPkg.name,
    };

    if (error instanceof GscAuthError) {
      response.action_required = "Check credentials (service account or OAuth) and Search Console permissions. If using OAuth, re-run: npx mcp-gsc-auth";
    } else if (error instanceof GscRateLimitError) {
      response.retry_after_ms = error.retryAfterMs;
      response.action_required = `Rate limited. Retry after ${Math.ceil(error.retryAfterMs / 1000)} seconds.`;
    } else if (error instanceof GscServiceError) {
      response.action_required = "Google Search Console API server error. This is transient - retry in a few minutes.";
    } else {
      response.details = rawError.stack;
    }

    // Size-limit error responses through safeResponse to prevent oversized payloads
    const safeErrorResponse = safeResponse(response, "error");
    return {
      isError: true,
      content: [{
        type: "text",
        text: JSON.stringify(safeErrorResponse, null, 2),
      }],
    };
  }
});

// Start server
async function main() {
  try {
    await gscManager.listSites();
    console.error("[startup] Auth verified: GSC API call succeeded");
  } catch (err: any) {
    console.error(`[STARTUP WARNING] Auth check FAILED: ${err.message}`);
    console.error(`[STARTUP WARNING] MCP will start but API calls may fail until auth is fixed.`);
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[startup] MCP GSC server running");
}

process.on("SIGTERM", () => {
  console.error("[shutdown] SIGTERM received, exiting");
  process.exit(0);
});

process.on("SIGINT", () => {
  console.error("[shutdown] SIGINT received, exiting");
  process.exit(0);
});

process.on("SIGPIPE", () => {
  // Client disconnected -- expected during shutdown
});

process.on("unhandledRejection", (reason) => {
  console.error("[error] Unhandled promise rejection:", reason);
});

main().catch(console.error);
