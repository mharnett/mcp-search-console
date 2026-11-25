import { realpathSync } from "fs";
import { fileURLToPath } from "url";

/**
 * True when this module is the script node was started with.
 *
 * npx and npm bins launch the package through node_modules/.bin/<name>, a
 * symlink to the real file, and process.argv[1] keeps the symlink path. Matching
 * on the file name therefore misses it (the server exited 0 without serving).
 * Compare real paths instead: the symlink resolves to the module file, while an
 * importer (a test runner, another script) resolves to a different file.
 */
export function isMainModule(argv1: string | undefined, moduleUrl: string): boolean {
  if (!argv1) return false;
  try {
    return realpathSync(argv1) === realpathSync(fileURLToPath(moduleUrl));
  } catch {
    return false;
  }
}

/**
 * Run the server's main(). A startup error ends the process with code 1, so a
 * supervisor or shell sees a failed start instead of the 0 that logging the
 * error and letting the event loop drain used to give. A main() that returns
 * leaves the exit code alone: closing stdin or SIGTERM later still ends with 0.
 */
export async function runMain(main: () => Promise<void>): Promise<void> {
  try {
    await main();
  } catch (err) {
    console.error("[startup] FATAL:", err);
    process.exit(1);
  }
}
