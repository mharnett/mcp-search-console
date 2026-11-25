/**
 * The server's exit code says whether it started.
 *
 * A fatal startup error (no credentials, a key path the credential check
 * refuses, a config.json that doesn't parse) used to be logged and swallowed, so the
 * process ended with code 0 and a supervisor, a shell `&&` or a health check
 * read the failed start as a clean one. It now ends non-zero. A clean end (the
 * client closes stdin, or SIGTERM) stays 0.
 *
 * Each case launches the built server (dist/index.js) the way an MCP host
 * does: a child process with piped stdio. Importing src/index.ts never runs
 * main(), so only a spawned server has an exit code to check.
 *
 * Containment: the child gets a fixed env, not this process's: a throwaway
 * HOME, a config path inside it (so a config.json beside dist/ is never
 * read), fake OAuth values, and MCP_DISABLE_UPDATE_CHECK=1 (no npm registry
 * check). A preload refuses every socket connection, DNS lookup and fetch and
 * writes a "[no-network]" line for each, so the startup auth check of a server
 * that does start goes nowhere.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST_INDEX = path.join(REPO_ROOT, "dist", "index.js");
const DEADLINE_MS = 15_000;

const NO_NETWORK = `
import dns from "node:dns";
import net from "node:net";
const refusal = (what) => {
  process.stderr.write("[no-network] refused " + what + "\\n");
  return Object.assign(new Error("network is disabled in this test (" + what + ")"), { code: "ECONNREFUSED" });
};
net.Socket.prototype.connect = function () {
  const err = refusal("socket connect");
  process.nextTick(() => this.destroy(err));
  return this;
};
dns.lookup = (...args) => {
  const err = refusal("dns lookup");
  process.nextTick(args[args.length - 1], err);
};
dns.promises.lookup = async () => { throw refusal("dns lookup"); };
globalThis.fetch = async () => { throw refusal("fetch"); };
`;

const FAKE_OAUTH = {
  GOOGLE_GSC_CLIENT_ID: "fake-gsc-client-id",
  GOOGLE_GSC_CLIENT_SECRET: "fake-gsc-client-secret",
  GOOGLE_GSC_REFRESH_TOKEN: "fake-gsc-refresh-token",
};

interface Exit {
  code: number | null;
  signal: NodeJS.Signals | null;
}

interface RunningServer {
  proc: ChildProcess;
  stdout(): string;
  stderr(): string;
  /** Resolves when the process has ended and its pipes are drained. */
  ended(): Promise<Exit>;
  /** Resolves once the server has answered `initialize`. */
  initialized(): Promise<void>;
}

let home: string;
const running: RunningServer[] = [];

beforeEach(() => {
  home = mkdtempSync(path.join(tmpdir(), "mcp-gsc-exit-"));
});

afterEach(async () => {
  for (const server of running.splice(0)) {
    if (server.proc.exitCode === null && server.proc.signalCode === null) {
      server.proc.kill("SIGKILL");
      await server.ended();
    }
  }
  rmSync(home, { recursive: true, force: true });
});

function withDeadline<T>(promise: Promise<T>, what: string, stderr: () => string): Promise<T> {
  let timer: NodeJS.Timeout;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} did not happen within ${DEADLINE_MS}ms\nstderr:\n${stderr()}`)), DEADLINE_MS);
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

function startServer(env: Record<string, string> = {}): RunningServer {
  if (!existsSync(DIST_INDEX)) {
    throw new Error(`${DIST_INDEX} is missing: run \`npm test\`, which builds first`);
  }
  const preload = path.join(home, "no-network.mjs");
  writeFileSync(preload, NO_NETWORK);

  const childEnv: Record<string, string> = {};
  // process.env lookups are case-insensitive on Windows, so these two cover it.
  for (const key of ["PATH", "SystemRoot"]) {
    if (process.env[key]) childEnv[key] = process.env[key]!;
  }
  Object.assign(childEnv, {
    HOME: home,
    USERPROFILE: home,
    XDG_CONFIG_HOME: path.join(home, ".config"),
    MCP_GSC_CONFIG_PATH: path.join(home, "no-such-config.json"),
    MCP_DISABLE_UPDATE_CHECK: "1",
    ...env,
  });

  const proc = spawn(process.execPath, ["--import", pathToFileURL(preload).href, DIST_INDEX], {
    cwd: REPO_ROOT,
    env: childEnv,
    stdio: ["pipe", "pipe", "pipe"],
  });
  // A write after the server has exited raises EPIPE here; the exit is what
  // the test reports, so don't let the pipe error crash the run.
  proc.stdin!.on("error", () => {});

  let out = "";
  let err = "";
  proc.stdout!.setEncoding("utf8").on("data", (chunk: string) => {
    out += chunk;
  });
  proc.stderr!.setEncoding("utf8").on("data", (chunk: string) => {
    err += chunk;
  });
  const closed = new Promise<Exit>((resolve) => {
    proc.on("close", (code, signal) => resolve({ code, signal }));
  });

  const server: RunningServer = {
    proc,
    stdout: () => out,
    stderr: () => err,
    ended: () => withDeadline(closed, "server exit", () => err),
    initialized: () =>
      withDeadline(
        new Promise<void>((resolve, reject) => {
          const check = () => {
            if (out.split("\n").some((line) => line.includes('"id":1') && line.includes('"serverInfo"'))) resolve();
          };
          proc.stdout!.on("data", check);
          void closed.then(({ code }) => reject(new Error(`server exited (code ${code}) before answering\nstderr:\n${err}`)));
          proc.stdin!.write(
            JSON.stringify({
              jsonrpc: "2.0",
              id: 1,
              method: "initialize",
              params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "exit-test", version: "0.0.0" } },
            }) + "\n",
          );
        }),
        "initialize reply",
        () => err,
      ),
  };
  running.push(server);
  return server;
}

describe("a fatal startup error ends the process with a non-zero code", () => {
  async function expectFatal(server: RunningServer, why: RegExp) {
    const { code, signal } = await server.ended();
    expect(signal, server.stderr()).toBeNull();
    expect(code, server.stderr()).toBe(1);
    expect(server.stderr()).toMatch(why);
    expect(server.stderr()).not.toContain("[startup] MCP GSC server running");
    expect(server.stdout()).toBe("");
    expect(server.stderr()).not.toContain("[no-network]");
  }

  it("no credentials configured", async () => {
    await expectFatal(startServer(), /No GSC credentials configured/);
  }, 30_000);

  it("a service-account key path the credential check refuses", async () => {
    await expectFatal(startServer({ GOOGLE_APPLICATION_CREDENTIALS: "/x" }), /Missing required credentials/);
  }, 30_000);

  it("a config file that is not JSON", async () => {
    const config = path.join(home, "config.json");
    writeFileSync(config, "{ not json");
    await expectFatal(startServer({ MCP_GSC_CONFIG_PATH: config, ...FAKE_OAUTH }), /SyntaxError|JSON/);
  }, 30_000);
});

describe("a clean end stays 0", () => {
  async function serving(): Promise<RunningServer> {
    const server = startServer(FAKE_OAUTH);
    await server.initialized();
    expect(server.proc.exitCode, server.stderr()).toBeNull();
    return server;
  }

  it("the client closes stdin", async () => {
    const server = await serving();
    server.proc.stdin!.end();
    expect(await server.ended(), server.stderr()).toEqual({ code: 0, signal: null });
  }, 45_000);

  // Windows has no SIGTERM: kill() ends the process without running a handler.
  it.skipIf(process.platform === "win32")("SIGTERM", async () => {
    const server = await serving();
    server.proc.kill("SIGTERM");
    expect(await server.ended(), server.stderr()).toEqual({ code: 0, signal: null });
    expect(server.stderr()).toContain("[shutdown] SIGTERM received");
  }, 45_000);
});
