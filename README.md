# mcp-google-gsc

MCP server for Google Search Console -- search analytics, URL inspection, and site management via Claude.

## Features

- **Search Analytics** -- Query clicks, impressions, CTR, and position with flexible dimension filters (query, page, device, country, date)
- **URL Inspection** -- Check indexing status, mobile usability, and rich results for any URL
- **Site Listing** -- List all verified Search Console properties accessible to your authenticated account (OAuth user or service account)
- **Multi-Client Support** -- Manage multiple GSC properties with per-directory config mapping

## Installation

### From npm

```bash
npm install mcp-google-gsc
```

### From source

```bash
git clone https://github.com/mharnett/mcp-search-console.git
cd mcp-google-gsc
npm install
npm run build
```

## Configuration

**Security:** Never share your `.mcp.json` file or commit it to git -- it may contain API credentials. Add `.mcp.json` to your `.gitignore`.

mcp-gsc supports **two authentication modes**. Pick whichever fits your setup. Neither requires any file living at a hardcoded machine-local path -- credentials come from environment variables (or a `config.json` you create).

**Which mode to use:**
- **Service Account (Mode B) -- recommended for unattended / server / headless use.** A service account has no interactive login to expire or re-consent, so it is the right fit for always-on deployments. The one setup requirement is that the service account's email must be **granted access on each Search Console property** you want to query (see Mode B).
- **User OAuth (Mode A) -- for personal / interactive use**, where you want to authorize with your own Google login.

**Precedence when both are configured:** if a service-account keyfile is explicitly set (`GOOGLE_APPLICATION_CREDENTIALS`, or `credentials_file` in `config.json`), it **wins** over any OAuth refresh token or stored OAuth credentials. If neither is configured, the server fails loudly at startup with an onboarding message rather than silently guessing -- there is no machine-local default and no silent runtime failover between modes.

### Mode A: User OAuth (bring your own Google account)

Use this if you want to authorize with your own Google login (the account that has Search Console access). Best for personal / interactive use.

1. In the Google Cloud Console, create an **OAuth 2.0 Client ID** of type **Desktop app** and enable the **Search Console API**. (For a Desktop-app client, Google accepts any `http://localhost` loopback redirect -- you do not need to pre-register a port.)
2. Export your client credentials:
   ```bash
   export GOOGLE_GSC_CLIENT_ID=...apps.googleusercontent.com
   export GOOGLE_GSC_CLIENT_SECRET=...
   ```
3. Mint a refresh token (opens your browser, uses PKCE + `access_type=offline`):
   ```bash
   node get-refresh-token.cjs
   ```
   > Do **not** redirect this command's stdout to a shared log -- it prints the refresh token to stdout by design.
4. Copy the printed line into your environment:
   ```bash
   export GOOGLE_GSC_REFRESH_TOKEN=...
   ```

The server reads `GOOGLE_GSC_CLIENT_ID`, `GOOGLE_GSC_CLIENT_SECRET`, and `GOOGLE_GSC_REFRESH_TOKEN` from the environment at runtime.

Alternatively, run the guided helper `npx mcp-gsc-auth`, which performs the same PKCE OAuth flow, lets you pick a default Search Console property, and writes the result to a per-user credentials file.

### Mode B: Service Account (recommended for unattended / server use)

Use this for server / headless / always-on contexts -- it is the recommended path when no human is present to complete or refresh an interactive login.

1. Create a Google Cloud **service account** with Search Console API access and download its JSON key file.
2. **Grant the service account's email access on each Search Console property** you want to query (add it as a user in Search Console). Without this grant on the property, the service account can authenticate but will see no sites.
3. Point the server at the key file **via an environment variable** (no hardcoded path):
   ```bash
   export GOOGLE_APPLICATION_CREDENTIALS=/path/to/your/service-account-key.json
   ```

### OAuth scope

Both modes request a single, **read-only** scope: `https://www.googleapis.com/auth/webmasters.readonly`. All four tools are reads -- nothing writes -- so the server never asks for read/write access.

The scope is defined once in `config.json` under `oauth.scope` (see `config.example.json`). The OAuth helper and the runtime read the same value, so they never drift. If `config.json` is absent (e.g. a fresh install), the committed read-only default is used.

### Multi-client config (optional)

To map working directories to Search Console properties, create a `config.json` in the project root (see `config.example.json`):

```json
{
  "oauth": {
    "scope": "https://www.googleapis.com/auth/webmasters.readonly"
  },
  "clients": {
    "my-project": {
      "name": "My Project",
      "folder": "/path/to/project",
      "site_url": "https://example.com/"
    }
  }
}
```

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
      "args": ["mcp-google-gsc"]
    }
  }
}
```

**Claude Desktop:** Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows).

## Tools

| Tool | Description |
|------|-------------|
| `gsc_get_client_context` | Detect the GSC property from your working directory based on config mapping |
| `gsc_list_sites` | List all verified Search Console properties accessible to the authenticated account |
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
