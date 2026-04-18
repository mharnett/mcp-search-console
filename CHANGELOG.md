# Changelog

## [1.1.2] - 2026-04-18

### Added
- **Startup npm outdated check.** At server boot, fires a fire-and-forget
  HTTP request to `registry.npmjs.org/mcp-google-gsc/latest` (2s timeout)
  and logs a stderr notice when a newer version is available. stdout stays
  reserved for MCP JSON-RPC. Silent on network error, timeout, or when
  installed matches registry. Opt out with `MCP_DISABLE_UPDATE_CHECK=1`.

### Fixed
- **Pino logger always writes to stderr.** Previously the destination arg
  was gated on `NODE_ENV === "test"`, which meant production runs left pino
  to its default and could corrupt MCP JSON-RPC on stdout under Claude
  Desktop. Pass `pino.destination(2)` unconditionally.

## [1.0.11] - 2026-04-04

### Security
- Error responses now pass through `safeResponse` to prevent oversized error payloads
- `safeResponse` deep-clones before truncation to avoid mutating original data

## [1.0.7] - 2026-04-09

### Added
- Rewritten from Python to TypeScript
- CLI flags (--help, --version)
- SIGTERM/SIGINT graceful shutdown
- Env var trimming and validation

### Security
- All logging to stderr (stdout reserved for MCP protocol)
- Auth errors not retried (fail fast on 401/403)
