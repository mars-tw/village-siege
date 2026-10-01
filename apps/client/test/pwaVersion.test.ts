import { describe, expect, it } from "vitest";
import { offlineStateMatchesVersion } from "../src/game/installPwa";

describe("offline release readiness", () => {
  it("does not report an old worker's hash-only cache as the new release", () => {
    expect(offlineStateMatchesVersion({ type: "VILLAGE_SIEGE_OFFLINE_STATE", ready: true, version: "old-build-hash" }, "0.21.1")).toBe(false);
  });
  it("rejects a complete cache for an earlier app release", () => {
    expect(offlineStateMatchesVersion({ type: "VILLAGE_SIEGE_OFFLINE_STATE", ready: true, appVersion: "0.21.0" }, "0.21.1")).toBe(false);
  });
  it("requires a complete cache and the matching current app version", () => {
    expect(offlineStateMatchesVersion({ type: "VILLAGE_SIEGE_OFFLINE_STATE", ready: false, appVersion: "0.21.1" }, "0.21.1")).toBe(false);
    expect(offlineStateMatchesVersion({ type: "VILLAGE_SIEGE_OFFLINE_STATE", ready: true, appVersion: "0.21.1" }, "0.21.1")).toBe(true);
  });
  it("ignores unrelated or malformed worker messages", () => {
    expect(offlineStateMatchesVersion({ ready: true, appVersion: "0.21.1" }, "0.21.1")).toBe(false);
    expect(offlineStateMatchesVersion(undefined, "0.21.1")).toBe(false);
  });
});
