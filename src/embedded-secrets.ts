// ============================================
// BUILD-TIME INJECTED SECRETS
// ============================================
// Replaced by esbuild --define at build time. In dev mode (tsx),
// falls back to runtime env vars via credentials.ts.
//
// GSC only needs client_id + client_secret (no developer token).
// Google Desktop OAuth client ID/secret are NOT true secrets per Google docs.

export const EMBEDDED_CLIENT_ID: string = process.env.EMBEDDED_CLIENT_ID || "";
export const EMBEDDED_CLIENT_SECRET: string = process.env.EMBEDDED_CLIENT_SECRET || "";

export function hasEmbeddedSecrets(): boolean {
  return EMBEDDED_CLIENT_ID.length > 10 && EMBEDDED_CLIENT_SECRET.length > 10;
}
