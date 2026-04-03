import { describe, it, expect } from "vitest";
import {
  GscAuthError,
  GscRateLimitError,
  GscServiceError,
  classifyError,
  validateCredentials,
} from "./errors.js";

describe("validateCredentials", () => {
  it("passes with valid credentials file path", () => {
    const result = validateCredentials("/path/to/creds.json");
    expect(result.valid).toBe(true);
    expect(result.missing).toHaveLength(0);
  });

  it("fails with empty credentials file", () => {
    const result = validateCredentials("");
    expect(result.valid).toBe(false);
    expect(result.missing).toHaveLength(1);
  });

  it("fails with whitespace-only credentials file", () => {
    const result = validateCredentials("   ");
    expect(result.valid).toBe(false);
    expect(result.missing).toHaveLength(1);
  });
});

describe("classifyError", () => {
  it("classifies 401 as auth error", () => {
    const error = classifyError({ message: "Unauthorized", code: 401 });
    expect(error).toBeInstanceOf(GscAuthError);
  });

  it("classifies 403 as auth error", () => {
    const error = classifyError({ message: "Forbidden", code: 403 });
    expect(error).toBeInstanceOf(GscAuthError);
  });

  it("classifies PERMISSION_DENIED as auth error", () => {
    const error = classifyError(new Error("PERMISSION_DENIED: caller lacks access"));
    expect(error).toBeInstanceOf(GscAuthError);
  });

  it("classifies invalid_grant as auth error", () => {
    const error = classifyError(new Error("invalid_grant: token expired"));
    expect(error).toBeInstanceOf(GscAuthError);
  });

  it("classifies 429 as rate limit error", () => {
    const error = classifyError({ message: "Too many requests", code: 429 });
    expect(error).toBeInstanceOf(GscRateLimitError);
    expect((error as GscRateLimitError).retryAfterMs).toBe(60_000);
  });

  it("classifies rateLimitExceeded as rate limit error", () => {
    const error = classifyError(new Error("rateLimitExceeded"));
    expect(error).toBeInstanceOf(GscRateLimitError);
  });

  it("classifies 500 as service error", () => {
    const error = classifyError({ message: "Internal error", code: 500 });
    expect(error).toBeInstanceOf(GscServiceError);
  });

  it("classifies 503 as service error", () => {
    const error = classifyError({ message: "Service unavailable", code: 503 });
    expect(error).toBeInstanceOf(GscServiceError);
  });

  it("returns original error for unrecognized errors", () => {
    const original = new Error("Something weird happened");
    const result = classifyError(original);
    expect(result).toBe(original);
  });

  it("handles string errors", () => {
    const result = classifyError("some string error");
    expect(result).toBe("some string error");
  });
});
