import assert from "node:assert/strict";
import test from "node:test";
import {
  createRuntimeConfig,
  createRuntimeConfigBody,
  normalizeConnectOrigin,
  validatePagesBuildConfig,
} from "../runtime-config.mjs";

test("normalizes only an exact HTTPS origin", () => {
  assert.equal(normalizeConnectOrigin(undefined), undefined);
  assert.equal(normalizeConnectOrigin("https://server.play.example.com"), "https://server.play.example.com");
  for (const rejected of [
    "http://server.play.example.com",
    "https://server.play.example.com/",
    "https://server.play.example.com/path",
    "https://user:password@server.play.example.com",
    "https://server.play.example.com?query=true",
    "https://server.play.example.com#fragment",
  ]) {
    assert.throws(() => normalizeConnectOrigin(rejected), /exact HTTPS origin/u);
  }
});

test("disables multiplayer when no runtime endpoint is configured", () => {
  assert.deepEqual(createRuntimeConfig(undefined), { multiplayerEnabled: "false" });
});

test("emits a frozen browser assignment for the validated endpoint", () => {
  const endpoint = normalizeConnectOrigin("https://server.play.example.com");
  assert.equal(
    createRuntimeConfigBody(endpoint),
    "globalThis.__VILLAGE_SIEGE_RUNTIME_CONFIG__ = Object.freeze({\"multiplayerEnabled\":\"true\",\"colyseusUrl\":\"https://server.play.example.com\"});\n",
  );
});

test("requires an exact HTTPS Pages endpoint only when multiplayer is enabled", () => {
  assert.deepEqual(validatePagesBuildConfig("false", ""), { enabled: "false", endpoint: undefined });
  assert.deepEqual(
    validatePagesBuildConfig("true", "https://server.play.example.com"),
    { enabled: "true", endpoint: "https://server.play.example.com" },
  );
  assert.throws(() => validatePagesBuildConfig("yes", ""), /must be true or false/u);
  assert.throws(() => validatePagesBuildConfig("true", ""), /is required/u);
  assert.throws(() => validatePagesBuildConfig("true", "http://server.play.example.com"), /exact HTTPS origin/u);
});
