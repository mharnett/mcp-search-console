// ============================================
// CROSS-PLATFORM DISPATCH HELPERS
// ============================================

import envPaths from "env-paths";
import openModule from "open";
import { createServer } from "net";
import { platform } from "os";
import path from "path";

const paths = envPaths("mcp-gsc", { suffix: "nodejs" });

export const configDir = paths.config;
export const credentialsFilePath = path.join(paths.config, "credentials.json");

export async function openBrowser(url: string): Promise<void> {
  await openModule(url);
}

const LOOPBACK_PORT_RANGE_START = 8085;
const LOOPBACK_PORT_RANGE_END = 8199;

export async function findFreeLoopbackPort(): Promise<number> {
  for (let port = LOOPBACK_PORT_RANGE_START; port <= LOOPBACK_PORT_RANGE_END; port++) {
    if (await isPortFree(port)) {
      return port;
    }
  }
  throw new Error(
    `No free port found in range ${LOOPBACK_PORT_RANGE_START}-${LOOPBACK_PORT_RANGE_END}. ` +
      `Close other apps that might be listening and try again.`,
  );
}

function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, "127.0.0.1");
  });
}

export function currentPlatform(): "darwin" | "win32" | "linux" | "other" {
  const p = platform();
  if (p === "darwin" || p === "win32" || p === "linux") return p;
  return "other";
}

export function onPosixSignal(
  signal: "SIGPIPE" | "SIGHUP" | "SIGUSR1" | "SIGUSR2" | "SIGQUIT",
  handler: () => void,
): void {
  if (platform() === "win32") return;
  process.on(signal as NodeJS.Signals, handler);
}
