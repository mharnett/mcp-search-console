// ============================================
// TYPED ERRORS
// ============================================

export class GscAuthError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "GscAuthError";
  }
}

export class GscRateLimitError extends Error {
  constructor(
    public readonly retryAfterMs: number,
    cause?: unknown,
  ) {
    super(`GSC rate limited, retry after ${retryAfterMs}ms`);
    this.name = "GscRateLimitError";
    this.cause = cause;
  }
}

export class GscServiceError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "GscServiceError";
  }
}

// ============================================
// STARTUP CREDENTIAL VALIDATION
// ============================================

export function validateCredentials(credentialsFile: string): { valid: boolean; missing: string[] } {
  const missing: string[] = [];

  if (!credentialsFile || credentialsFile.trim() === "") {
    missing.push("credentials_file (in config.json or GOOGLE_APPLICATION_CREDENTIALS env var)");
  }

  return { valid: missing.length === 0, missing };
}

export function classifyError(error: any): Error {
  const message = error?.message || String(error);
  const status = error?.code || error?.status;

  if (
    status === 401 ||
    status === 403 ||
    message.includes("invalid_grant") ||
    message.includes("PERMISSION_DENIED") ||
    message.includes("access_denied") ||
    message.includes("Invalid credentials")
  ) {
    return new GscAuthError(
      `GSC auth failed: ${message}. Check service account credentials and permissions.`,
      error,
    );
  }

  if (status === 429 || message.includes("rateLimitExceeded") || message.includes("RESOURCE_EXHAUSTED")) {
    const retryMs = 60_000;
    return new GscRateLimitError(retryMs, error);
  }

  if (status >= 500 || message.includes("INTERNAL") || message.includes("UNAVAILABLE")) {
    return new GscServiceError(`GSC API server error: ${message}`, error);
  }

  return error;
}
