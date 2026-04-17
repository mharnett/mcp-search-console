import { registerMcpTests } from "@drak/mcp-test-harness";
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
  sourceLintIgnore: ["index.ts"], // index.ts uses new URL for path resolution
});
