import { afterEach, describe, expect, it } from "vitest";
import { matchMaker } from "@colyseus/core";
import {
  configureMatchmakingHttpSecurity,
  isRequestOriginAllowed,
  parseAllowedOrigins,
} from "../src/security/originPolicy.js";

const originalDefaultHeaders = { ...matchMaker.controller.DEFAULT_CORS_HEADERS };
const originalGetCorsHeaders = matchMaker.controller.getCorsHeaders;

afterEach(() => {
  const headers = matchMaker.controller.DEFAULT_CORS_HEADERS as Record<string, string>;
  Object.keys(headers).forEach((key) => delete headers[key]);
  Object.assign(headers, originalDefaultHeaders);
  matchMaker.controller.getCorsHeaders = originalGetCorsHeaders;
});

describe("origin policy", () => {
  it("accepts the public client and explicit self-hosted origins", () => {
    const allowed = parseAllowedOrigins("https://play.example.com,http://localhost:8080");
    expect(allowed).toContain("https://mars-tw.github.io");
    expect(allowed).toContain("https://play.example.com");
    expect(allowed).toContain("http://localhost:8080");
  });

  it("fails fast on schemes and URL components that are not origins", () => {
    expect(() => parseAllowedOrigins("javascript:alert(1)"))
      .toThrow(/only accepts http\/https origins/);
    expect(() => parseAllowedOrigins("https://play.example.com/path"))
      .toThrow(/must be origins/);
  });

  it("allows loopback HTTP only outside production and allows native clients", () => {
    const allowed = new Set(["https://play.example.com"]);
    expect(isRequestOriginAllowed(undefined, { allowedOrigins: allowed, nodeEnv: "production" })).toBe(true);
    expect(isRequestOriginAllowed("http://127.0.0.1:4173", { allowedOrigins: allowed, nodeEnv: "test" })).toBe(true);
    expect(isRequestOriginAllowed("http://127.0.0.1:4173", { allowedOrigins: allowed, nodeEnv: "production" })).toBe(false);
    expect(isRequestOriginAllowed("https://evil.example", { allowedOrigins: allowed, nodeEnv: "production" })).toBe(false);
    expect(isRequestOriginAllowed("not an origin", { allowedOrigins: allowed, nodeEnv: "test" })).toBe(false);
  });

  it("rejects explicitly configured HTTP origins in production", () => {
    const allowed = parseAllowedOrigins("http://play.example.com,https://secure.example.com");
    expect(isRequestOriginAllowed("http://play.example.com", { allowedOrigins: allowed, nodeEnv: "production" })).toBe(false);
    expect(isRequestOriginAllowed("https://secure.example.com", { allowedOrigins: allowed, nodeEnv: "production" })).toBe(true);
  });

  it("uses the process environment when the live WebSocket wiring omits an override", () => {
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      expect(isRequestOriginAllowed("http://localhost:4173", {
        allowedOrigins: new Set(["https://play.example.com"]),
      })).toBe(false);
    } finally {
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
    }
  });

  it("replaces credentialed wildcard CORS with exact-origin security headers", () => {
    configureMatchmakingHttpSecurity(new Set(["https://play.example.com"]), "production");
    const defaults = matchMaker.controller.DEFAULT_CORS_HEADERS as Record<string, string>;
    expect(defaults["Access-Control-Allow-Credentials"]).toBe("true");
    expect(defaults["Access-Control-Allow-Origin"]).not.toBe("*");
    expect(defaults["Access-Control-Allow-Methods"]).toBe("GET,POST,OPTIONS");
    expect(defaults["Content-Security-Policy"]).toContain("frame-ancestors 'none'");
    expect(matchMaker.controller.getCorsHeaders(new Headers({ origin: "https://play.example.com" })))
      .toEqual({ "Access-Control-Allow-Origin": "https://play.example.com" });
    expect(matchMaker.controller.getCorsHeaders(new Headers({ origin: "https://evil.example" })))
      .toEqual({ "Access-Control-Allow-Origin": "https://mars-tw.github.io" });
  });
});
