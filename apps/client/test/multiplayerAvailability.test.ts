import { describe, expect, it } from "vitest";
import {
  readVillageSiegeRuntimeConfig,
  resolveConfiguredMultiplayerAvailability,
  resolveMultiplayerAvailability,
} from "../src/network/multiplayerAvailability.js";

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

  it("reads only typed deployment-time fields from the runtime global", () => {
    const runtimeConfig = Object.freeze({
      multiplayerEnabled: "true",
      colyseusUrl: "https://server.play.example.com",
    });
    expect(readVillageSiegeRuntimeConfig({
      __VILLAGE_SIEGE_RUNTIME_CONFIG__: runtimeConfig,
    })).toEqual(runtimeConfig);
    expect(readVillageSiegeRuntimeConfig({
      __VILLAGE_SIEGE_RUNTIME_CONFIG__: null,
    })).toEqual({});
    expect(readVillageSiegeRuntimeConfig({
      __VILLAGE_SIEGE_RUNTIME_CONFIG__: {
        multiplayerEnabled: true,
        colyseusUrl: 2567,
      },
    })).toEqual({});
  });

  it("lets a verified runtime endpoint enable a domain-agnostic production build", () => {
    expect(resolveConfiguredMultiplayerAvailability({
      runtime: {
        multiplayerEnabled: "true",
        colyseusUrl: "https://server.play.example.com",
      },
      build: { enabled: "false" },
      development: false,
    })).toEqual({
      enabled: true,
      endpoint: "https://server.play.example.com",
    });
  });

  it("falls back to build configuration only when runtime fields are absent", () => {
    expect(resolveConfiguredMultiplayerAvailability({
      runtime: {},
      build: {
        enabled: "true",
        endpoint: "https://build.example.com",
      },
      development: false,
    })).toEqual({
      enabled: true,
      endpoint: "https://build.example.com",
    });
  });

  it("fails closed instead of falling back from an insecure runtime endpoint", () => {
    expect(resolveConfiguredMultiplayerAvailability({
      runtime: {
        multiplayerEnabled: "true",
        colyseusUrl: "http://attacker.example.com",
      },
      build: {
        enabled: "true",
        endpoint: "https://build.example.com",
      },
      development: false,
    })).toEqual({ enabled: false, reason: "insecure-endpoint" });
  });
});
