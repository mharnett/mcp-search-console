import { Tool } from "@modelcontextprotocol/sdk/types.js";

export const tools: Tool[] = [
  {
    name: "gsc_get_client_context",
    description:
      "Get the current GSC client context and health status based on working directory. Call this first to confirm which Search Console property you're working with.",
    inputSchema: {
      additionalProperties: false,
      type: "object",
      properties: {
        working_directory: {
          type: "string",
          description: "The current working directory",
        },
      },
      required: ["working_directory"],
    },
  },
  {
    name: "gsc_list_sites",
    description:
      "List all verified sites/properties in Google Search Console.",
    inputSchema: {
      additionalProperties: false,
      type: "object",
      properties: {},
    },
  },
  {
    name: "gsc_search_analytics",
    description:
      'Query Google Search Console search analytics data. Returns clicks, impressions, CTR, and position for queries, pages, devices, countries, or dates.',
    inputSchema: {
      additionalProperties: false,
      type: "object",
      properties: {
        start_date: {
          type: "string",
          description:
            'Start date (YYYY-MM-DD or relative like "90daysAgo", "30daysAgo", "7daysAgo", "today")',
        },
        end_date: {
          type: "string",
          description: 'End date (YYYY-MM-DD or relative like "today")',
        },
        dimensions: {
          type: "string",
          description:
            "Comma-separated dimensions: query, page, device, country, date",
        },
        search_type: {
          type: "string",
          description: 'Search type: web, image, video, news (default "web")',
        },
        dimension_filter: {
          type: "string",
          description:
            'Optional filter (e.g., "query contains nonprofit", "page contains /blog/", "country equals USA")',
        },
        row_limit: {
          type: "number",
          description: "Max rows to return (default 100, max 25000)",
        },
        aggregation_type: {
          type: "string",
          description:
            'Aggregation: auto, byPage, byProperty (default "auto")',
        },
        site_url: {
          type: "string",
          description:
            "Site URL (optional - auto-detected from working directory config)",
        },
      },
    },
  },
  {
    name: "gsc_inspection",
    description:
      "Inspect a URL to check if it is indexed in Google Search. Returns index status, mobile usability, and rich results data.",
    inputSchema: {
      additionalProperties: false,
      type: "object",
      properties: {
        url: {
          type: "string",
          description:
            'The fully qualified URL to inspect (e.g., "https://www.example.com/blog/post")',
        },
        site_url: {
          type: "string",
          description:
            "Site URL / property (optional - auto-detected from config)",
        },
      },
      required: ["url"],
    },
  },
];
