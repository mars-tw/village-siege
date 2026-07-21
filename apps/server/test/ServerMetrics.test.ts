import { describe, expect, it } from "vitest";
import { ServerMetrics } from "../src/observability/serverMetrics.js";

describe("server metrics", () => {
  it("exports bounded unlabeled Prometheus metrics and never underflows gauges", () => {
    const metrics = new ServerMetrics();
    metrics.lobbyClosed();
    metrics.matchPlayerDisconnected();
    metrics.lobbyOpened();
    metrics.lobbyPlayerConnected();
    metrics.matchOpened();
    metrics.matchPlayerConnected();
    metrics.webSocketOriginRejected();
    metrics.recoveryFailStopped();
    const before = process.hrtime.bigint();
    metrics.observeTick(before);
    metrics.observePersistence(before, false);

    const output = metrics.render();
    expect(output).toContain("village_siege_lobby_rooms 1");
    expect(output).toContain("village_siege_match_players_connected 1");
    expect(output).toContain("village_siege_websocket_origin_rejections_total 1");
    expect(output).toContain("village_siege_recovery_fail_stops_total 1");
    expect(output).toContain("village_siege_tick_duration_seconds_count 1");
    expect(output).toContain("village_siege_persistence_failures_total 1");
    expect(output).not.toMatch(/NaN|Infinity|matchId|playerId/);
  });
});
