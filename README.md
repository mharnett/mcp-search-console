# mcp-gsc

MCP server for Google Search Console -- search analytics, URL inspection, and site management via Claude.

## Features

- **Search Analytics** -- Query clicks, impressions, CTR, and position with flexible dimension filters (query, page, device, country, date)
- **URL Inspection** -- Check indexing status, mobile usability, and rich results for any URL
- **Site Listing** -- List all verified Search Console properties accessible to your service account
- **Multi-Client Support** -- Manage multiple GSC properties with per-directory config mapping

## Installation

### From npm

```bash
npm install mcp-gsc
```

### From source

```bash
git clone https://github.com/drak-marketing/mcp-gsc.git
cd mcp-gsc
npm install
npm run build
```

## Configuration

### Service Account Setup

1. Create a Google Cloud service account with Search Console API access
2. Download the JSON key file
3. Add the service account email as a user in Google Search Console for each property

### Config File

Create a `config.json` in the project root (see `config.example.json` for the full structure):

```json
{
  "default_credentials": "/path/to/service-account-key.json",
  "clients": {
    "my-project": {
      "site_url": "sc-domain:example.com",
      "credentials": "/path/to/service-account-key.json"
    }
  }
}
```

### Environment Variable

Alternatively, set `GOOGLE_APPLICATION_CREDENTIALS` to the path of your service account key file. The config file takes precedence when present.

## Usage

Add to your Claude Code `.mcp.json`:

```json
{
  "mcpServers": {
    "gsc": {
      "command": "node",
      "args": ["/path/to/mcp-gsc/dist/index.js"]
    }
  }
}
```

Or if installed globally:

```json
{
  "mcpServers": {
    "gsc": {
      "command": "npx",
      "args": ["mcp-gsc"]
    }
  }
}
```

## Tools

| Tool | Description |
|------|-------------|
| `gsc_get_client_context` | Detect the GSC property from your working directory based on config mapping |
| `gsc_list_sites` | List all verified Search Console properties accessible to the service account |
| `gsc_search_analytics` | Query search performance data (clicks, impressions, CTR, position) with dimension and filter support |
| `gsc_inspection` | Inspect a URL for indexing status, mobile usability, and rich results |

### gsc_search_analytics

Supports dimensions: `query`, `page`, `device`, `country`, `date`. Filter by any dimension with operators like `equals`, `contains`, `notContains`. Date range defaults to the last 28 days.

### gsc_inspection

Returns index coverage, crawl status, mobile usability verdict, and rich result details for a specific URL within a property.

## Architecture

- **Resilience** -- Uses cockatiel for retry with exponential backoff and circuit breaker patterns on all Google API calls
- **Logging** -- Structured logging via pino with configurable log levels
- **Response Handling** -- Responses truncated at 200KB to stay within MCP transport limits

## License

MIT -- see [LICENSE](LICENSE).

---

Built by Mark Harnett / [drak-marketing](https://github.com/drak-marketing)
