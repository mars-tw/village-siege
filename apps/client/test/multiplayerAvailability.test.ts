import { describe, expect, it } from "vitest";
import { resolveMultiplayerAvailability } from "../src/network/multiplayerAvailability.js";

describe("multiplayer availability", () => {
  it("defaults local development to the local server", () => {
    expect(resolveMultiplayerAvailability({ development: true, endpoint: "http://localhost:2567" })).toEqual({
      enabled: true,
      endpoint: "http://localhost:2567",
    });
  });

  it("keeps production disabled without an explicit verified endpoint", () => {
    expect(resolveMultiplayerAvailability({ development: false })).toEqual({ enabled: false, reason: "disabled" });
    expect(resolveMultiplayerAvailability({ development: false, enabled: "true" }))
      .toEqual({ enabled: false, reason: "missing-endpoint" });
  });

  it("accepts only an exact HTTPS origin in production", () => {
    expect(resolveMultiplayerAvailability({
      development: false,
      enabled: "true",
      endpoint: "https://game.example.com",
    })).toEqual({ enabled: true, endpoint: "https://game.example.com" });
    expect(resolveMultiplayerAvailability({
      development: false,
      enabled: "true",
      endpoint: "http://game.example.com",
    })).toEqual({ enabled: false, reason: "insecure-endpoint" });
    expect(resolveMultiplayerAvailability({
      development: false,
      enabled: "true",
      endpoint: "https://game.example.com/path",
    })).toEqual({ enabled: false, reason: "insecure-endpoint" });
  });
});
