const NANOSECONDS_PER_SECOND = 1_000_000_000;

export class ServerMetrics {
  private activeLobbies = 0;
  private connectedLobbyPlayers = 0;
  private activeMatches = 0;
  private connectedMatchPlayers = 0;
  private rejectedWebSocketOrigins = 0;
  private recoveryFailStops = 0;
  private tickDurationSecondsSum = 0;
  private tickDurationSecondsCount = 0;
  private persistenceDurationSecondsSum = 0;
  private persistenceDurationSecondsCount = 0;
  private persistenceFailures = 0;

  lobbyOpened(): void { this.activeLobbies += 1; }
  lobbyClosed(): void { this.activeLobbies = decrement(this.activeLobbies); }
  lobbyPlayerConnected(): void { this.connectedLobbyPlayers += 1; }
  lobbyPlayerDisconnected(): void { this.connectedLobbyPlayers = decrement(this.connectedLobbyPlayers); }
  matchOpened(): void { this.activeMatches += 1; }
  matchClosed(): void { this.activeMatches = decrement(this.activeMatches); }
  matchPlayerConnected(): void { this.connectedMatchPlayers += 1; }
  matchPlayerDisconnected(): void { this.connectedMatchPlayers = decrement(this.connectedMatchPlayers); }
  webSocketOriginRejected(): void { this.rejectedWebSocketOrigins += 1; }
  recoveryFailStopped(): void { this.recoveryFailStops += 1; }

  observeTick(startedAtNanoseconds: bigint): void {
    this.tickDurationSecondsSum += elapsedSeconds(startedAtNanoseconds);
    this.tickDurationSecondsCount += 1;
  }

  observePersistence(startedAtNanoseconds: bigint, succeeded: boolean): void {
    this.persistenceDurationSecondsSum += elapsedSeconds(startedAtNanoseconds);
    this.persistenceDurationSecondsCount += 1;
    if (!succeeded) this.persistenceFailures += 1;
  }

  render(): string {
    const memory = process.memoryUsage();
    return [
      "# HELP village_siege_lobby_rooms Active lobby rooms in this process.",
      "# TYPE village_siege_lobby_rooms gauge",
      `village_siege_lobby_rooms ${this.activeLobbies}`,
      "# HELP village_siege_lobby_players_connected Connected lobby players in this process.",
      "# TYPE village_siege_lobby_players_connected gauge",
      `village_siege_lobby_players_connected ${this.connectedLobbyPlayers}`,
      "# HELP village_siege_match_rooms Active authoritative match rooms in this process.",
      "# TYPE village_siege_match_rooms gauge",
      `village_siege_match_rooms ${this.activeMatches}`,
      "# HELP village_siege_match_players_connected Connected authoritative match players in this process.",
      "# TYPE village_siege_match_players_connected gauge",
      `village_siege_match_players_connected ${this.connectedMatchPlayers}`,
      "# HELP village_siege_websocket_origin_rejections_total WebSocket handshakes rejected by browser Origin policy.",
      "# TYPE village_siege_websocket_origin_rejections_total counter",
      `village_siege_websocket_origin_rejections_total ${this.rejectedWebSocketOrigins}`,
      "# HELP village_siege_recovery_fail_stops_total Matches stopped after authoritative recovery failure.",
      "# TYPE village_siege_recovery_fail_stops_total counter",
      `village_siege_recovery_fail_stops_total ${this.recoveryFailStops}`,
      "# HELP village_siege_tick_duration_seconds Authoritative tick duration before frame delivery.",
      "# TYPE village_siege_tick_duration_seconds summary",
      `village_siege_tick_duration_seconds_sum ${finite(this.tickDurationSecondsSum)}`,
      `village_siege_tick_duration_seconds_count ${this.tickDurationSecondsCount}`,
      "# HELP village_siege_persistence_duration_seconds Recovery checkpoint and journal persistence duration.",
      "# TYPE village_siege_persistence_duration_seconds summary",
      `village_siege_persistence_duration_seconds_sum ${finite(this.persistenceDurationSecondsSum)}`,
      `village_siege_persistence_duration_seconds_count ${this.persistenceDurationSecondsCount}`,
      "# HELP village_siege_persistence_failures_total Failed recovery persistence operations.",
      "# TYPE village_siege_persistence_failures_total counter",
      `village_siege_persistence_failures_total ${this.persistenceFailures}`,
      "# HELP process_resident_memory_bytes Resident memory size in bytes.",
      "# TYPE process_resident_memory_bytes gauge",
      `process_resident_memory_bytes ${memory.rss}`,
      "# HELP process_uptime_seconds Process uptime in seconds.",
      "# TYPE process_uptime_seconds gauge",
      `process_uptime_seconds ${finite(process.uptime())}`,
      "",
    ].join("\n");
  }
}

export const serverMetrics = new ServerMetrics();

function elapsedSeconds(startedAtNanoseconds: bigint): number {
  const elapsed = process.hrtime.bigint() - startedAtNanoseconds;
  return Number(elapsed) / NANOSECONDS_PER_SECOND;
}

function decrement(value: number): number {
  return Math.max(0, value - 1);
}

function finite(value: number): number {
  return Number.isFinite(value) && value >= 0 ? value : 0;
}
