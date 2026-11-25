import { registerMcpTests } from "@drak-marketing/mcp-test-harness";
import { fileURLToPath } from "url";
import path from "path";
const __dirname = path.dirname(fileURLToPath(import.meta.url));

registerMcpTests({
  name: "mcp-gsc",
  repoRoot: path.resolve(__dirname, ".."),
  toolPrefix: "gsc_",
  minTools: 3,
  requiredTools: ["gsc_get_client_context", "gsc_list_sites", "gsc_search_analytics"],
  binEntries: { "mcp-google-gsc": "dist/index.js", "mcp-gsc-auth": "dist/auth-cli.js" },
  hasAuthCli: true,
  authCliBin: "dist/auth-cli.js",
  hasCredentials: true,
  hasResilience: true,
  hasPlatform: true,
  requiredEnvVars: [],
  envPrefix: "GOOGLE_GSC_",
  // Fakes only. With no credentials the server stops at "No GSC credentials
  // configured"; one complete user-OAuth set lets it start.
  startupEnv: {
    GOOGLE_GSC_CLIENT_ID: "fake-gsc-client-id",
    GOOGLE_GSC_CLIENT_SECRET: "fake-gsc-client-secret",
    GOOGLE_GSC_REFRESH_TOKEN: "fake-gsc-refresh-token",
  },
  sourceLintIgnore: ["index.ts"], // index.ts uses new URL for path resolution
});
