# Changelog

## [1.2.1](https://github.com/mharnett/mcp-search-console/compare/mcp-google-gsc-v1.2.0...mcp-google-gsc-v1.2.1) (2026-07-13)


### Bug Fixes

* **gsc:** guard that per-client launchers pin their own refresh token ([3d05cd5](https://github.com/mharnett/mcp-search-console/commit/3d05cd5c3d3d0dbacef352e84237067186a46bcd))
* **gsc:** guard that per-client launchers pin their own refresh token ([22379f3](https://github.com/mharnett/mcp-search-console/commit/22379f3bc5e05755d8f385d1526612df9257bfdb))

## [1.2.0](https://github.com/mharnett/mcp-search-console/compare/mcp-google-gsc-v1.1.4...mcp-google-gsc-v1.2.0) (2026-07-09)


### Features

* **oauth:** publishable PKCE + dual OAuth/service-account decouple ([#8](https://github.com/mharnett/mcp-search-console/issues/8)) ([b8c11a1](https://github.com/mharnett/mcp-search-console/commit/b8c11a1da65926aa90ff1998e06d67be1378fb78))
* per-config oauth_credentials_file for multi-account OAuth ([f4911ce](https://github.com/mharnett/mcp-search-console/commit/f4911cee51ca0a670e8bc32179bf7c88c53fc44d))


### Bug Fixes

* add --repo flag to gh issue/label commands to avoid git context requirement ([f02dde7](https://github.com/mharnett/mcp-search-console/commit/f02dde77fdc538ee2ef59adfbc82c61da1b91a7f))
* budget validation, GAQL mutation blocking, future date checks, limit caps ([c08a06d](https://github.com/mharnett/mcp-search-console/commit/c08a06d272bcec32ddaf5d3813041c0e333efbb3))
* **ci:** registry lockfile + row_count sync + remove orphan updateNotifier.test.ts ([#6](https://github.com/mharnett/mcp-search-console/issues/6)) ([730a96c](https://github.com/mharnett/mcp-search-console/commit/730a96c2e5b3fd3d7dfc79d9124fd9bfe310adbd))
* config.json no longer required when using env vars ([def225f](https://github.com/mharnett/mcp-search-console/commit/def225fd33d46a7b576aaf487e6034520e841b45))
* **critical:** use TimeoutStrategy.Aggressive to actually abort hung requests ([0eea145](https://github.com/mharnett/mcp-search-console/commit/0eea145ab6f53535174fe0284a78afc3111fc790))
* error server prefix, isError consistency, validateCredentials, CHANGELOG ([c843cfd](https://github.com/mharnett/mcp-search-console/commit/c843cfde3a564e649a26733f51a9de9f416fa678))
* error size limits, safeResponse mutation, CHANGELOG, security warnings ([948edf8](https://github.com/mharnett/mcp-search-console/commit/948edf88d23710a634e08560dcb781ef541a9294))
* ID validation, path resolution, health tools, descriptions ([76f8c77](https://github.com/mharnett/mcp-search-console/commit/76f8c77d62badce3513b601421eb3e9e9de0a25a))
* move mcp-test-harness checkout inside workspace root ([#2](https://github.com/mharnett/mcp-search-console/issues/2)) ([748a635](https://github.com/mharnett/mcp-search-console/commit/748a63517a27deb6e9c32a68e01c4ddb636af8fc))
* Node 18.18 minimum, env var trimming, unhandledRejection, TTY guard ([d63517a](https://github.com/mharnett/mcp-search-console/commit/d63517af79172cfc25fffe2d6b7e833a851bc9a6))
* README accuracy, env var docs, dependency cleanup ([9c16844](https://github.com/mharnett/mcp-search-console/commit/9c168443054545d178ea58d1c609d74c4cacfe6c))
* **resilience:** tie row_count update to the rows key, not any array sibling ([#7](https://github.com/mharnett/mcp-search-console/issues/7)) ([9d90d48](https://github.com/mharnett/mcp-search-console/commit/9d90d48b58d8188320737b21d60f8e7943098043))
* resolve import and export issues from cascade failure ([518a600](https://github.com/mharnett/mcp-search-console/commit/518a600ae86e53190dc77800f2ffdbd382324c2a))
* startup checks, credential redaction, schema hardening, format validation ([c2df62e](https://github.com/mharnett/mcp-search-console/commit/c2df62ef1edacaa5941fae8d4b11de31d3dbef00))
* stderr logging, Linux/Docker compat, SIGPIPE, version fallback ([e0ddd4b](https://github.com/mharnett/mcp-search-console/commit/e0ddd4bf8d0394bfab0ff82ca560616b59400a16))
* version field, safeResponse loop, auth retry, SIGTERM handling ([0a7079a](https://github.com/mharnett/mcp-search-console/commit/0a7079afde68b00060899d2389955a739c1a2941))

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
