import { describe, expect, it } from "vitest";
import { resolveRecoveryConfiguration } from "../src/config/productionConfig.js";

describe("production recovery configuration", () => {
  it("allows memory recovery only outside production", () => {
    expect(resolveRecoveryConfiguration({ NODE_ENV: "test" })).toEqual({
      redisUrl: undefined,
      postgresUrl: undefined,
      durable: false,
    });
  });

  it("requires both durable stores together", () => {
    expect(() => resolveRecoveryConfiguration({ NODE_ENV: "test", REDIS_URL: "redis://cache" }))
      .toThrow(/configured together/);
    expect(() => resolveRecoveryConfiguration({ NODE_ENV: "test", DATABASE_URL: "postgres://db" }))
      .toThrow(/configured together/);
  });

  it("fails closed when production has no durable stores", () => {
    expect(() => resolveRecoveryConfiguration({ NODE_ENV: "production" }))
      .toThrow(/memory-only recovery is not allowed/);
  });

  it("accepts a complete production configuration", () => {
    expect(resolveRecoveryConfiguration({
      NODE_ENV: "production",
      REDIS_URL: "redis://cache",
      DATABASE_URL: "postgres://db",
    })).toEqual({ redisUrl: "redis://cache", postgresUrl: "postgres://db", durable: true });
  });
});
