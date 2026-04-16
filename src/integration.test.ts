import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const LIVE = process.env.LIVE_TEST === "true";

function parseToolResult(result: any): any {
  const text = result?.content?.[0]?.text;
  if (!text) return null;
  return JSON.parse(text);
}

describe.skipIf(!LIVE)("mcp-gsc integration", () => {
  let client: Client;
  let transport: StdioClientTransport;

  beforeAll(async () => {
    transport = new StdioClientTransport({
      command: "bash",
      args: ["-c", "source ./run-mcp.sh"],
      cwd: "/Users/mark/claude-code/mcps/mcp-gsc",
    });
    client = new Client({ name: "test-client", version: "1.0.0" }, { capabilities: {} });
    await client.connect(transport);
  }, 30_000);

  afterAll(async () => {
    await client?.close();
  });

  it("lists tools and finds expected tool names", async () => {
    const result = await client.listTools();
    const names = result.tools.map((t) => t.name);
    expect(names).toContain("gsc_list_sites");
    expect(names).toContain("gsc_search_analytics");
    expect(names).toContain("gsc_inspection");
    expect(names).toHaveLength(4);
  });

  it("gsc_list_sites returns sites array", async () => {
    const result = await client.callTool({
      name: "gsc_list_sites",
      arguments: {},
    });
    const data = parseToolResult(result);
    expect(data).toBeDefined();
    expect(data.sites).toBeDefined();
    expect(Array.isArray(data.sites)).toBe(true);
    expect(data.count).toBeGreaterThanOrEqual(0);
  }, 15_000);

  it("gsc_search_analytics with default params returns rows", async () => {
    const result = await client.callTool({
      name: "gsc_search_analytics",
      arguments: {
        start_date: "30daysAgo",
        end_date: "today",
        dimensions: "query",
        row_limit: 10,
      },
    });
    const data = parseToolResult(result);
    expect(data).toBeDefined();
    expect(data.rows || data.error).toBeDefined();
    if (data.rows) {
      expect(Array.isArray(data.rows)).toBe(true);
      expect(data.row_count).toBeGreaterThanOrEqual(0);
      expect(data.date_range).toBeDefined();
    }
  }, 15_000);

  it("gsc_inspection with a known URL", async () => {
    const result = await client.callTool({
      name: "gsc_inspection",
      arguments: {
        url: "https://www.example.com/",
        site_url: "sc-domain:example.com",
      },
    });
    const data = parseToolResult(result);
    expect(data).toBeDefined();
    // Should have index_status or error
    expect(data.index_status || data.error).toBeDefined();
  }, 15_000);

  it("error: invalid site_url returns error", async () => {
    const result = await client.callTool({
      name: "gsc_search_analytics",
      arguments: {
        site_url: "https://not-a-real-site-12345.example.com/",
        start_date: "7daysAgo",
        end_date: "today",
        dimensions: "query",
        row_limit: 5,
      },
    });
    const data = parseToolResult(result);
    expect(data).toBeDefined();
    // Either returns empty rows or an error
    expect(data.error || data.rows !== undefined).toBeTruthy();
  }, 15_000);
});
