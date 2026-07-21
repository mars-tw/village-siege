import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { APPLICATION_VERSION, readinessDocument, versionDocument } from "../src/http/serviceStatus.js";

describe("service status documents", () => {
  it("keeps the published application version aligned with the server package", () => {
    const packageDocument = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
    expect(APPLICATION_VERSION).toBe(packageDocument.version);
  });

  it("publishes only bounded compatibility metadata", () => {
    expect(versionDocument({ GIT_COMMIT_SHA: "abc1234" })).toEqual({
      name: "village-siege-server",
      version: APPLICATION_VERSION,
      protocolVersion: "village-siege-network/4",
      rulesVersion: "village-siege/0.17.0",
      commit: "abc1234",
    });
    expect(versionDocument({ GIT_COMMIT_SHA: "not a commit; secret" }).commit).toBe("unknown");
  });

  it("distinguishes ready, draining and dependency failure without leaking errors", async () => {
    await expect(readinessDocument({ isDraining: () => false, checkDependencies: vi.fn() }))
      .resolves.toEqual({ statusCode: 200, body: { status: "ready" } });
    await expect(readinessDocument({ isDraining: () => true, checkDependencies: vi.fn() }))
      .resolves.toEqual({ statusCode: 503, body: { status: "draining" } });
    await expect(readinessDocument({
      isDraining: () => false,
      checkDependencies: vi.fn().mockRejectedValue(new Error("postgres secret")),
    })).resolves.toEqual({ statusCode: 503, body: { status: "unavailable" } });
  });
});
