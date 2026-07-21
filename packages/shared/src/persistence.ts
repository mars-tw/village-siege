import {
  VILLAGE_ASSAULT_MAP_HEIGHT,
  VILLAGE_ASSAULT_MAP_ID,
  VILLAGE_ASSAULT_MAP_WIDTH,
  isVillageAssaultLayoutId,
} from "./battlefield.js";
import {
  COMBAT_UNITS,
  FACING_DIRECTIONS,
  MONSTERS,
  MONSTER_BOONS,
  PROJECTILE_PROFILES,
  STATUS_EFFECTS,
} from "./combat.js";
import {
  BUILDINGS,
  getBuildingFootprint,
  MAX_TRAINING_QUEUE_DEPTH,
  RESOURCE_NODES,
  RULES_VERSION,
  SETTLEMENT_TIERS,
  TECHNOLOGIES,
  TICK_MILLISECONDS,
  UNITS,
  VILLAGE_IDS,
} from "./content.js";
import { isCommandEnvelope, type AiAuthorityState, type CommandEnvelope, type DomainEvent } from "./protocol.js";
import { applyCommand, cloneMatchState, hashMatchState, stepSimulation, toVisibleSnapshot, type MatchState } from "./simulation.js";

export const MATCH_PERSISTENCE_SCHEMA_VERSION = 1 as const;
export const MATCH_PERSISTENCE_PROTOCOL_VERSION = "village-siege-persistence/1" as const;
export const MATCH_SAVE_MAX_BYTES = 2 * 1024 * 1024;
export const MATCH_JOURNAL_MAX_BYTES = 4 * 1024 * 1024;
export const MATCH_REPLAY_MAX_BYTES = 4 * 1024 * 1024;
export const MATCH_PERSISTENCE_MAX_DEPTH = 64;
export const MATCH_PERSISTENCE_MAX_NODES = 250_000;
export const MATCH_PERSISTENCE_MAX_STRING_LENGTH = 256 * 1024;
export const MATCH_JOURNAL_MAX_OPERATIONS = 100_000;
export const MATCH_PERSISTENCE_MAX_TICK = 10_000_000;
const MATCH_PERSISTENCE_MAX_MAP_DIMENSION = 256;
const MATCH_PERSISTENCE_MAX_MAP_TILES = 65_536;

export type MatchPersistenceVisibility = "authoritative-private";
export type MatchCommandSource = "human" | "ai";
export type MatchAiAuthorityCommitCause = "commandless" | "accepted-command";

export type MatchPersistenceErrorCode =
  | "PAYLOAD_TOO_LARGE"
  | "INVALID_JSON"
  | "INVALID_SCHEMA"
  | "UNSUPPORTED_SCHEMA_VERSION"
  | "UNSUPPORTED_PROTOCOL_VERSION"
  | "UNSUPPORTED_RULES_VERSION"
  | "VISIBILITY_MISMATCH"
  | "MATCH_MISMATCH"
  | "TICK_MISMATCH"
  | "HASH_MISMATCH"
  | "JOURNAL_ORDER_INVALID"
  | "COMMAND_REJECTED"
  | "AI_AUTHORITY_INVALID";

export class MatchPersistenceError extends Error {
  readonly code: MatchPersistenceErrorCode;

  constructor(code: MatchPersistenceErrorCode, message: string) {
    super(message);
    this.name = "MatchPersistenceError";
    this.code = code;
  }
}

export interface MatchRuntimeSaveMetadata {
  readonly humanPlayerId: string;
  readonly nextPlayerSequence: number;
  readonly accumulatorMs: number;
  readonly aiBudgetMs: number;
}

export interface MatchStateSnapshot {
  readonly tick: number;
  readonly hash: string;
  readonly state: MatchState;
}

interface MatchPersistenceHeader {
  readonly schemaVersion: typeof MATCH_PERSISTENCE_SCHEMA_VERSION;
  readonly protocolVersion: typeof MATCH_PERSISTENCE_PROTOCOL_VERSION;
  readonly rulesVersion: typeof RULES_VERSION;
  readonly visibility: MatchPersistenceVisibility;
}

export interface MatchSaveFile extends MatchPersistenceHeader {
  readonly kind: "match-save";
  readonly snapshot: MatchStateSnapshot;
  readonly runtime: MatchRuntimeSaveMetadata;
  readonly continuationHash: string;
}

export interface MatchAcceptedCommandOperation {
  readonly kind: "accepted-command";
  readonly order: number;
  readonly tick: number;
  readonly source: MatchCommandSource;
  readonly envelope: CommandEnvelope;
  readonly preHash: string;
  readonly postHash: string;
}

export interface MatchAiAuthorityCommitOperation {
  readonly kind: "ai-authority-commit";
  readonly order: number;
  readonly tick: number;
  readonly playerId: string;
  readonly cause: MatchAiAuthorityCommitCause;
  readonly acceptedCommandSequences: readonly number[];
  readonly authority: AiAuthorityState;
  readonly preHash: string;
  readonly postHash: string;
}

export interface MatchAdvanceOperation {
  readonly kind: "advance";
  readonly order: number;
  readonly fromTick: number;
  readonly toTick: number;
  readonly preHash: string;
  readonly postHash: string;
}

export type MatchJournalOperation =
  | MatchAcceptedCommandOperation
  | MatchAiAuthorityCommitOperation
  | MatchAdvanceOperation;

export interface MatchCommandJournalFile extends MatchPersistenceHeader {
  readonly kind: "match-command-journal";
  readonly matchId: string;
  readonly baseTick: number;
  readonly baseHash: string;
  readonly operations: readonly MatchJournalOperation[];
  readonly finalTick: number;
  readonly finalHash: string;
}

export interface MatchReplayFile extends MatchPersistenceHeader {
  readonly kind: "match-replay";
  readonly save: MatchSaveFile;
  readonly journal: MatchCommandJournalFile;
  readonly runtime: MatchRuntimeSaveMetadata;
  readonly finalTick: number;
  readonly finalHash: string;
  readonly continuationHash: string;
}

export interface MatchJournalMutationResult {
  readonly journal: MatchCommandJournalFile;
  readonly state: MatchState;
  readonly events: readonly DomainEvent[];
}

export interface MatchJournalReplayResult {
  readonly state: MatchState;
  readonly events: readonly DomainEvent[];
}

export interface MatchReplayResult extends MatchJournalReplayResult {
  readonly runtime: MatchRuntimeSaveMetadata;
}

const HEADER = {
  schemaVersion: MATCH_PERSISTENCE_SCHEMA_VERSION,
  protocolVersion: MATCH_PERSISTENCE_PROTOCOL_VERSION,
  rulesVersion: RULES_VERSION,
  visibility: "authoritative-private",
} as const satisfies MatchPersistenceHeader;

// Recorder-created values have already crossed the complete structural and
// simulation smoke gate. Remembering their identity keeps long authoritative
// recordings linear while parsed/untrusted journals still receive full checks.
const TRUSTED_JOURNALS = new WeakSet<object>();
const TRUSTED_STATES = new WeakSet<object>();
const TRUSTED_REPLAY_SERIALIZATIONS = new WeakMap<object, string>();

export function createMatchSaveFile(state: MatchState, runtime: MatchRuntimeSaveMetadata): MatchSaveFile {
  assertCurrentRulesState(state);
  TRUSTED_STATES.add(state);
  assertRuntimeMetadata(runtime, state);
  const snapshot = cloneMatchState(state);
  const snapshotHash = hashMatchState(snapshot);
  const savedRuntime = { ...runtime };
  return {
    kind: "match-save",
    ...HEADER,
    snapshot: { tick: snapshot.tick, hash: snapshotHash, state: snapshot },
    runtime: savedRuntime,
    continuationHash: hashMatchContinuation(snapshotHash, savedRuntime),
  };
}

export function createMatchCommandJournalFile(baseState: MatchState): MatchCommandJournalFile {
  assertCurrentRulesState(baseState);
  TRUSTED_STATES.add(baseState);
  const baseHash = hashMatchState(baseState);
  const journal: MatchCommandJournalFile = {
    kind: "match-command-journal",
    ...HEADER,
    matchId: baseState.matchId,
    baseTick: baseState.tick,
    baseHash,
    operations: [],
    finalTick: baseState.tick,
    finalHash: baseHash,
  };
  TRUSTED_JOURNALS.add(journal);
  return journal;
}

export function createMatchReplayFile(
  save: MatchSaveFile,
  journal: MatchCommandJournalFile,
  runtime: MatchRuntimeSaveMetadata,
  finalState?: MatchState,
): MatchReplayFile {
  assertMatchSaveFile(save);
  assertMatchCommandJournalFile(journal);
  if (save.snapshot.state.matchId !== journal.matchId) fail("MATCH_MISMATCH", "Replay save and journal match IDs differ");
  if (save.snapshot.tick !== journal.baseTick) fail("TICK_MISMATCH", "Replay journal does not begin at the save tick");
  if (save.snapshot.hash !== journal.baseHash) fail("HASH_MISMATCH", "Replay journal does not begin at the save hash");
  const verifiedFinalState = finalState
    ? (assertJournalCursor(journal, finalState), finalState)
    : replayMatchJournal(save.snapshot.state, journal).state;
  assertRuntimeMetadata(runtime, verifiedFinalState);
  if (runtime.humanPlayerId !== save.runtime.humanPlayerId) fail("INVALID_SCHEMA", "Replay runtime player differs from its save runtime player");
  const finalHash = hashMatchState(verifiedFinalState);
  if (finalHash !== journal.finalHash) fail("HASH_MISMATCH", "Replay final state hash differs from its journal");
  const savedRuntime = { ...runtime };
  const replay: MatchReplayFile = {
    kind: "match-replay",
    ...HEADER,
    save: cloneJson(save),
    journal: cloneJson(journal),
    runtime: savedRuntime,
    finalTick: journal.finalTick,
    finalHash,
    continuationHash: hashMatchContinuation(finalHash, savedRuntime),
  };
  TRUSTED_REPLAY_SERIALIZATIONS.set(replay, stableStringify(replay));
  return replay;
}

export function appendJournalCommand(
  journal: MatchCommandJournalFile,
  state: MatchState,
  envelope: CommandEnvelope,
  source: MatchCommandSource,
): MatchJournalMutationResult {
  assertJournalCursor(journal, state);
  if (source !== "human" && source !== "ai") fail("INVALID_SCHEMA", "Command source must be human or ai");
  if (!isCommandEnvelope(envelope)) fail("INVALID_SCHEMA", "Journal command envelope is invalid");
  if (envelope.matchId !== journal.matchId) fail("MATCH_MISMATCH", "Journal command match ID differs from its journal");
  const preHash = hashMatchState(state);
  const applied = applyCommand(state, envelope);
  if (!applied.validation.ok) {
    fail("COMMAND_REJECTED", `Only accepted commands may enter the journal: ${applied.validation.code}`);
  }
  const postHash = hashMatchState(applied.state);
  const operation: MatchAcceptedCommandOperation = {
    kind: "accepted-command",
    order: journal.operations.length,
    tick: state.tick,
    source,
    envelope: cloneJson(envelope),
    preHash,
    postHash,
  };
  return {
    journal: appendOperation(journal, operation, applied.state),
    state: applied.state,
    events: applied.events,
  };
}

export function appendJournalAiAuthority(
  journal: MatchCommandJournalFile,
  state: MatchState,
  authority: AiAuthorityState,
  cause: MatchAiAuthorityCommitCause,
  acceptedCommandSequences: readonly number[] = [],
): MatchJournalMutationResult {
  assertJournalCursor(journal, state);
  assertAiAuthority(authority, {
    playerIds: new Set(state.players.map((player) => player.id)),
    width: state.map.width,
    height: state.map.height,
    tick: state.tick,
  });
  if (cause !== "commandless" && cause !== "accepted-command") fail("INVALID_SCHEMA", "AI authority cause is invalid");
  assertSafeIntegerArray(acceptedCommandSequences, "acceptedCommandSequences");
  if (cause === "commandless" && acceptedCommandSequences.length !== 0) {
    fail("AI_AUTHORITY_INVALID", "A commandless AI commit cannot reference accepted commands");
  }
  if (cause === "accepted-command" && acceptedCommandSequences.length === 0) {
    fail("AI_AUTHORITY_INVALID", "An accepted-command AI commit must reference at least one accepted command");
  }
  const existing = state.aiControllers.find((candidate) => candidate.playerId === authority.playerId);
  if (!existing) fail("AI_AUTHORITY_INVALID", `Unknown AI authority player: ${authority.playerId}`);
  if (authority.lastDecisionTick !== state.tick) {
    fail("AI_AUTHORITY_INVALID", "Committed AI authority must belong to the current pre-advance tick");
  }
  if (cause === "accepted-command") {
    for (const sequence of acceptedCommandSequences) {
      const accepted = journal.operations.some((operation) => operation.kind === "accepted-command"
        && operation.tick === state.tick
        && operation.source === "ai"
        && operation.envelope.playerId === authority.playerId
        && operation.envelope.sequence === sequence);
      if (!accepted) fail("AI_AUTHORITY_INVALID", `AI authority references an unjournaled accepted command: ${sequence}`);
    }
  }

  const preHash = hashMatchState(state);
  const next = cloneMatchState(state);
  next.aiControllers = next.aiControllers
    .map((candidate) => candidate.playerId === authority.playerId ? cloneJson(authority) : candidate)
    .sort((left, right) => compareText(left.playerId, right.playerId));
  const postHash = hashMatchState(next);
  if (preHash === postHash) fail("AI_AUTHORITY_INVALID", "AI authority journal entries must change canonical state");
  const operation: MatchAiAuthorityCommitOperation = {
    kind: "ai-authority-commit",
    order: journal.operations.length,
    tick: state.tick,
    playerId: authority.playerId,
    cause,
    acceptedCommandSequences: [...acceptedCommandSequences],
    authority: cloneJson(authority),
    preHash,
    postHash,
  };
  return { journal: appendOperation(journal, operation, next), state: next, events: [] };
}

export function appendJournalAdvance(
  journal: MatchCommandJournalFile,
  state: MatchState,
): MatchJournalMutationResult {
  assertJournalCursor(journal, state);
  if (state.phase !== "playing") fail("TICK_MISMATCH", "A finished match cannot append another fixed-step advance");
  const preHash = hashMatchState(state);
  const advanced = stepSimulation(state, [], 1);
  if (advanced.state.tick !== state.tick && advanced.state.tick !== state.tick + 1) {
    fail("TICK_MISMATCH", "A fixed-step journal operation must advance zero or one tick");
  }
  const postHash = hashMatchState(advanced.state);
  const operation: MatchAdvanceOperation = {
    kind: "advance",
    order: journal.operations.length,
    fromTick: state.tick,
    toTick: advanced.state.tick,
    preHash,
    postHash,
  };
  return {
    journal: appendOperation(journal, operation, advanced.state),
    state: advanced.state,
    events: advanced.events,
  };
}

export function replayMatchJournal(baseState: MatchState, journal: MatchCommandJournalFile): MatchJournalReplayResult {
  assertMatchCommandJournalFile(journal);
  assertCurrentRulesState(baseState);
  if (baseState.matchId !== journal.matchId) fail("MATCH_MISMATCH", "Journal and base-state match IDs differ");
  if (baseState.tick !== journal.baseTick) fail("TICK_MISMATCH", "Journal base tick differs from the supplied state");
  if (hashMatchState(baseState) !== journal.baseHash) fail("HASH_MISMATCH", "Journal base hash differs from the supplied state");

  let state = cloneMatchState(baseState);
  const events: DomainEvent[] = [];
  for (const operation of journal.operations) {
    assertOperationPrecondition(operation, state);
    if (operation.kind === "accepted-command") {
      const applied = applyCommand(state, operation.envelope);
      if (!applied.validation.ok) fail("COMMAND_REJECTED", `Recorded command was rejected during replay: ${applied.validation.code}`);
      state = applied.state;
      events.push(...applied.events);
    } else if (operation.kind === "ai-authority-commit") {
      const controller = state.aiControllers.find((candidate) => candidate.playerId === operation.playerId);
      if (!controller) fail("AI_AUTHORITY_INVALID", `Replay is missing AI authority player: ${operation.playerId}`);
      assertAiAuthority(operation.authority, {
        playerIds: new Set(state.players.map((player) => player.id)),
        width: state.map.width,
        height: state.map.height,
        tick: state.tick,
      });
      state = cloneMatchState(state);
      state.aiControllers = state.aiControllers
        .map((candidate) => candidate.playerId === operation.playerId ? cloneJson(operation.authority) : candidate)
        .sort((left, right) => compareText(left.playerId, right.playerId));
    } else {
      const advanced = stepSimulation(state, [], 1);
      state = advanced.state;
      events.push(...advanced.events);
      if (state.tick !== operation.toTick) fail("TICK_MISMATCH", `Advance operation ${operation.order} reached the wrong tick`);
    }
    const postHash = hashMatchState(state);
    if (postHash !== operation.postHash) fail("HASH_MISMATCH", `Operation ${operation.order} post-state hash differs`);
  }
  if (state.tick !== journal.finalTick) fail("TICK_MISMATCH", "Journal final tick differs after replay");
  if (hashMatchState(state) !== journal.finalHash) fail("HASH_MISMATCH", "Journal final hash differs after replay");
  assertCurrentRulesState(state);
  return { state, events };
}

export function replayMatchReplay(replay: MatchReplayFile): MatchReplayResult {
  assertMatchReplayFile(replay);
  const result = replayMatchJournal(replay.save.snapshot.state, replay.journal);
  if (result.state.tick !== replay.finalTick) fail("TICK_MISMATCH", "Replay final tick differs after replay");
  const finalHash = hashMatchState(result.state);
  if (finalHash !== replay.finalHash) fail("HASH_MISMATCH", "Replay final hash differs after replay");
  assertContinuationHash("replay", replay.continuationHash, finalHash, replay.runtime);
  return { ...result, runtime: { ...replay.runtime } };
}

export function serializeMatchSaveFile(file: MatchSaveFile): string {
  assertMatchSaveFile(file);
  return serializeWithLimit(file, MATCH_SAVE_MAX_BYTES, "save");
}

export function serializeMatchCommandJournalFile(file: MatchCommandJournalFile): string {
  assertMatchCommandJournalFile(file);
  return serializeWithLimit(file, MATCH_JOURNAL_MAX_BYTES, "journal");
}

export function serializeMatchReplayFile(file: MatchReplayFile): string {
  const trustedSerialization = TRUSTED_REPLAY_SERIALIZATIONS.get(file);
  if (trustedSerialization === undefined) {
    assertMatchReplayFile(file);
    return serializeWithLimit(file, MATCH_REPLAY_MAX_BYTES, "replay");
  }
  assertJsonValue(file);
  const serialized = stableStringify(file);
  assertByteLimit(serialized, MATCH_REPLAY_MAX_BYTES, "replay");
  if (serialized !== trustedSerialization) fail("HASH_MISMATCH", "Trusted replay was mutated after creation");
  return serialized;
}

export function parseMatchSaveFile(serialized: string): MatchSaveFile {
  return parseArtifact(serialized, MATCH_SAVE_MAX_BYTES, "save", assertMatchSaveFile);
}

export function parseMatchCommandJournalFile(serialized: string): MatchCommandJournalFile {
  const journal = parseArtifact(serialized, MATCH_JOURNAL_MAX_BYTES, "journal", assertMatchCommandJournalFile);
  TRUSTED_JOURNALS.add(journal);
  return journal;
}

export function parseMatchReplayFile(serialized: string): MatchReplayFile {
  return parseArtifact(serialized, MATCH_REPLAY_MAX_BYTES, "replay", assertMatchReplayFile);
}

function appendOperation(
  journal: MatchCommandJournalFile,
  operation: MatchJournalOperation,
  state: MatchState,
): MatchCommandJournalFile {
  // A recorder journal is an append-only builder. Mutating its private array
  // avoids copying an ever-growing operation list once per tick (O(n^2)).
  // Imported JSON is fully validated before it can become trusted here.
  const mutable = journal as unknown as {
    operations: MatchJournalOperation[];
    finalTick: number;
    finalHash: string;
  };
  mutable.operations.push(operation);
  mutable.finalTick = state.tick;
  mutable.finalHash = hashMatchState(state);
  TRUSTED_JOURNALS.add(journal);
  TRUSTED_STATES.add(state);
  return journal;
}

function assertJournalCursor(journal: MatchCommandJournalFile, state: MatchState): void {
  if (!TRUSTED_JOURNALS.has(journal)) assertMatchCommandJournalFile(journal);
  if (!TRUSTED_STATES.has(state)) assertCurrentRulesState(state);
  if (journal.matchId !== state.matchId) fail("MATCH_MISMATCH", "Journal and state match IDs differ");
  if (journal.finalTick !== state.tick) fail("TICK_MISMATCH", "Journal cursor tick differs from state");
  if (journal.finalHash !== hashMatchState(state)) fail("HASH_MISMATCH", "Journal cursor hash differs from state");
}

function assertOperationPrecondition(operation: MatchJournalOperation, state: MatchState): void {
  const tick = operation.kind === "advance" ? operation.fromTick : operation.tick;
  if (state.tick !== tick) fail("TICK_MISMATCH", `Operation ${operation.order} starts at the wrong tick`);
  if (hashMatchState(state) !== operation.preHash) fail("HASH_MISMATCH", `Operation ${operation.order} pre-state hash differs`);
}

function assertMatchSaveFile(value: unknown): asserts value is MatchSaveFile {
  const record = assertRecord(value, "save file");
  assertExactKeys(record, ["kind", "schemaVersion", "protocolVersion", "rulesVersion", "visibility", "snapshot", "runtime", "continuationHash"], "save file");
  if (record.kind !== "match-save") fail("INVALID_SCHEMA", "Artifact is not a match save");
  assertHeader(record);
  const snapshot = assertRecord(record.snapshot, "save snapshot");
  assertExactKeys(snapshot, ["tick", "hash", "state"], "save snapshot");
  assertTick(snapshot.tick, "snapshot.tick");
  assertHash(snapshot.hash, "snapshot.hash");
  assertMatchState(snapshot.state);
  const state = snapshot.state as MatchState;
  if (snapshot.tick !== state.tick) fail("TICK_MISMATCH", "Save snapshot tick differs from state");
  if (snapshot.hash !== hashMatchState(state)) fail("HASH_MISMATCH", "Save snapshot hash differs from state");
  assertRuntimeMetadata(record.runtime, state);
  assertContinuationHash("save", record.continuationHash, snapshot.hash, record.runtime as MatchRuntimeSaveMetadata);
}

function assertMatchCommandJournalFile(value: unknown): asserts value is MatchCommandJournalFile {
  const record = assertRecord(value, "command journal");
  assertExactKeys(record, [
    "kind", "schemaVersion", "protocolVersion", "rulesVersion", "visibility", "matchId",
    "baseTick", "baseHash", "operations", "finalTick", "finalHash",
  ], "command journal");
  if (record.kind !== "match-command-journal") fail("INVALID_SCHEMA", "Artifact is not a match command journal");
  assertHeader(record);
  assertNonEmptyString(record.matchId, "journal.matchId");
  assertTick(record.baseTick, "journal.baseTick");
  assertHash(record.baseHash, "journal.baseHash");
  if (!Array.isArray(record.operations)) fail("INVALID_SCHEMA", "journal.operations must be an array");
  if (record.operations.length > MATCH_JOURNAL_MAX_OPERATIONS) fail("PAYLOAD_TOO_LARGE", `Journal exceeds ${MATCH_JOURNAL_MAX_OPERATIONS} operations`);
  assertTick(record.finalTick, "journal.finalTick");
  assertHash(record.finalHash, "journal.finalHash");

  let cursorTick = record.baseTick as number;
  let cursorHash = record.baseHash as string;
  for (const [index, candidate] of record.operations.entries()) {
    assertJournalOperation(candidate, index, record.matchId as string);
    const operation = candidate as MatchJournalOperation;
    if (operation.order !== index) fail("JOURNAL_ORDER_INVALID", `Journal operation order must be contiguous at ${index}`);
    const operationTick = operation.kind === "advance" ? operation.fromTick : operation.tick;
    if (operationTick !== cursorTick) fail("TICK_MISMATCH", `Journal operation ${index} starts at the wrong tick`);
    if (operation.preHash !== cursorHash) fail("HASH_MISMATCH", `Journal operation ${index} breaks the hash chain`);
    if (operation.kind === "ai-authority-commit") {
      if (operation.preHash === operation.postHash) fail("AI_AUTHORITY_INVALID", `AI authority operation ${index} does not change canonical state`);
      for (const sequence of operation.acceptedCommandSequences) {
        const accepted = (record.operations as unknown[]).slice(0, index).some((previousValue) => {
          const previous = previousValue as Partial<MatchAcceptedCommandOperation>;
          return previous.kind === "accepted-command"
            && previous.tick === operation.tick
            && previous.source === "ai"
            && previous.envelope?.playerId === operation.playerId
            && previous.envelope.sequence === sequence;
        });
        if (!accepted) fail("AI_AUTHORITY_INVALID", `AI authority operation ${index} references an unjournaled command`);
      }
    }
    if (operation.kind === "advance") cursorTick = operation.toTick;
    cursorHash = operation.postHash;
  }
  if (record.finalTick !== cursorTick) fail("TICK_MISMATCH", "Journal finalTick differs from its operation chain");
  if (record.finalHash !== cursorHash) fail("HASH_MISMATCH", "Journal finalHash differs from its operation chain");
}

function assertMatchReplayFile(value: unknown): asserts value is MatchReplayFile {
  const record = assertRecord(value, "replay file");
  assertExactKeys(record, ["kind", "schemaVersion", "protocolVersion", "rulesVersion", "visibility", "save", "journal", "runtime", "finalTick", "finalHash", "continuationHash"], "replay file");
  if (record.kind !== "match-replay") fail("INVALID_SCHEMA", "Artifact is not a match replay");
  assertHeader(record);
  assertMatchSaveFile(record.save);
  assertMatchCommandJournalFile(record.journal);
  assertTick(record.finalTick, "replay.finalTick");
  assertHash(record.finalHash, "replay.finalHash");
  assertHash(record.continuationHash, "replay.continuationHash");
  const save = record.save as MatchSaveFile;
  const journal = record.journal as MatchCommandJournalFile;
  if (save.snapshot.state.matchId !== journal.matchId) fail("MATCH_MISMATCH", "Replay save and journal match IDs differ");
  if (save.snapshot.tick !== journal.baseTick) fail("TICK_MISMATCH", "Replay journal base tick differs from save");
  if (save.snapshot.hash !== journal.baseHash) fail("HASH_MISMATCH", "Replay journal base hash differs from save");
  if (record.finalTick !== journal.finalTick) fail("TICK_MISMATCH", "Replay final tick differs from journal");
  if (record.finalHash !== journal.finalHash) fail("HASH_MISMATCH", "Replay final hash differs from journal");
  const finalState = replayMatchJournal(save.snapshot.state, journal).state;
  assertRuntimeMetadata(record.runtime, finalState);
  assertContinuationHash("replay", record.continuationHash, hashMatchState(finalState), record.runtime as MatchRuntimeSaveMetadata);
  if ((record.runtime as MatchRuntimeSaveMetadata).humanPlayerId !== save.runtime.humanPlayerId) {
    fail("INVALID_SCHEMA", "Replay runtime player differs from its save runtime player");
  }
}

function assertContinuationHash(
  label: "save" | "replay",
  value: unknown,
  finalStateHash: string,
  runtime: MatchRuntimeSaveMetadata,
): void {
  assertHash(value, `${label}.continuationHash`);
  if (value !== hashMatchContinuation(finalStateHash, runtime)) {
    fail("HASH_MISMATCH", `${label} continuation hash differs from its final state and runtime metadata`);
  }
}

function assertHeader(record: Record<string, unknown>): void {
  if (record.schemaVersion !== MATCH_PERSISTENCE_SCHEMA_VERSION) {
    fail("UNSUPPORTED_SCHEMA_VERSION", `Unsupported persistence schema version: ${String(record.schemaVersion)}`);
  }
  if (record.protocolVersion !== MATCH_PERSISTENCE_PROTOCOL_VERSION) {
    fail("UNSUPPORTED_PROTOCOL_VERSION", `Unsupported persistence protocol version: ${String(record.protocolVersion)}`);
  }
  if (record.rulesVersion !== RULES_VERSION) {
    fail("UNSUPPORTED_RULES_VERSION", `Unsupported rules version: ${String(record.rulesVersion)}`);
  }
  if (record.visibility !== "authoritative-private") {
    fail("VISIBILITY_MISMATCH", "Persistence artifacts must be marked authoritative-private");
  }
}

function assertJournalOperation(value: unknown, expectedOrder: number, matchId: string): asserts value is MatchJournalOperation {
  const record = assertRecord(value, `journal operation ${expectedOrder}`);
  if (record.kind === "accepted-command") {
    assertExactKeys(record, ["kind", "order", "tick", "source", "envelope", "preHash", "postHash"], "accepted command operation");
    assertNonNegativeSafeInteger(record.order, "operation.order");
    assertTick(record.tick, "operation.tick");
    if (record.source !== "human" && record.source !== "ai") fail("INVALID_SCHEMA", "Command operation source is invalid");
    if (!isCommandEnvelope(record.envelope)) fail("INVALID_SCHEMA", "Command operation envelope is invalid");
    if (record.envelope.matchId !== matchId) fail("MATCH_MISMATCH", "Command operation match ID differs from journal");
    assertHash(record.preHash, "operation.preHash");
    assertHash(record.postHash, "operation.postHash");
    return;
  }
  if (record.kind === "ai-authority-commit") {
    assertExactKeys(record, [
      "kind", "order", "tick", "playerId", "cause", "acceptedCommandSequences", "authority", "preHash", "postHash",
    ], "AI authority operation");
    assertNonNegativeSafeInteger(record.order, "operation.order");
    assertTick(record.tick, "operation.tick");
    assertNonEmptyString(record.playerId, "operation.playerId");
    if (record.cause !== "commandless" && record.cause !== "accepted-command") fail("INVALID_SCHEMA", "AI authority operation cause is invalid");
    if (!Array.isArray(record.acceptedCommandSequences)) fail("INVALID_SCHEMA", "acceptedCommandSequences must be an array");
    assertSafeIntegerArray(record.acceptedCommandSequences, "acceptedCommandSequences");
    if (record.cause === "commandless" && record.acceptedCommandSequences.length !== 0) fail("AI_AUTHORITY_INVALID", "Commandless AI authority operation references commands");
    if (record.cause === "accepted-command" && record.acceptedCommandSequences.length === 0) fail("AI_AUTHORITY_INVALID", "Accepted-command AI authority operation has no sequence");
    assertAiAuthority(record.authority);
    if ((record.authority as AiAuthorityState).playerId !== record.playerId) fail("AI_AUTHORITY_INVALID", "AI authority operation player IDs differ");
    if ((record.authority as AiAuthorityState).lastDecisionTick !== record.tick) fail("AI_AUTHORITY_INVALID", "AI authority operation belongs to a different tick");
    assertHash(record.preHash, "operation.preHash");
    assertHash(record.postHash, "operation.postHash");
    return;
  }
  if (record.kind === "advance") {
    assertExactKeys(record, ["kind", "order", "fromTick", "toTick", "preHash", "postHash"], "advance operation");
    assertNonNegativeSafeInteger(record.order, "operation.order");
    assertTick(record.fromTick, "operation.fromTick");
    assertTick(record.toTick, "operation.toTick");
    if ((record.toTick as number) < (record.fromTick as number) || (record.toTick as number) > (record.fromTick as number) + 1) {
      fail("TICK_MISMATCH", "Advance operation must advance zero or one tick");
    }
    assertHash(record.preHash, "operation.preHash");
    assertHash(record.postHash, "operation.postHash");
    return;
  }
  fail("INVALID_SCHEMA", `Unknown journal operation kind: ${String(record.kind)}`);
}

function assertMatchState(value: unknown): asserts value is MatchState {
  const record = assertRecord(value, "match state");
  assertExactKeys(record, [
    "rulesVersion", "matchId", "seed", "randomState", "tick", "ticksPerSecond", "phase", "map", "players",
    "aiControllers", "entities", "projectiles", "visibilityByPlayer", "nextEntityNumber", "teamTownCenterLostAt",
    "winningTeamIds", "finishReason", "victory",
  ], "match state");
  if (record.rulesVersion !== RULES_VERSION) fail("UNSUPPORTED_RULES_VERSION", `Unsupported state rules version: ${String(record.rulesVersion)}`);
  assertNonEmptyString(record.matchId, "state.matchId");
  assertNonNegativeSafeInteger(record.seed, "state.seed");
  assertNonNegativeSafeInteger(record.randomState, "state.randomState");
  assertTick(record.tick, "state.tick");
  if (record.ticksPerSecond !== 10) fail("INVALID_SCHEMA", "state.ticksPerSecond must be 10");
  if (!isMatchPhase(record.phase)) fail("INVALID_SCHEMA", "state.phase is invalid");
  for (const key of ["players", "aiControllers", "entities", "projectiles", "visibilityByPlayer", "teamTownCenterLostAt", "winningTeamIds"] as const) {
    if (!Array.isArray(record[key])) fail("INVALID_SCHEMA", `state.${key} must be an array`);
  }
  assertNonNegativeSafeInteger(record.nextEntityNumber, "state.nextEntityNumber");
  const map = assertMatchMap(record.map);
  assertRecord(record.victory, "state.victory");
  assertJsonValue(record);

  const players = record.players as unknown[];
  if (players.length < 2 || players.length > 5) fail("INVALID_SCHEMA", "state.players must contain two to five players");
  const playerIds = new Set<string>();
  const teamIds = new Set<string>();
  const villageIds = new Set<string>();
  for (const [index, playerValue] of players.entries()) {
    const player = assertRecord(playerValue, `state.players[${index}]`);
    assertExactKeys(player, [
      "id", "teamId", "villageId", "resources", "population", "settlementTier", "advancement",
      "completedTechnologyIds", "activeMonsterBoons", "lastSequence", "surrendered", "eliminated",
    ], `state.players[${index}]`);
    assertNonEmptyString(player.id, `state.players[${index}].id`);
    if (playerIds.has(player.id as string)) fail("INVALID_SCHEMA", "state player IDs must be unique");
    playerIds.add(player.id as string);
    assertNonEmptyString(player.teamId, `state.players[${index}].teamId`);
    teamIds.add(player.teamId as string);
    if (!VILLAGE_IDS.includes(player.villageId as (typeof VILLAGE_IDS)[number])) {
      fail("INVALID_SCHEMA", `state.players[${index}].villageId is invalid`);
    }
    if (villageIds.has(player.villageId as string)) fail("INVALID_SCHEMA", "state player village IDs must be unique");
    villageIds.add(player.villageId as string);
    assertWallet(player.resources, `state.players[${index}].resources`);
    const population = assertRecord(player.population, `state.players[${index}].population`);
    assertExactKeys(population, ["used", "capacity"], `state.players[${index}].population`);
    assertNonNegativeSafeInteger(population.used, `state.players[${index}].population.used`);
    assertNonNegativeSafeInteger(population.capacity, `state.players[${index}].population.capacity`);
    if ((population.used as number) > (population.capacity as number)) fail("INVALID_SCHEMA", "state population used exceeds capacity");
    if (!hasOwn(SETTLEMENT_TIERS, player.settlementTier)) fail("INVALID_SCHEMA", `state.players[${index}].settlementTier is invalid`);
    assertPlayerAdvancement(player.advancement, `state.players[${index}].advancement`);
    assertRegistryIdArray(player.completedTechnologyIds, TECHNOLOGIES, `state.players[${index}].completedTechnologyIds`);
    assertActiveMonsterBoons(player.activeMonsterBoons, `state.players[${index}].activeMonsterBoons`);
    assertSafeInteger(player.lastSequence, `state.players[${index}].lastSequence`);
    if ((player.lastSequence as number) < -1) fail("INVALID_SCHEMA", "state player lastSequence must be at least -1");
    if (typeof player.surrendered !== "boolean" || typeof player.eliminated !== "boolean") fail("INVALID_SCHEMA", "state player defeat flags must be boolean");
  }
  if (teamIds.size < 2) fail("INVALID_SCHEMA", "state must contain at least two opposing teams");
  assertTeamTownCenterTimers(record.teamTownCenterLostAt, teamIds, record.tick as number);
  const stateWinningTeamIds = assertTeamIdArray(record.winningTeamIds, teamIds, "state.winningTeamIds");
  assertFinishReason(record.finishReason, "state.finishReason", true);
  const victoryPolicy = assertVictoryState(record.victory, {
    teamIds,
    players: players.map((candidate) => candidate as Record<string, unknown>),
    width: map.width,
    height: map.height,
    tick: record.tick as number,
    phase: record.phase as string,
    stateWinningTeamIds,
    stateFinishReason: record.finishReason as string | null,
  });
  if (!victoryPolicy.commandCenterConquestEnabled && (record.teamTownCenterLostAt as unknown[]).length > 0) {
    fail("INVALID_SCHEMA", "state.teamTownCenterLostAt exists without a conquest policy");
  }

  const entities = record.entities as unknown[];
  const entityIds = new Set<string>();
  let maxGeneratedEntityNumber = 0;
  for (const [index, entityValue] of entities.entries()) {
    const entity = assertRecord(entityValue, `state.entities[${index}]`);
    assertNonEmptyString(entity.id, `state.entities[${index}].id`);
    if (entityIds.has(entity.id as string)) fail("INVALID_SCHEMA", "state entity IDs must be unique");
    entityIds.add(entity.id as string);
    maxGeneratedEntityNumber = Math.max(maxGeneratedEntityNumber, generatedEntityNumber(entity.id as string));
  }
  for (const [index, entityValue] of entities.entries()) {
    const entity = assertRecord(entityValue, `state.entities[${index}]`);
    if (!isEntityKind(entity.kind)) fail("INVALID_SCHEMA", `state.entities[${index}].kind is invalid`);
    assertEntityState(entity, entity.kind, {
      label: `state.entities[${index}]`,
      width: map.width,
      height: map.height,
      playerIds,
      teamIds,
      entityIds,
      players: players.map((candidate) => candidate as Record<string, unknown>),
    });
  }

  const projectileIds = new Set<string>();
  for (const [index, projectileValue] of (record.projectiles as unknown[]).entries()) {
    const projectile = assertRecord(projectileValue, `state.projectiles[${index}]`);
    const label = `state.projectiles[${index}]`;
    assertNonEmptyString(projectile.id, `${label}.id`);
    if (entityIds.has(projectile.id as string) || projectileIds.has(projectile.id as string)) {
      fail("INVALID_SCHEMA", "state entity and projectile IDs must be unique");
    }
    projectileIds.add(projectile.id as string);
    maxGeneratedEntityNumber = Math.max(maxGeneratedEntityNumber, generatedEntityNumber(projectile.id as string));
    assertProjectileState(projectile, {
      label,
      width: map.width,
      height: map.height,
      tick: record.tick as number,
      playerIds,
    });
  }

  const visibilityPlayerIds = new Set<string>();
  const mapTileCount = map.width * map.height;
  for (const [index, visibilityValue] of (record.visibilityByPlayer as unknown[]).entries()) {
    const visibility = assertRecord(visibilityValue, `state.visibilityByPlayer[${index}]`);
    assertExactKeys(visibility, [
      "playerId", "visibleTileIndices", "exploredTileIndices", "staleEnemySightings",
      "observerRevision", "sightingRevision", "revision",
    ], `state.visibilityByPlayer[${index}]`);
    assertKnownPlayerOwner(visibility.playerId, playerIds, `state.visibilityByPlayer[${index}].playerId`);
    if (visibilityPlayerIds.has(visibility.playerId as string)) fail("INVALID_SCHEMA", "state visibility player IDs must be unique");
    visibilityPlayerIds.add(visibility.playerId as string);
    assertTileIndexArray(visibility.visibleTileIndices, mapTileCount, `state.visibilityByPlayer[${index}].visibleTileIndices`);
    assertTileIndexArray(visibility.exploredTileIndices, mapTileCount, `state.visibilityByPlayer[${index}].exploredTileIndices`);
    if (!Array.isArray(visibility.staleEnemySightings)) fail("INVALID_SCHEMA", `state.visibilityByPlayer[${index}].staleEnemySightings must be an array`);
    const staleEntityIds = new Set<string>();
    let previousStaleEntityId: string | null = null;
    for (const [sightingIndex, sightingValue] of visibility.staleEnemySightings.entries()) {
      const sighting = assertRecord(sightingValue, `state.visibilityByPlayer[${index}].staleEnemySightings[${sightingIndex}]`);
      const label = `state.visibilityByPlayer[${index}].staleEnemySightings[${sightingIndex}]`;
      assertStaleEntitySighting(sighting, {
        label,
        width: map.width,
        height: map.height,
        tick: record.tick as number,
        observerPlayerId: visibility.playerId as string,
        players: players.map((candidate) => candidate as Record<string, unknown>),
        playerIds,
      });
      if (staleEntityIds.has(sighting.entityId as string)) fail("INVALID_SCHEMA", `${label}.entityId is duplicated`);
      if (previousStaleEntityId !== null && compareText(previousStaleEntityId, sighting.entityId as string) >= 0) {
        fail("INVALID_SCHEMA", `state.visibilityByPlayer[${index}].staleEnemySightings must use canonical entity order`);
      }
      staleEntityIds.add(sighting.entityId as string);
      previousStaleEntityId = sighting.entityId as string;
      maxGeneratedEntityNumber = Math.max(maxGeneratedEntityNumber, generatedEntityNumber(sighting.entityId as string));
    }
    if (typeof visibility.observerRevision !== "string" || typeof visibility.sightingRevision !== "string") {
      fail("INVALID_SCHEMA", "state visibility revisions must be strings");
    }
    assertNonNegativeSafeInteger(visibility.revision, `state.visibilityByPlayer[${index}].revision`);
  }
  if (visibilityPlayerIds.size !== playerIds.size) fail("INVALID_SCHEMA", "state must contain visibility for every player");
  const aiPlayerIds = new Set<string>();
  for (const authorityValue of record.aiControllers as unknown[]) {
    assertAiAuthority(authorityValue, {
      playerIds,
      width: map.width,
      height: map.height,
      tick: record.tick as number,
    });
    const authority = authorityValue as AiAuthorityState;
    if (!playerIds.has(authority.playerId)) fail("INVALID_SCHEMA", `AI authority references unknown player: ${authority.playerId}`);
    if (aiPlayerIds.has(authority.playerId)) fail("INVALID_SCHEMA", "AI authority player IDs must be unique");
    aiPlayerIds.add(authority.playerId);
  }
  maxGeneratedEntityNumber = Math.max(
    maxGeneratedEntityNumber,
    maxGeneratedStateReferenceNumber(record as unknown as MatchState),
  );
  if ((record.nextEntityNumber as number) <= maxGeneratedEntityNumber) {
    fail("INVALID_SCHEMA", "state.nextEntityNumber must exceed every generated entity or retained generated-ID reference");
  }

  assertCanonicalSimulationState(record as unknown as MatchState);
}

function assertMatchMap(value: unknown): { id: "open" | typeof VILLAGE_ASSAULT_MAP_ID; width: number; height: number; layoutId?: string } {
  const map = assertRecord(value, "state.map");
  if (map.id === VILLAGE_ASSAULT_MAP_ID) {
    assertExactKeys(map, ["id", "width", "height", "layoutId"], "state.map");
  } else {
    assertExactKeys(map, ["id", "width", "height"], "state.map");
  }
  if (map.id !== "open" && map.id !== VILLAGE_ASSAULT_MAP_ID) fail("INVALID_SCHEMA", "state.map.id is invalid");
  assertPositiveSafeInteger(map.width, "state.map.width");
  assertPositiveSafeInteger(map.height, "state.map.height");
  const width = map.width as number;
  const height = map.height as number;
  if (width > MATCH_PERSISTENCE_MAX_MAP_DIMENSION || height > MATCH_PERSISTENCE_MAX_MAP_DIMENSION || width * height > MATCH_PERSISTENCE_MAX_MAP_TILES) {
    fail("PAYLOAD_TOO_LARGE", "state.map dimensions exceed the persistence workload cap");
  }
  if (map.id === VILLAGE_ASSAULT_MAP_ID) {
    if (width !== VILLAGE_ASSAULT_MAP_WIDTH || height !== VILLAGE_ASSAULT_MAP_HEIGHT) {
      fail("INVALID_SCHEMA", `state.map village assault layout must be ${VILLAGE_ASSAULT_MAP_WIDTH}x${VILLAGE_ASSAULT_MAP_HEIGHT}`);
    }
    if (!isVillageAssaultLayoutId(map.layoutId)) fail("INVALID_SCHEMA", "state.map.layoutId is invalid");
  }
  return map as { id: "open" | typeof VILLAGE_ASSAULT_MAP_ID; width: number; height: number; layoutId?: string };
}

function assertWallet(value: unknown, label: string): void {
  const wallet = assertRecord(value, label);
  assertExactKeys(wallet, ["food", "wood", "stone"], label);
  assertNonNegativeSafeInteger(wallet.food, `${label}.food`);
  assertNonNegativeSafeInteger(wallet.wood, `${label}.wood`);
  assertNonNegativeSafeInteger(wallet.stone, `${label}.stone`);
}

function assertPlayerAdvancement(value: unknown, label: string): void {
  if (value === null) return;
  const advancement = assertRecord(value, label);
  assertExactKeys(advancement, ["producerId", "targetTier", "remainingTicks"], label);
  assertNonEmptyString(advancement.producerId, `${label}.producerId`);
  if (!hasOwn(SETTLEMENT_TIERS, advancement.targetTier)) fail("INVALID_SCHEMA", `${label}.targetTier is invalid`);
  assertNonNegativeSafeInteger(advancement.remainingTicks, `${label}.remainingTicks`);
}

function assertRegistryIdArray(value: unknown, registry: object, label: string): void {
  if (!Array.isArray(value)) fail("INVALID_SCHEMA", `${label} must be an array`);
  const seen = new Set<string>();
  for (const candidate of value) {
    if (!hasOwn(registry, candidate)) fail("INVALID_SCHEMA", `${label} contains an unregistered ID`);
    if (seen.has(candidate as string)) fail("INVALID_SCHEMA", `${label} cannot contain duplicates`);
    seen.add(candidate as string);
  }
}

function assertActiveMonsterBoons(value: unknown, label: string): void {
  if (!Array.isArray(value)) fail("INVALID_SCHEMA", `${label} must be an array`);
  const seen = new Set<string>();
  for (const [index, boonValue] of value.entries()) {
    const boon = assertRecord(boonValue, `${label}[${index}]`);
    assertExactKeys(boon, ["id", "expiresAtTick"], `${label}[${index}]`);
    if (!hasOwn(MONSTER_BOONS, boon.id)) fail("INVALID_SCHEMA", `${label}[${index}].id is invalid`);
    if (seen.has(boon.id as string)) fail("INVALID_SCHEMA", `${label} cannot contain duplicate boons`);
    seen.add(boon.id as string);
    assertTick(boon.expiresAtTick, `${label}[${index}].expiresAtTick`);
  }
}

function assertKnownPlayerOwner(value: unknown, playerIds: ReadonlySet<string>, label: string): asserts value is string {
  assertNonEmptyString(value, label);
  if (!playerIds.has(value)) fail("INVALID_SCHEMA", `${label} references an unknown player`);
}

function assertPoint(value: unknown, width: number, height: number, label: string, requireInteger: boolean): void {
  const point = assertRecord(value, label);
  assertExactKeys(point, ["x", "y"], label);
  for (const axis of ["x", "y"] as const) {
    if (typeof point[axis] !== "number" || !Number.isFinite(point[axis])) fail("INVALID_SCHEMA", `${label}.${axis} must be finite`);
    if (requireInteger && !Number.isSafeInteger(point[axis])) fail("INVALID_SCHEMA", `${label}.${axis} must be a safe integer`);
  }
  if ((point.x as number) < 0 || (point.x as number) >= width || (point.y as number) < 0 || (point.y as number) >= height) {
    fail("INVALID_SCHEMA", `${label} is outside the map`);
  }
}

function assertTileIndexArray(value: unknown, tileCount: number, label: string): void {
  if (!Array.isArray(value)) fail("INVALID_SCHEMA", `${label} must be an array`);
  const seen = new Set<number>();
  for (const candidate of value) {
    assertNonNegativeSafeInteger(candidate, label);
    if (candidate >= tileCount) fail("INVALID_SCHEMA", `${label} contains an out-of-bounds tile`);
    if (seen.has(candidate)) fail("INVALID_SCHEMA", `${label} cannot contain duplicate tiles`);
    seen.add(candidate);
  }
}

function assertBuildingFootprintInBounds(
  typeId: keyof typeof BUILDINGS,
  orientation: "ne" | "se",
  position: { x: number; y: number },
  width: number,
  height: number,
  label: string,
): void {
  const footprint = getBuildingFootprint(typeId, orientation);
  if (footprint.some((cell) => {
    const x = position.x + cell.x;
    const y = position.y + cell.y;
    return x < 0 || y < 0 || x >= width || y >= height;
  })) {
    fail("INVALID_SCHEMA", `${label} footprint exceeds map bounds`);
  }
}

interface StaleEntitySightingValidationContext {
  readonly label: string;
  readonly width: number;
  readonly height: number;
  readonly tick: number;
  readonly observerPlayerId: string;
  readonly players: readonly Record<string, unknown>[];
  readonly playerIds: ReadonlySet<string>;
}

function assertStaleEntitySighting(
  sighting: Record<string, unknown>,
  context: StaleEntitySightingValidationContext,
): void {
  const required = [
    "entityId", "ownerId", "typeId", "position", "hitPoints", "maxHitPoints", "stateRevision",
    "orientation", "complete", "constructionRemainingTicks", "healthBand", "blocksMovement", "observedAtTick",
  ];
  assertRequiredAllowedKeys(sighting, required, [...required, "gateOpen"], context.label);
  assertNonEmptyString(sighting.entityId, `${context.label}.entityId`);
  assertKnownPlayerOwner(sighting.ownerId, context.playerIds, `${context.label}.ownerId`);
  const observer = context.players.find((player) => player.id === context.observerPlayerId);
  const owner = context.players.find((player) => player.id === sighting.ownerId);
  if (!observer || !owner || observer.teamId === owner.teamId) {
    fail("INVALID_SCHEMA", `${context.label}.ownerId must identify a hostile player`);
  }
  if (!hasOwn(BUILDINGS, sighting.typeId)) fail("INVALID_SCHEMA", `${context.label}.typeId is invalid`);
  assertPoint(sighting.position, context.width, context.height, `${context.label}.position`, true);
  assertNonNegativeSafeInteger(sighting.hitPoints, `${context.label}.hitPoints`);
  assertPositiveSafeInteger(sighting.maxHitPoints, `${context.label}.maxHitPoints`);
  if ((sighting.hitPoints as number) > (sighting.maxHitPoints as number)) fail("INVALID_SCHEMA", `${context.label}.hitPoints exceeds maxHitPoints`);
  assertNonNegativeSafeInteger(sighting.stateRevision, `${context.label}.stateRevision`);
  if (!isOneOf(sighting.orientation, ["ne", "se"])) fail("INVALID_SCHEMA", `${context.label}.orientation is invalid`);
  assertBuildingFootprintInBounds(
    sighting.typeId as keyof typeof BUILDINGS,
    sighting.orientation as "ne" | "se",
    sighting.position as { x: number; y: number },
    context.width,
    context.height,
    context.label,
  );
  if (typeof sighting.complete !== "boolean") fail("INVALID_SCHEMA", `${context.label}.complete must be boolean`);
  assertNonNegativeSafeInteger(sighting.constructionRemainingTicks, `${context.label}.constructionRemainingTicks`);
  if (sighting.complete !== ((sighting.constructionRemainingTicks as number) === 0)) {
    fail("INVALID_SCHEMA", `${context.label} construction fields are inconsistent`);
  }
  const hitPoints = sighting.hitPoints as number;
  const maxHitPoints = sighting.maxHitPoints as number;
  const expectedHealthBand = hitPoints <= 0
    ? "destroyed"
    : hitPoints * 3 <= maxHitPoints
      ? "critical"
      : hitPoints * 3 <= maxHitPoints * 2
        ? "damaged"
        : "healthy";
  if (sighting.healthBand !== expectedHealthBand) fail("INVALID_SCHEMA", `${context.label}.healthBand is inconsistent`);
  if (typeof sighting.blocksMovement !== "boolean") fail("INVALID_SCHEMA", `${context.label}.blocksMovement must be boolean`);
  const building = BUILDINGS[sighting.typeId as keyof typeof BUILDINGS];
  if (sighting.typeId === "surveyGate") {
    if (typeof sighting.gateOpen !== "boolean") fail("INVALID_SCHEMA", `${context.label}.gateOpen must be boolean for a gate`);
  } else if (hasOwn(sighting, "gateOpen") && sighting.gateOpen !== undefined) {
    fail("INVALID_SCHEMA", `${context.label}.gateOpen is only valid for a gate`);
  }
  const expectedBlocksMovement = hitPoints > 0
    && (building.movementBlocking !== "whenClosed" || sighting.complete !== true || sighting.gateOpen !== true);
  if (sighting.blocksMovement !== expectedBlocksMovement) fail("INVALID_SCHEMA", `${context.label}.blocksMovement is inconsistent`);
  assertNonNegativeSafeInteger(sighting.observedAtTick, `${context.label}.observedAtTick`);
  if ((sighting.observedAtTick as number) > context.tick) fail("INVALID_SCHEMA", `${context.label}.observedAtTick is in the future`);
}

function generatedEntityNumber(id: string): number {
  const match = /^(?:unit|building|rubble|resource|monster|projectile|projectile-group)-(\d+)$/.exec(id);
  if (!match) return 0;
  const value = Number(match[1]);
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function maxGeneratedStateReferenceNumber(state: MatchState): number {
  let maximum = 0;
  const observe = (id: string | null | undefined): void => {
    if (id !== null && id !== undefined) maximum = Math.max(maximum, generatedEntityNumber(id));
  };
  const observeCombatTarget = (target: { kind: string; entityId?: string } | null): void => {
    if (target?.kind === "entity") observe(target.entityId);
  };

  for (const player of state.players) observe(player.advancement?.producerId);
  for (const entity of state.entities) {
    observe(entity.id);
    if (entity.kind === "unit") {
      if (entity.order.type === "attackMove") observe(entity.order.engagedTargetId);
      if (["attack", "gather", "deliver", "construct", "repair"].includes(entity.order.type)) {
        observe((entity.order as { targetId: string }).targetId);
      }
      if (entity.order.type === "gather") observe(entity.order.dropOffId);
      observeCombatTarget(entity.combat.target);
      observe(entity.passive.rhythmTargetId);
      for (const status of entity.statuses) observe(status.sourceId);
    } else if (entity.kind === "building") {
      for (const status of entity.statuses) observe(status.sourceId);
    } else if (entity.kind === "monster") {
      observeCombatTarget(entity.combat.target);
      observe(entity.targetId);
      for (const status of entity.statuses) observe(status.sourceId);
    }
  }
  for (const projectile of state.projectiles) {
    observe(projectile.id);
    observe(projectile.sourceId);
    observe(projectile.targetId);
    if (projectile.resolution?.kind === "groundArea") observe(projectile.resolution.groupId);
    if (projectile.resolution?.kind === "line") {
      for (const targetId of projectile.resolution.hitTargetIds) observe(targetId);
    }
  }
  for (const visibility of state.visibilityByPlayer) {
    for (const sighting of visibility.staleEnemySightings) observe(sighting.entityId);
  }
  for (const authority of state.aiControllers) {
    for (const memory of authority.enemyMemory) observe(memory.entityId);
    observe(authority.repairTargetId);
    if (authority.activeWave) {
      for (const memberId of authority.activeWave.memberIds) observe(memberId);
      observe(authority.activeWave.targetEntityId);
    }
  }
  return maximum;
}

function assertCanonicalSimulationState(state: MatchState): void {
  try {
    const canonical = cloneMatchState(state);
    const beforeHash = hashMatchState(canonical);
    for (const player of canonical.players) toVisibleSnapshot(canonical, player.id);
    const zeroStep = stepSimulation(canonical, [], 0).state;
    if (hashMatchState(zeroStep) !== beforeHash) {
      fail("INVALID_SCHEMA", "Match state is not canonical under a zero-step simulation");
    }
  } catch (error) {
    if (error instanceof MatchPersistenceError) throw error;
    fail("INVALID_SCHEMA", `Match state failed simulation validation: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function isEntityKind(value: unknown): value is "unit" | "building" | "resource" | "rubble" | "monster" {
  return value === "unit" || value === "building" || value === "resource" || value === "rubble" || value === "monster";
}

function assertTeamTownCenterTimers(value: unknown, teamIds: ReadonlySet<string>, stateTick: number): void {
  if (!Array.isArray(value)) fail("INVALID_SCHEMA", "state.teamTownCenterLostAt must be an array");
  const seen = new Set<string>();
  let previousTeamId: string | null = null;
  for (const [index, timerValue] of value.entries()) {
    const timer = assertRecord(timerValue, `state.teamTownCenterLostAt[${index}]`);
    assertExactKeys(timer, ["teamId", "tick"], `state.teamTownCenterLostAt[${index}]`);
    assertNonEmptyString(timer.teamId, `state.teamTownCenterLostAt[${index}].teamId`);
    if (!teamIds.has(timer.teamId)) fail("INVALID_SCHEMA", `state.teamTownCenterLostAt[${index}].teamId is unknown`);
    if (seen.has(timer.teamId)) fail("INVALID_SCHEMA", "state.teamTownCenterLostAt contains duplicate teams");
    if (previousTeamId !== null && compareText(previousTeamId, timer.teamId) >= 0) fail("INVALID_SCHEMA", "state.teamTownCenterLostAt must use canonical team order");
    seen.add(timer.teamId);
    previousTeamId = timer.teamId;
    assertNonNegativeSafeInteger(timer.tick, `state.teamTownCenterLostAt[${index}].tick`);
    if ((timer.tick as number) > stateTick) fail("INVALID_SCHEMA", `state.teamTownCenterLostAt[${index}].tick is in the future`);
  }
}

function assertTeamIdArray(value: unknown, teamIds: ReadonlySet<string>, label: string): string[] {
  if (!Array.isArray(value)) fail("INVALID_SCHEMA", `${label} must be an array`);
  const seen = new Set<string>();
  let previous: string | null = null;
  for (const [index, candidate] of value.entries()) {
    assertNonEmptyString(candidate, `${label}[${index}]`);
    if (!teamIds.has(candidate)) fail("INVALID_SCHEMA", `${label}[${index}] is unknown`);
    if (seen.has(candidate)) fail("INVALID_SCHEMA", `${label} contains duplicate teams`);
    if (previous !== null && compareText(previous, candidate) >= 0) fail("INVALID_SCHEMA", `${label} must use canonical team order`);
    seen.add(candidate);
    previous = candidate;
  }
  return value as string[];
}

interface VictoryValidationContext {
  readonly teamIds: ReadonlySet<string>;
  readonly players: readonly Record<string, unknown>[];
  readonly width: number;
  readonly height: number;
  readonly tick: number;
  readonly phase: string;
  readonly stateWinningTeamIds: readonly string[];
  readonly stateFinishReason: string | null;
}

function assertVictoryState(value: unknown, context: VictoryValidationContext): VictoryPolicyValidationResult {
  const victory = assertRecord(value, "state.victory");
  assertExactKeys(victory, ["policy", "teams", "control", "outcome", "winningTeamIds", "finishReason", "triggeredReasons", "finishedAtTick"], "state.victory");
  const policy = assertVictoryPolicy(victory.policy, context.width, context.height);
  if (!Array.isArray(victory.teams) || victory.teams.length !== context.teamIds.size) fail("INVALID_SCHEMA", "state.victory.teams must contain every team exactly once");
  const seenTeams = new Set<string>();
  let previousTeamId: string | null = null;
  for (const [index, progressValue] of victory.teams.entries()) {
    const progress = assertRecord(progressValue, `state.victory.teams[${index}]`);
    assertExactKeys(progress, ["teamId", "landmarkHoldTicks", "timedControlScoreTicks", "eliminatedAtTick", "eliminationReason"], `state.victory.teams[${index}]`);
    assertNonEmptyString(progress.teamId, `state.victory.teams[${index}].teamId`);
    if (!context.teamIds.has(progress.teamId) || seenTeams.has(progress.teamId)) fail("INVALID_SCHEMA", "state.victory.teams has an unknown or duplicate team");
    if (previousTeamId !== null && compareText(previousTeamId, progress.teamId) >= 0) fail("INVALID_SCHEMA", "state.victory.teams must use canonical team order");
    seenTeams.add(progress.teamId);
    previousTeamId = progress.teamId;
    assertNonNegativeSafeInteger(progress.landmarkHoldTicks, `state.victory.teams[${index}].landmarkHoldTicks`);
    assertNonNegativeSafeInteger(progress.timedControlScoreTicks, `state.victory.teams[${index}].timedControlScoreTicks`);
    if (policy.landmarkHoldTicks === null) {
      if (progress.landmarkHoldTicks !== 0) fail("INVALID_SCHEMA", "state.victory landmark progress exists without a policy");
    } else if ((progress.landmarkHoldTicks as number) > policy.landmarkHoldTicks) {
      fail("INVALID_SCHEMA", "state.victory landmark progress exceeds its target");
    }
    if (policy.timedControlTargetTicks === null) {
      if (progress.timedControlScoreTicks !== 0) fail("INVALID_SCHEMA", "state.victory control progress exists without a policy");
    } else if ((progress.timedControlScoreTicks as number) > policy.timedControlTargetTicks) {
      fail("INVALID_SCHEMA", "state.victory control progress exceeds its target");
    }
    if (progress.eliminatedAtTick !== null) {
      assertNonNegativeSafeInteger(progress.eliminatedAtTick, `state.victory.teams[${index}].eliminatedAtTick`);
      if ((progress.eliminatedAtTick as number) > context.tick) fail("INVALID_SCHEMA", "state.victory team elimination tick is in the future");
    }
    assertEliminationReason(progress.eliminationReason, `state.victory.teams[${index}].eliminationReason`, true);
    if ((progress.eliminatedAtTick === null) !== (progress.eliminationReason === null)) fail("INVALID_SCHEMA", "state.victory team elimination fields are inconsistent");
    const teamPlayers = context.players.filter((player) => player.teamId === progress.teamId);
    if (progress.eliminatedAtTick !== null && teamPlayers.some((player) => player.eliminated !== true)) {
      fail("INVALID_SCHEMA", "state.victory eliminated team still has a non-eliminated player");
    }
  }

  const control = assertRecord(victory.control, "state.victory.control");
  assertExactKeys(control, ["controllerTeamId", "contested"], "state.victory.control");
  if (control.controllerTeamId !== null && (typeof control.controllerTeamId !== "string" || !context.teamIds.has(control.controllerTeamId))) {
    fail("INVALID_SCHEMA", "state.victory.control.controllerTeamId is unknown");
  }
  if (typeof control.contested !== "boolean") fail("INVALID_SCHEMA", "state.victory.control.contested must be boolean");
  if (control.contested && control.controllerTeamId !== null) fail("INVALID_SCHEMA", "state.victory control cannot be contested and controlled");
  if (policy.timedControlTargetTicks === null && (control.controllerTeamId !== null || control.contested)) {
    fail("INVALID_SCHEMA", "state.victory control state exists without a timed-control policy");
  }

  if (victory.outcome !== null && victory.outcome !== "victory" && victory.outcome !== "draw") fail("INVALID_SCHEMA", "state.victory.outcome is invalid");
  const winningTeamIds = assertTeamIdArray(victory.winningTeamIds, context.teamIds, "state.victory.winningTeamIds");
  if (!sameStringArray(winningTeamIds, context.stateWinningTeamIds)) fail("INVALID_SCHEMA", "state winningTeamIds differs from victory state");
  assertFinishReason(victory.finishReason, "state.victory.finishReason", true);
  if (victory.finishReason !== context.stateFinishReason) fail("INVALID_SCHEMA", "state finishReason differs from victory state");
  if (!Array.isArray(victory.triggeredReasons)) fail("INVALID_SCHEMA", "state.victory.triggeredReasons must be an array");
  const triggeredReasons = new Set<string>();
  for (const [index, reason] of victory.triggeredReasons.entries()) {
    assertFinishReason(reason, `state.victory.triggeredReasons[${index}]`, false);
    if (triggeredReasons.has(reason as string)) fail("INVALID_SCHEMA", "state.victory.triggeredReasons contains duplicates");
    triggeredReasons.add(reason as string);
  }
  if (victory.finishedAtTick !== null) {
    assertNonNegativeSafeInteger(victory.finishedAtTick, "state.victory.finishedAtTick");
    if ((victory.finishedAtTick as number) !== context.tick) fail("INVALID_SCHEMA", "state.victory.finishedAtTick differs from state.tick");
  }

  if (context.phase === "finished") {
    if (victory.outcome === null || victory.finishReason === null || victory.finishedAtTick === null || victory.triggeredReasons.length === 0) {
      fail("INVALID_SCHEMA", "finished state has incomplete victory outcome");
    }
    if (victory.triggeredReasons[0] !== victory.finishReason) fail("INVALID_SCHEMA", "state.victory.finishReason must be the primary triggered reason");
    if (victory.outcome === "victory" && winningTeamIds.length !== 1) fail("INVALID_SCHEMA", "victory outcome must have exactly one winning team");
    if (victory.outcome === "draw" && winningTeamIds.length === 1) fail("INVALID_SCHEMA", "draw outcome cannot have exactly one winning team");
    if (victory.outcome === "victory") {
      const winningTeamId = winningTeamIds[0]!;
      const winningPlayers = context.players.filter((player) => player.teamId === winningTeamId);
      const winningProgress = (victory.teams as unknown[])
        .map((candidate) => candidate as Record<string, unknown>)
        .find((candidate) => candidate.teamId === winningTeamId);
      if (winningPlayers.length === 0
        || winningPlayers.every((player) => player.eliminated === true)
        || !winningProgress
        || winningProgress.eliminatedAtTick !== null) {
        fail("INVALID_SCHEMA", "victory outcome cannot name an eliminated winning team");
      }
    }
  } else if (victory.outcome !== null || winningTeamIds.length !== 0 || victory.finishReason !== null || victory.triggeredReasons.length !== 0 || victory.finishedAtTick !== null) {
    fail("INVALID_SCHEMA", "unfinished state contains a finished victory outcome");
  }
  return policy;
}

interface VictoryPolicyValidationResult {
  readonly commandCenterConquestEnabled: boolean;
  readonly landmarkHoldTicks: number | null;
  readonly timedControlTargetTicks: number | null;
}

function assertVictoryPolicy(value: unknown, width: number, height: number): VictoryPolicyValidationResult {
  const policy = assertRecord(value, "state.victory.policy");
  assertExactKeys(policy, ["commandCenterConquest", "elimination", "landmark", "timedControl"], "state.victory.policy");
  if (policy.commandCenterConquest !== null) {
    const conquest = assertRecord(policy.commandCenterConquest, "state.victory.policy.commandCenterConquest");
    assertExactKeys(conquest, ["rebuildGraceTicks"], "state.victory.policy.commandCenterConquest");
    assertNonNegativeSafeInteger(conquest.rebuildGraceTicks, "state.victory.policy.commandCenterConquest.rebuildGraceTicks");
  }
  if (typeof policy.elimination !== "boolean") fail("INVALID_SCHEMA", "state.victory.policy.elimination must be boolean");
  let landmarkHoldTicks: number | null = null;
  if (policy.landmark !== null) {
    const landmark = assertRecord(policy.landmark, "state.victory.policy.landmark");
    assertExactKeys(landmark, ["buildingType", "requiredCount", "holdTicks"], "state.victory.policy.landmark");
    if (landmark.buildingType !== "copperLandmark") fail("INVALID_SCHEMA", "state.victory.policy.landmark.buildingType is invalid");
    assertPositiveSafeInteger(landmark.requiredCount, "state.victory.policy.landmark.requiredCount");
    assertPositiveSafeInteger(landmark.holdTicks, "state.victory.policy.landmark.holdTicks");
    landmarkHoldTicks = landmark.holdTicks as number;
  }
  let timedControlTargetTicks: number | null = null;
  if (policy.timedControl !== null) {
    const timed = assertRecord(policy.timedControl, "state.victory.policy.timedControl");
    assertExactKeys(timed, ["point", "radius", "startsAtTick", "targetTicks"], "state.victory.policy.timedControl");
    assertPoint(timed.point, width, height, "state.victory.policy.timedControl.point", true);
    assertPositiveSafeInteger(timed.radius, "state.victory.policy.timedControl.radius");
    if ((timed.radius as number) > Math.max(width, height)) fail("INVALID_SCHEMA", "state.victory.policy.timedControl.radius exceeds the map");
    assertNonNegativeSafeInteger(timed.startsAtTick, "state.victory.policy.timedControl.startsAtTick");
    assertPositiveSafeInteger(timed.targetTicks, "state.victory.policy.timedControl.targetTicks");
    timedControlTargetTicks = timed.targetTicks as number;
  }
  return { commandCenterConquestEnabled: policy.commandCenterConquest !== null, landmarkHoldTicks, timedControlTargetTicks };
}

function assertFinishReason(value: unknown, label: string, nullable: boolean): void {
  if (nullable && value === null) return;
  if (!isOneOf(value, ["conquest", "elimination", "landmark", "timedControl", "surrender", "disconnect"])) fail("INVALID_SCHEMA", `${label} is invalid`);
}

function assertEliminationReason(value: unknown, label: string, nullable: boolean): void {
  if (nullable && value === null) return;
  if (!isOneOf(value, ["conquest", "elimination", "surrender", "disconnect"])) fail("INVALID_SCHEMA", `${label} is invalid`);
}

function sameStringArray(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

interface ProjectileValidationContext {
  readonly label: string;
  readonly width: number;
  readonly height: number;
  readonly tick: number;
  readonly playerIds: ReadonlySet<string>;
}

function assertProjectileState(projectile: Record<string, unknown>, context: ProjectileValidationContext): void {
  assertExactKeys(projectile, [
    "id", "ownerId", "sourceId", "profileId", "origin", "position", "targetId", "targetPoint",
    "fixedImpact", "launchTick", "impactTick", "damage", "statusEffects", "resolution",
  ], context.label);
  assertNonEmptyString(projectile.id, `${context.label}.id`);
  assertKnownPlayerOwner(projectile.ownerId, context.playerIds, `${context.label}.ownerId`);
  assertNonEmptyString(projectile.sourceId, `${context.label}.sourceId`);
  if (projectile.targetId !== null) assertNonEmptyString(projectile.targetId, `${context.label}.targetId`);
  if (!hasOwn(PROJECTILE_PROFILES, projectile.profileId)) fail("INVALID_SCHEMA", `${context.label}.profileId is invalid`);
  const profile = PROJECTILE_PROFILES[projectile.profileId as keyof typeof PROJECTILE_PROFILES];
  if (profile.kind === "hitscan") fail("INVALID_SCHEMA", `${context.label}.profileId resolves in the launch tick and cannot be persisted`);
  assertPoint(projectile.origin, context.width, context.height, `${context.label}.origin`, true);
  assertPoint(projectile.position, context.width, context.height, `${context.label}.position`, true);
  assertPoint(projectile.targetPoint, context.width, context.height, `${context.label}.targetPoint`, true);
  if (typeof projectile.fixedImpact !== "boolean") fail("INVALID_SCHEMA", `${context.label}.fixedImpact must be boolean`);
  assertNonNegativeSafeInteger(projectile.launchTick, `${context.label}.launchTick`);
  assertNonNegativeSafeInteger(projectile.impactTick, `${context.label}.impactTick`);
  if ((projectile.launchTick as number) > context.tick) fail("INVALID_SCHEMA", `${context.label}.launchTick is in the future`);
  if ((projectile.impactTick as number) <= (projectile.launchTick as number) || (projectile.impactTick as number) <= context.tick) {
    fail("INVALID_SCHEMA", `${context.label}.impactTick is not a future impact after launch`);
  }
  if (!Array.isArray(projectile.statusEffects)) fail("INVALID_SCHEMA", `${context.label}.statusEffects must be an array`);
  const statusIds = new Set<string>();
  for (const [index, statusId] of projectile.statusEffects.entries()) {
    if (!hasOwn(STATUS_EFFECTS, statusId)) fail("INVALID_SCHEMA", `${context.label}.statusEffects[${index}] is invalid`);
    if (statusIds.has(statusId as string)) fail("INVALID_SCHEMA", `${context.label}.statusEffects contains duplicates`);
    statusIds.add(statusId as string);
  }
  if (projectile.resolution === null) {
    if (projectile.profileId === "pinningVolley" || projectile.profileId === "breachingBolt") {
      fail("INVALID_SCHEMA", `${context.label}.profileId requires its discriminated resolution payload`);
    }
    assertPositiveSafeInteger(projectile.damage, `${context.label}.damage`);
    return;
  }
  if (projectile.fixedImpact !== true || projectile.targetId !== null || projectile.damage !== 0) {
    fail("INVALID_SCHEMA", `${context.label} resolving projectile has inconsistent impact fields`);
  }
  const resolution = assertRecord(projectile.resolution, `${context.label}.resolution`);
  if (resolution.kind === "groundArea") {
    assertExactKeys(resolution, ["kind", "groupId", "hitAll", "maxHitsPerTarget", "radiusSquared", "damage"], `${context.label}.resolution`);
    if (projectile.profileId !== "pinningVolley" && projectile.profileId !== "arcaneCinder") fail("INVALID_SCHEMA", `${context.label} ground-area profile is invalid`);
    assertNonEmptyString(resolution.groupId, `${context.label}.resolution.groupId`);
    if (typeof resolution.hitAll !== "boolean") fail("INVALID_SCHEMA", `${context.label}.resolution.hitAll must be boolean`);
    assertPositiveSafeInteger(resolution.maxHitsPerTarget, `${context.label}.resolution.maxHitsPerTarget`);
    if ((resolution.maxHitsPerTarget as number) > profile.maxTargets) fail("INVALID_SCHEMA", `${context.label}.resolution.maxHitsPerTarget exceeds its profile`);
    assertPositiveFiniteNumber(resolution.radiusSquared, `${context.label}.resolution.radiusSquared`);
    if ((resolution.radiusSquared as number) > context.width * context.width + context.height * context.height) fail("INVALID_SCHEMA", `${context.label}.resolution.radiusSquared exceeds the map`);
    assertProjectileDamageSpec(
      resolution.damage,
      "ground",
      projectile.profileId as keyof typeof PROJECTILE_PROFILES,
      `${context.label}.resolution.damage`,
    );
    return;
  }
  if (resolution.kind === "line") {
    assertExactKeys(resolution, ["kind", "origin", "maxTargets", "halfWidth", "lastResolvedDistance", "hitTargetIds", "damage"], `${context.label}.resolution`);
    if (projectile.profileId !== "breachingBolt") fail("INVALID_SCHEMA", `${context.label} line profile is invalid`);
    assertPoint(resolution.origin, context.width, context.height, `${context.label}.resolution.origin`, true);
    if (!samePointRecord(resolution.origin, projectile.origin)) fail("INVALID_SCHEMA", `${context.label}.resolution.origin differs from projectile.origin`);
    assertPositiveSafeInteger(resolution.maxTargets, `${context.label}.resolution.maxTargets`);
    if ((resolution.maxTargets as number) > profile.maxTargets) fail("INVALID_SCHEMA", `${context.label}.resolution.maxTargets exceeds its profile`);
    assertPositiveFiniteNumber(resolution.halfWidth, `${context.label}.resolution.halfWidth`);
    if ((resolution.halfWidth as number) > Math.max(context.width, context.height)) fail("INVALID_SCHEMA", `${context.label}.resolution.halfWidth exceeds the map`);
    assertNonNegativeFiniteNumber(resolution.lastResolvedDistance, `${context.label}.resolution.lastResolvedDistance`);
    const origin = resolution.origin as { x: number; y: number };
    const target = projectile.targetPoint as { x: number; y: number };
    if ((resolution.lastResolvedDistance as number) > Math.hypot(target.x - origin.x, target.y - origin.y) + Number.EPSILON) {
      fail("INVALID_SCHEMA", `${context.label}.resolution.lastResolvedDistance exceeds its line`);
    }
    if (!Array.isArray(resolution.hitTargetIds) || resolution.hitTargetIds.length > (resolution.maxTargets as number)) fail("INVALID_SCHEMA", `${context.label}.resolution.hitTargetIds is invalid`);
    const hitIds = new Set<string>();
    for (const [index, hitId] of resolution.hitTargetIds.entries()) {
      assertNonEmptyString(hitId, `${context.label}.resolution.hitTargetIds[${index}]`);
      if (hitIds.has(hitId)) fail("INVALID_SCHEMA", `${context.label}.resolution.hitTargetIds contains duplicates`);
      hitIds.add(hitId);
    }
    assertProjectileDamageSpec(
      resolution.damage,
      "line",
      projectile.profileId as keyof typeof PROJECTILE_PROFILES,
      `${context.label}.resolution.damage`,
    );
    return;
  }
  fail("INVALID_SCHEMA", `${context.label}.resolution.kind is invalid`);
}

function assertProjectileDamageSpec(
  value: unknown,
  resolutionKind: "ground" | "line",
  profileId: keyof typeof PROJECTILE_PROFILES,
  label: string,
): void {
  const damage = assertRecord(value, label);
  assertExactKeys(damage, ["sourceUnitType", "baseDamage", "abilityId", "skillMultiplier", "structureMultiplierBonus"], label);
  if (!hasOwn(COMBAT_UNITS, damage.sourceUnitType)) fail("INVALID_SCHEMA", `${label}.sourceUnitType is invalid`);
  const unit = COMBAT_UNITS[damage.sourceUnitType as keyof typeof COMBAT_UNITS];
  if (damage.abilityId !== unit.activeAbility.id) fail("INVALID_SCHEMA", `${label}.abilityId does not match sourceUnitType`);
  if ((resolutionKind === "ground" && unit.activeAbility.targeting !== "ground") || (resolutionKind === "line" && unit.activeAbility.targeting !== "direction")) {
    fail("INVALID_SCHEMA", `${label}.sourceUnitType ability does not match resolution kind`);
  }
  const expectedCombination = profileId === "pinningVolley"
    ? { sourceUnitType: "archer", abilityId: "pinningVolley" }
    : profileId === "arcaneCinder" && resolutionKind === "ground"
      ? { sourceUnitType: "mage", abilityId: "emberSigil" }
      : profileId === "breachingBolt" && resolutionKind === "line"
        ? { sourceUnitType: "heavyCrossbowman", abilityId: "breachingBolt" }
        : null;
  if (expectedCombination === null
    || damage.sourceUnitType !== expectedCombination.sourceUnitType
    || damage.abilityId !== expectedCombination.abilityId) {
    fail("INVALID_SCHEMA", `${label} does not match its projectile profile and ability`);
  }
  assertPositiveSafeInteger(damage.baseDamage, `${label}.baseDamage`);
  assertPositiveFiniteNumber(damage.skillMultiplier, `${label}.skillMultiplier`);
  assertPositiveFiniteNumber(damage.structureMultiplierBonus, `${label}.structureMultiplierBonus`);
  if ((damage.skillMultiplier as number) > 10 || (damage.structureMultiplierBonus as number) > 10) fail("INVALID_SCHEMA", `${label} multiplier is out of range`);
}

function samePointRecord(left: unknown, right: unknown): boolean {
  const leftPoint = left as Record<string, unknown>;
  const rightPoint = right as Record<string, unknown>;
  return leftPoint.x === rightPoint.x && leftPoint.y === rightPoint.y;
}

interface EntityValidationContext {
  readonly label: string;
  readonly width: number;
  readonly height: number;
  readonly playerIds: ReadonlySet<string>;
  readonly teamIds: ReadonlySet<string>;
  readonly entityIds: ReadonlySet<string>;
  readonly players: readonly Record<string, unknown>[];
}

function assertEntityState(
  entity: Record<string, unknown>,
  kind: "unit" | "building" | "resource" | "rubble" | "monster",
  context: EntityValidationContext,
): void {
  const commonKeys = ["id", "ownerId", "kind", "typeId", "position", "hitPoints", "maxHitPoints", "stateRevision"];
  const specificKeys = kind === "unit"
    ? ["order", "movementProgress", "attackCooldownTicks", "workCooldownTicks", "facing", "stance", "formation", "combat", "abilityReadyTick", "passive", "statuses", "cargo", "cargoCapacity", "gatherRemainderMilli"]
    : kind === "building"
      ? ["complete", "constructionRemainingTicks", "attackCooldownTicks", "statuses", "rallyPoint", "productionQueue", "orientation", "gateOpen"]
      : kind === "resource"
        ? ["amount", "renewAtTick"]
        : kind === "rubble"
          ? ["orientation", "decayAtTick"]
          : ["home", "facing", "statuses", "combat", "movementProgress", "attackCooldownTicks", "abilityReadyTick", "camouflageReady", "camouflageSpeedUntilTick", "leashRadius", "provokedByTeamId", "provokedAtTick", "targetId", "contributions", "rewardGranted"];
  assertExactKeys(entity, [...commonKeys, ...specificKeys], context.label);
  assertNonEmptyString(entity.id, `${context.label}.id`);
  assertPoint(entity.position, context.width, context.height, `${context.label}.position`, true);
  assertNonNegativeSafeInteger(entity.hitPoints, `${context.label}.hitPoints`);
  if (kind === "rubble") assertNonNegativeSafeInteger(entity.maxHitPoints, `${context.label}.maxHitPoints`);
  else assertPositiveSafeInteger(entity.maxHitPoints, `${context.label}.maxHitPoints`);
  if ((entity.hitPoints as number) > (entity.maxHitPoints as number)) fail("INVALID_SCHEMA", `${context.label}.hitPoints exceeds maxHitPoints`);
  assertNonNegativeSafeInteger(entity.stateRevision, `${context.label}.stateRevision`);

  if (kind === "unit") {
    assertKnownPlayerOwner(entity.ownerId, context.playerIds, `${context.label}.ownerId`);
    if (!hasOwn(UNITS, entity.typeId)) fail("INVALID_SCHEMA", `${context.label}.typeId is not a registered unit`);
    assertUnitOrder(entity.order, context);
    assertMovementProgress(entity.movementProgress, `${context.label}.movementProgress`);
    assertNonNegativeSafeInteger(entity.attackCooldownTicks, `${context.label}.attackCooldownTicks`);
    assertNonNegativeSafeInteger(entity.workCooldownTicks, `${context.label}.workCooldownTicks`);
    assertFacing(entity.facing, `${context.label}.facing`);
    if (!isOneOf(entity.stance, ["aggressive", "defensive", "holdGround"])) fail("INVALID_SCHEMA", `${context.label}.stance is invalid`);
    if (!isOneOf(entity.formation, ["line", "wedge", "box"])) fail("INVALID_SCHEMA", `${context.label}.formation is invalid`);
    const ability = entity.typeId === "villager" ? null : COMBAT_UNITS[entity.typeId as keyof typeof COMBAT_UNITS].activeAbility;
    assertCombatState(entity.combat, ability, true, context, `${context.label}.combat`);
    assertNonNegativeSafeInteger(entity.abilityReadyTick, `${context.label}.abilityReadyTick`);
    assertUnitPassive(entity.passive, `${context.label}.passive`);
    assertStatuses(entity.statuses, context.playerIds, `${context.label}.statuses`);
    const cargo = assertRecord(entity.cargo, `${context.label}.cargo`);
    assertExactKeys(cargo, ["kind", "amount"], `${context.label}.cargo`);
    if (cargo.kind !== null && !hasOwn(RESOURCE_NODES, cargo.kind)) fail("INVALID_SCHEMA", `${context.label}.cargo.kind is invalid`);
    assertNonNegativeSafeInteger(cargo.amount, `${context.label}.cargo.amount`);
    assertNonNegativeSafeInteger(entity.cargoCapacity, `${context.label}.cargoCapacity`);
    if ((cargo.amount as number) > (entity.cargoCapacity as number)) fail("INVALID_SCHEMA", `${context.label}.cargo exceeds capacity`);
    if (cargo.kind === null && cargo.amount !== 0) fail("INVALID_SCHEMA", `${context.label}.cargo without a kind must be empty`);
    assertWallet(entity.gatherRemainderMilli, `${context.label}.gatherRemainderMilli`);
    const remainder = entity.gatherRemainderMilli as Record<string, number>;
    if (Object.values(remainder).some((amount) => amount >= 1_000)) fail("INVALID_SCHEMA", `${context.label}.gatherRemainderMilli must be below 1000`);
    return;
  }

  if (kind === "building") {
    assertKnownPlayerOwner(entity.ownerId, context.playerIds, `${context.label}.ownerId`);
    if (!hasOwn(BUILDINGS, entity.typeId)) fail("INVALID_SCHEMA", `${context.label}.typeId is not a registered building`);
    if (typeof entity.complete !== "boolean") fail("INVALID_SCHEMA", `${context.label}.complete must be boolean`);
    assertNonNegativeSafeInteger(entity.constructionRemainingTicks, `${context.label}.constructionRemainingTicks`);
    if (entity.complete && entity.constructionRemainingTicks !== 0) fail("INVALID_SCHEMA", `${context.label} complete building has construction time remaining`);
    assertNonNegativeSafeInteger(entity.attackCooldownTicks, `${context.label}.attackCooldownTicks`);
    assertStatuses(entity.statuses, context.playerIds, `${context.label}.statuses`);
    if (entity.rallyPoint !== null) assertPoint(entity.rallyPoint, context.width, context.height, `${context.label}.rallyPoint`, true);
    assertProductionQueue(entity.productionQueue, `${context.label}.productionQueue`);
    assertOrientation(entity.orientation, `${context.label}.orientation`);
    assertBuildingFootprintInBounds(
      entity.typeId as keyof typeof BUILDINGS,
      entity.orientation as "ne" | "se",
      entity.position as { x: number; y: number },
      context.width,
      context.height,
      context.label,
    );
    if (typeof entity.gateOpen !== "boolean") fail("INVALID_SCHEMA", `${context.label}.gateOpen must be boolean`);
    return;
  }

  if (entity.ownerId !== null) fail("INVALID_SCHEMA", `${context.label}.ownerId must be null`);
  if (kind === "resource") {
    if (!hasOwn(RESOURCE_NODES, entity.typeId)) fail("INVALID_SCHEMA", `${context.label}.typeId is not a registered resource`);
    assertNonNegativeSafeInteger(entity.amount, `${context.label}.amount`);
    if (entity.amount !== entity.hitPoints) fail("INVALID_SCHEMA", `${context.label}.amount and hitPoints differ`);
    if (entity.renewAtTick !== null) assertNonNegativeSafeInteger(entity.renewAtTick, `${context.label}.renewAtTick`);
    return;
  }
  if (kind === "rubble") {
    if (!hasOwn(BUILDINGS, entity.typeId)) fail("INVALID_SCHEMA", `${context.label}.typeId is not a registered rubble building`);
    if (entity.hitPoints !== 0 || entity.maxHitPoints !== 0) fail("INVALID_SCHEMA", `${context.label} rubble health must be zero`);
    assertOrientation(entity.orientation, `${context.label}.orientation`);
    assertNonNegativeSafeInteger(entity.decayAtTick, `${context.label}.decayAtTick`);
    return;
  }

  if (!hasOwn(MONSTERS, entity.typeId)) fail("INVALID_SCHEMA", `${context.label}.typeId is not a registered monster`);
  assertPoint(entity.home, context.width, context.height, `${context.label}.home`, true);
  assertFacing(entity.facing, `${context.label}.facing`);
  assertStatuses(entity.statuses, context.playerIds, `${context.label}.statuses`);
  assertCombatState(entity.combat, MONSTERS[entity.typeId as keyof typeof MONSTERS].activeAbility, false, context, `${context.label}.combat`);
  assertMovementProgress(entity.movementProgress, `${context.label}.movementProgress`);
  assertNonNegativeSafeInteger(entity.attackCooldownTicks, `${context.label}.attackCooldownTicks`);
  assertNonNegativeSafeInteger(entity.abilityReadyTick, `${context.label}.abilityReadyTick`);
  if (typeof entity.camouflageReady !== "boolean") fail("INVALID_SCHEMA", `${context.label}.camouflageReady must be boolean`);
  assertNonNegativeSafeInteger(entity.camouflageSpeedUntilTick, `${context.label}.camouflageSpeedUntilTick`);
  assertPositiveSafeInteger(entity.leashRadius, `${context.label}.leashRadius`);
  if (entity.provokedByTeamId !== null && (typeof entity.provokedByTeamId !== "string" || !context.teamIds.has(entity.provokedByTeamId))) {
    fail("INVALID_SCHEMA", `${context.label}.provokedByTeamId is invalid`);
  }
  if (entity.provokedAtTick !== null) assertNonNegativeSafeInteger(entity.provokedAtTick, `${context.label}.provokedAtTick`);
  if ((entity.provokedByTeamId === null) !== (entity.provokedAtTick === null)) fail("INVALID_SCHEMA", `${context.label} provocation fields are inconsistent`);
  if (entity.targetId !== null) assertNonEmptyString(entity.targetId, `${context.label}.targetId`);
  assertMonsterContributions(entity.contributions, context);
  if (typeof entity.rewardGranted !== "boolean") fail("INVALID_SCHEMA", `${context.label}.rewardGranted must be boolean`);
}

function assertUnitOrder(value: unknown, context: EntityValidationContext): void {
  const order = assertRecord(value, `${context.label}.order`);
  if (order.type === "idle") {
    assertExactKeys(order, ["type"], `${context.label}.order`);
  } else if (order.type === "move") {
    assertExactKeys(order, ["type", "target"], `${context.label}.order`);
    assertPoint(order.target, context.width, context.height, `${context.label}.order.target`, true);
  } else if (order.type === "attackMove") {
    assertExactKeys(order, ["type", "target", "engagedTargetId"], `${context.label}.order`);
    assertPoint(order.target, context.width, context.height, `${context.label}.order.target`, true);
    if (order.engagedTargetId !== null) assertNonEmptyString(order.engagedTargetId, `${context.label}.order.engagedTargetId`);
  } else if (order.type === "attack" || order.type === "deliver" || order.type === "construct" || order.type === "repair") {
    assertExactKeys(order, ["type", "targetId"], `${context.label}.order`);
    assertNonEmptyString(order.targetId, `${context.label}.order.targetId`);
  } else if (order.type === "gather") {
    assertExactKeys(order, ["type", "targetId", "resourceKind", "phase", "dropOffId"], `${context.label}.order`);
    assertNonEmptyString(order.targetId, `${context.label}.order.targetId`);
    if (!hasOwn(RESOURCE_NODES, order.resourceKind)) fail("INVALID_SCHEMA", `${context.label}.order.resourceKind is invalid`);
    if (!isOneOf(order.phase, ["toSource", "toDropOff"])) fail("INVALID_SCHEMA", `${context.label}.order.phase is invalid`);
    if (order.dropOffId !== null) assertNonEmptyString(order.dropOffId, `${context.label}.order.dropOffId`);
  } else if (order.type === "patrol") {
    assertExactKeys(order, ["type", "waypoints", "waypointIndex"], `${context.label}.order`);
    if (!Array.isArray(order.waypoints) || order.waypoints.length === 0 || order.waypoints.length > MATCH_PERSISTENCE_MAX_MAP_TILES) {
      fail("INVALID_SCHEMA", `${context.label}.order.waypoints is invalid`);
    }
    for (const [index, point] of order.waypoints.entries()) assertPoint(point, context.width, context.height, `${context.label}.order.waypoints[${index}]`, true);
    assertNonNegativeSafeInteger(order.waypointIndex, `${context.label}.order.waypointIndex`);
    if ((order.waypointIndex as number) >= order.waypoints.length) fail("INVALID_SCHEMA", `${context.label}.order.waypointIndex is out of range`);
  } else {
    fail("INVALID_SCHEMA", `${context.label}.order.type is invalid`);
  }
}

function assertCombatState(
  value: unknown,
  allowedAbility: { readonly id: string; readonly targeting: string } | null,
  allowBasicAttack: boolean,
  context: EntityValidationContext,
  label: string,
): void {
  const combat = assertRecord(value, label);
  assertExactKeys(combat, ["phase", "action", "abilityId", "target", "commitTick", "readyTick"], label);
  if (!isOneOf(combat.phase, ["windup", "commit", "recovery", "ready"])) fail("INVALID_SCHEMA", `${label}.phase is invalid`);
  if (!isOneOf(combat.action, ["attack", "ability", null])) fail("INVALID_SCHEMA", `${label}.action is invalid`);
  if (combat.abilityId !== null && (typeof combat.abilityId !== "string" || combat.abilityId !== allowedAbility?.id)) fail("INVALID_SCHEMA", `${label}.abilityId is invalid`);
  if (combat.action === "ability" && (allowedAbility === null || combat.abilityId !== allowedAbility.id)) fail("INVALID_SCHEMA", `${label} ability action has the wrong ability`);
  if (combat.action === "attack" && !allowBasicAttack) fail("INVALID_SCHEMA", `${label} cannot contain a basic attack action`);
  if (combat.action !== "ability" && combat.abilityId !== null) fail("INVALID_SCHEMA", `${label} non-ability action has an abilityId`);
  if (combat.target !== null) assertAbilityTarget(combat.target, context, `${label}.target`);
  if (combat.commitTick !== null) assertNonNegativeSafeInteger(combat.commitTick, `${label}.commitTick`);
  assertNonNegativeSafeInteger(combat.readyTick, `${label}.readyTick`);
  if (combat.phase === "ready" && (combat.action !== null || combat.target !== null || combat.commitTick !== null || combat.readyTick !== 0)) {
    fail("INVALID_SCHEMA", `${label} ready state is not canonical`);
  }
  if (combat.phase !== "ready" && (combat.action === null || combat.target === null || combat.commitTick === null || combat.readyTick === 0)) {
    fail("INVALID_SCHEMA", `${label} active state is incomplete`);
  }
  if (combat.action === "attack" && (combat.target as Record<string, unknown> | null)?.kind !== "entity") {
    fail("INVALID_SCHEMA", `${label} basic attack target must be an entity`);
  }
  if (combat.action === "ability" && allowedAbility && !abilityTargetMatches(allowedAbility.targeting, combat.target)) {
    fail("INVALID_SCHEMA", `${label} ability target does not match its registry definition`);
  }
}

function abilityTargetMatches(targeting: string, value: unknown): boolean {
  const target = value as Record<string, unknown> | null;
  return targeting === "self"
    ? target?.kind === "self"
    : targeting === "unit"
      ? target?.kind === "entity"
      : targeting === "ground"
        ? target?.kind === "ground"
        : targeting === "direction" && target?.kind === "direction";
}

function assertAbilityTarget(value: unknown, context: EntityValidationContext, label: string): void {
  const target = assertRecord(value, label);
  if (target.kind === "self") {
    assertExactKeys(target, ["kind"], label);
  } else if (target.kind === "entity") {
    assertExactKeys(target, ["kind", "entityId"], label);
    assertNonEmptyString(target.entityId, `${label}.entityId`);
  } else if (target.kind === "ground") {
    assertExactKeys(target, ["kind", "point"], label);
    assertPoint(target.point, context.width, context.height, `${label}.point`, true);
  } else if (target.kind === "direction") {
    assertExactKeys(target, ["kind", "vector"], label);
    const vector = assertGridVector(target.vector, `${label}.vector`);
    if (vector.x === 0 && vector.y === 0) fail("INVALID_SCHEMA", `${label}.vector cannot be zero`);
  } else {
    fail("INVALID_SCHEMA", `${label}.kind is invalid`);
  }
}

function assertUnitPassive(value: unknown, label: string): void {
  const passive = assertRecord(value, label);
  assertExactKeys(passive, ["stationarySinceTick", "movedTilesSinceAttack", "rhythmTargetId", "rhythmStacks", "rhythmLastHitTick", "braceCooldownUntilTick"], label);
  for (const key of ["stationarySinceTick", "movedTilesSinceAttack", "rhythmStacks", "rhythmLastHitTick", "braceCooldownUntilTick"] as const) {
    assertNonNegativeSafeInteger(passive[key], `${label}.${key}`);
  }
  if ((passive.rhythmStacks as number) > 3) fail("INVALID_SCHEMA", `${label}.rhythmStacks exceeds 3`);
  if (passive.rhythmTargetId !== null) assertNonEmptyString(passive.rhythmTargetId, `${label}.rhythmTargetId`);
}

function assertStatuses(value: unknown, playerIds: ReadonlySet<string>, label: string): void {
  if (!Array.isArray(value)) fail("INVALID_SCHEMA", `${label} must be an array`);
  const ids = new Set<string>();
  for (const [index, statusValue] of value.entries()) {
    const status = assertRecord(statusValue, `${label}[${index}]`);
    const keys = status.sourceOwnerId === undefined
      ? ["id", "sourceId", "expiresAtTick", "nextTickAt"]
      : ["id", "sourceId", "sourceOwnerId", "expiresAtTick", "nextTickAt"];
    assertExactKeys(status, keys, `${label}[${index}]`);
    if (!hasOwn(STATUS_EFFECTS, status.id)) fail("INVALID_SCHEMA", `${label}[${index}].id is invalid`);
    if (ids.has(status.id as string)) fail("INVALID_SCHEMA", `${label} contains duplicate status IDs`);
    ids.add(status.id as string);
    assertNonEmptyString(status.sourceId, `${label}[${index}].sourceId`);
    if (status.sourceOwnerId !== undefined && status.sourceOwnerId !== null) assertKnownPlayerOwner(status.sourceOwnerId, playerIds, `${label}[${index}].sourceOwnerId`);
    assertNonNegativeSafeInteger(status.expiresAtTick, `${label}[${index}].expiresAtTick`);
    if (status.nextTickAt !== null) assertNonNegativeSafeInteger(status.nextTickAt, `${label}[${index}].nextTickAt`);
  }
}

function assertProductionQueue(value: unknown, label: string): void {
  if (!Array.isArray(value) || value.length > MAX_TRAINING_QUEUE_DEPTH) fail("INVALID_SCHEMA", `${label} is invalid`);
  const jobIds = new Set<string>();
  for (const [index, jobValue] of value.entries()) {
    const job = assertRecord(jobValue, `${label}[${index}]`);
    if (job.kind === "train") {
      assertExactKeys(job, ["jobId", "kind", "unitType", "remainingTicks", "totalTicks", "paidCost"], `${label}[${index}]`);
      if (!hasOwn(UNITS, job.unitType)) fail("INVALID_SCHEMA", `${label}[${index}].unitType is invalid`);
    } else if (job.kind === "research") {
      assertExactKeys(job, ["jobId", "kind", "technologyId", "remainingTicks", "totalTicks", "paidCost"], `${label}[${index}]`);
      if (!hasOwn(TECHNOLOGIES, job.technologyId)) fail("INVALID_SCHEMA", `${label}[${index}].technologyId is invalid`);
    } else {
      fail("INVALID_SCHEMA", `${label}[${index}].kind is invalid`);
    }
    const jobId = assertRecord(job.jobId, `${label}[${index}].jobId`);
    assertExactKeys(jobId, ["commandSequence", "itemIndex"], `${label}[${index}].jobId`);
    assertNonNegativeSafeInteger(jobId.commandSequence, `${label}[${index}].jobId.commandSequence`);
    assertNonNegativeSafeInteger(jobId.itemIndex, `${label}[${index}].jobId.itemIndex`);
    const key = `${String(jobId.commandSequence)}:${String(jobId.itemIndex)}`;
    if (jobIds.has(key)) fail("INVALID_SCHEMA", `${label} contains duplicate job IDs`);
    jobIds.add(key);
    assertPositiveSafeInteger(job.remainingTicks, `${label}[${index}].remainingTicks`);
    assertPositiveSafeInteger(job.totalTicks, `${label}[${index}].totalTicks`);
    if ((job.remainingTicks as number) > (job.totalTicks as number)) fail("INVALID_SCHEMA", `${label}[${index}].remainingTicks exceeds totalTicks`);
    assertWallet(job.paidCost, `${label}[${index}].paidCost`);
  }
}

function assertMonsterContributions(value: unknown, context: EntityValidationContext): void {
  if (!Array.isArray(value)) fail("INVALID_SCHEMA", `${context.label}.contributions must be an array`);
  const seen = new Set<string>();
  const teamByPlayer = new Map(context.players.map((player) => [player.id as string, player.teamId as string]));
  for (const [index, contributionValue] of value.entries()) {
    const contribution = assertRecord(contributionValue, `${context.label}.contributions[${index}]`);
    assertExactKeys(contribution, ["playerId", "teamId", "actualDamage", "firstHitTick", "lastHitTick"], `${context.label}.contributions[${index}]`);
    assertKnownPlayerOwner(contribution.playerId, context.playerIds, `${context.label}.contributions[${index}].playerId`);
    if (contribution.teamId !== teamByPlayer.get(contribution.playerId as string)) fail("INVALID_SCHEMA", `${context.label}.contributions[${index}].teamId does not match its player`);
    if (seen.has(contribution.playerId as string)) fail("INVALID_SCHEMA", `${context.label}.contributions has duplicate players`);
    seen.add(contribution.playerId as string);
    assertPositiveSafeInteger(contribution.actualDamage, `${context.label}.contributions[${index}].actualDamage`);
    assertNonNegativeSafeInteger(contribution.firstHitTick, `${context.label}.contributions[${index}].firstHitTick`);
    assertNonNegativeSafeInteger(contribution.lastHitTick, `${context.label}.contributions[${index}].lastHitTick`);
    if ((contribution.firstHitTick as number) > (contribution.lastHitTick as number)) fail("INVALID_SCHEMA", `${context.label}.contributions hit ticks are reversed`);
  }
}

function assertMovementProgress(value: unknown, label: string): void {
  assertNonNegativeSafeInteger(value, label);
  if (value > 10_000) fail("INVALID_SCHEMA", `${label} exceeds one blocked movement step`);
}

function assertFacing(value: unknown, label: string): void {
  if (!FACING_DIRECTIONS.includes(value as (typeof FACING_DIRECTIONS)[number])) fail("INVALID_SCHEMA", `${label} is invalid`);
}

function assertOrientation(value: unknown, label: string): void {
  if (!isOneOf(value, ["ne", "se"])) fail("INVALID_SCHEMA", `${label} is invalid`);
}

function assertGridVector(value: unknown, label: string): { x: number; y: number } {
  const vector = assertRecord(value, label);
  assertExactKeys(vector, ["x", "y"], label);
  assertSafeInteger(vector.x, `${label}.x`);
  assertSafeInteger(vector.y, `${label}.y`);
  return vector as { x: number; y: number };
}

function isOneOf<T>(value: unknown, options: readonly T[]): value is T {
  return options.includes(value as T);
}

function hasOwn(record: object, key: unknown): key is string {
  return typeof key === "string" && Object.prototype.hasOwnProperty.call(record, key);
}

function assertCurrentRulesState(state: MatchState): void {
  assertMatchState(state);
  if (state.rulesVersion !== RULES_VERSION) fail("UNSUPPORTED_RULES_VERSION", `Unsupported state rules version: ${state.rulesVersion}`);
}

function assertRuntimeMetadata(value: unknown, state: MatchState): asserts value is MatchRuntimeSaveMetadata {
  const record = assertRecord(value, "runtime metadata");
  assertExactKeys(record, ["humanPlayerId", "nextPlayerSequence", "accumulatorMs", "aiBudgetMs"], "runtime metadata");
  assertNonEmptyString(record.humanPlayerId, "runtime.humanPlayerId");
  assertNonNegativeSafeInteger(record.nextPlayerSequence, "runtime.nextPlayerSequence");
  if (typeof record.accumulatorMs !== "number" || !Number.isFinite(record.accumulatorMs) || record.accumulatorMs < 0 || record.accumulatorMs >= TICK_MILLISECONDS) {
    fail("INVALID_SCHEMA", `runtime.accumulatorMs must be within [0, ${TICK_MILLISECONDS})`);
  }
  if (typeof record.aiBudgetMs !== "number" || !Number.isFinite(record.aiBudgetMs) || record.aiBudgetMs <= 0) {
    fail("INVALID_SCHEMA", "runtime.aiBudgetMs must be a finite positive number");
  }
  const player = state.players.find((candidate) => candidate.id === record.humanPlayerId);
  if (!player) fail("INVALID_SCHEMA", "runtime.humanPlayerId is not a match player");
  if ((record.nextPlayerSequence as number) <= player.lastSequence) {
    fail("INVALID_SCHEMA", "runtime.nextPlayerSequence must exceed the player's last accepted sequence");
  }
}

interface AiAuthorityValidationContext {
  readonly playerIds: ReadonlySet<string>;
  readonly width: number;
  readonly height: number;
  readonly tick: number;
}

function assertAiAuthority(value: unknown, context?: AiAuthorityValidationContext): asserts value is AiAuthorityState {
  const record = assertRecord(value, "AI authority");
  assertExactKeys(record, [
    "playerId", "personality", "difficulty", "randomState", "lastDecisionTick", "phase", "phaseStartedTick",
    "phaseLockedUntilTick", "enemyMemory", "desiredCounterUnit", "counterLockedUntilTick", "repairTargetId",
    "regroupPoint", "activeWave", "waveIndex", "nextWaveAtTick", "nextScoutAtTick", "scoutIndex", "telemetry",
  ], "AI authority");
  assertNonEmptyString(record.playerId, "authority.playerId");
  if (!["aggressor", "guardian", "prosperer", "balanced", "raider"].includes(record.personality as string)) fail("AI_AUTHORITY_INVALID", "AI personality is invalid");
  if (!["novice", "standard", "veteran"].includes(record.difficulty as string)) fail("AI_AUTHORITY_INVALID", "AI difficulty is invalid");
  if (!["economy", "scouting", "defending", "repairing", "assaulting", "retreating", "regrouping"].includes(record.phase as string)) fail("AI_AUTHORITY_INVALID", "AI phase is invalid");
  assertNonNegativeSafeInteger(record.randomState, "authority.randomState");
  assertSafeInteger(record.lastDecisionTick, "authority.lastDecisionTick");
  if ((record.lastDecisionTick as number) < -40 || (record.lastDecisionTick as number) > MATCH_PERSISTENCE_MAX_TICK) {
    fail("AI_AUTHORITY_INVALID", "authority.lastDecisionTick is out of range");
  }
  for (const key of ["phaseStartedTick", "phaseLockedUntilTick", "counterLockedUntilTick", "waveIndex", "nextWaveAtTick", "scoutIndex"] as const) {
    assertNonNegativeSafeInteger(record[key], `authority.${key}`);
  }
  assertSafeInteger(record.nextScoutAtTick, "authority.nextScoutAtTick");
  if ((record.nextScoutAtTick as number) < -1 || (record.nextScoutAtTick as number) > MATCH_PERSISTENCE_MAX_TICK) {
    fail("AI_AUTHORITY_INVALID", "authority.nextScoutAtTick is out of range");
  }
  if (context && !context.playerIds.has(record.playerId as string)) fail("AI_AUTHORITY_INVALID", "authority.playerId references an unknown player");
  if (context && (record.lastDecisionTick as number) > context.tick) fail("AI_AUTHORITY_INVALID", "authority.lastDecisionTick is in the future");
  if (context && (record.phaseStartedTick as number) > context.tick) fail("AI_AUTHORITY_INVALID", "authority.phaseStartedTick is in the future");
  if (record.desiredCounterUnit !== null && !hasOwn(COMBAT_UNITS, record.desiredCounterUnit)) fail("AI_AUTHORITY_INVALID", "authority.desiredCounterUnit is invalid");
  if (record.repairTargetId !== null) assertNonEmptyString(record.repairTargetId, "authority.repairTargetId");
  if (record.regroupPoint !== null) assertAuthorityPoint(record.regroupPoint, context, "authority.regroupPoint");
  if (!Array.isArray(record.enemyMemory)) fail("AI_AUTHORITY_INVALID", "authority.enemyMemory must be an array");
  const memoryIds = new Set<string>();
  for (const [index, memoryValue] of record.enemyMemory.entries()) {
    const memory = assertRecord(memoryValue, `authority.enemyMemory[${index}]`);
    const required = ["entityId", "ownerId", "kind", "typeId", "lastKnownPosition", "healthPermille", "observedAtTick"];
    const buildingOptional = ["orientation", "gateOpen", "complete", "healthBand", "blocksMovement"];
    assertRequiredAllowedKeys(memory, required, memory.kind === "building" ? [...required, ...buildingOptional] : required, `authority.enemyMemory[${index}]`);
    assertNonEmptyString(memory.entityId, `authority.enemyMemory[${index}].entityId`);
    if (memoryIds.has(memory.entityId as string)) fail("AI_AUTHORITY_INVALID", "authority.enemyMemory contains duplicate entity IDs");
    memoryIds.add(memory.entityId as string);
    assertNonEmptyString(memory.ownerId, `authority.enemyMemory[${index}].ownerId`);
    if (context && !context.playerIds.has(memory.ownerId as string)) fail("AI_AUTHORITY_INVALID", `authority.enemyMemory[${index}].ownerId is unknown`);
    if (memory.kind === "unit") {
      if (!hasOwn(UNITS, memory.typeId)) fail("AI_AUTHORITY_INVALID", `authority.enemyMemory[${index}].typeId is not a unit`);
    } else if (memory.kind === "building") {
      if (!hasOwn(BUILDINGS, memory.typeId)) fail("AI_AUTHORITY_INVALID", `authority.enemyMemory[${index}].typeId is not a building`);
      if (memory.orientation !== undefined) assertOrientation(memory.orientation, `authority.enemyMemory[${index}].orientation`);
      for (const key of ["gateOpen", "complete", "blocksMovement"] as const) {
        if (memory[key] !== undefined && typeof memory[key] !== "boolean") fail("AI_AUTHORITY_INVALID", `authority.enemyMemory[${index}].${key} must be boolean`);
      }
      if (memory.healthBand !== undefined && !isOneOf(memory.healthBand, ["healthy", "damaged", "critical", "destroyed"])) {
        fail("AI_AUTHORITY_INVALID", `authority.enemyMemory[${index}].healthBand is invalid`);
      }
    } else {
      fail("AI_AUTHORITY_INVALID", `authority.enemyMemory[${index}].kind is invalid`);
    }
    assertAuthorityPoint(memory.lastKnownPosition, context, `authority.enemyMemory[${index}].lastKnownPosition`);
    assertNonNegativeSafeInteger(memory.healthPermille, `authority.enemyMemory[${index}].healthPermille`);
    if ((memory.healthPermille as number) > 1_000) fail("AI_AUTHORITY_INVALID", `authority.enemyMemory[${index}].healthPermille exceeds 1000`);
    assertNonNegativeSafeInteger(memory.observedAtTick, `authority.enemyMemory[${index}].observedAtTick`);
    if (context && (memory.observedAtTick as number) > context.tick) {
      fail("AI_AUTHORITY_INVALID", `authority.enemyMemory[${index}].observedAtTick is in the future`);
    }
  }
  if (record.activeWave !== null) {
    const wave = assertRecord(record.activeWave, "authority.activeWave");
    assertExactKeys(wave, ["memberIds", "targetEntityId", "targetPosition", "launchedAtTick", "baselineStrength"], "authority.activeWave");
    if (!Array.isArray(wave.memberIds) || wave.memberIds.length === 0) fail("AI_AUTHORITY_INVALID", "authority.activeWave.memberIds must be a non-empty array");
    const memberIds = new Set<string>();
    for (const memberId of wave.memberIds) {
      assertNonEmptyString(memberId, "authority.activeWave.memberIds");
      if (memberIds.has(memberId)) fail("AI_AUTHORITY_INVALID", "authority.activeWave.memberIds contains duplicates");
      memberIds.add(memberId);
    }
    if (wave.targetEntityId !== null) assertNonEmptyString(wave.targetEntityId, "authority.activeWave.targetEntityId");
    assertAuthorityPoint(wave.targetPosition, context, "authority.activeWave.targetPosition");
    assertNonNegativeSafeInteger(wave.launchedAtTick, "authority.activeWave.launchedAtTick");
    if (context && (wave.launchedAtTick as number) > context.tick) fail("AI_AUTHORITY_INVALID", "authority.activeWave.launchedAtTick is in the future");
    assertPositiveSafeInteger(wave.baselineStrength, "authority.activeWave.baselineStrength");
  }
  const telemetry = assertRecord(record.telemetry, "authority.telemetry");
  assertExactKeys(telemetry, ["decisions", "scoutsSent", "repairsOrdered", "retreatsOrdered", "wavesLaunched", "counterSwitches"], "authority.telemetry");
  for (const key of ["decisions", "scoutsSent", "repairsOrdered", "retreatsOrdered", "wavesLaunched", "counterSwitches"] as const) {
    assertNonNegativeSafeInteger(telemetry[key], `authority.telemetry.${key}`);
  }
  assertJsonValue(record);
}

function assertAuthorityPoint(value: unknown, context: AiAuthorityValidationContext | undefined, label: string): void {
  if (context) {
    assertPoint(value, context.width, context.height, label, true);
    return;
  }
  const point = assertRecord(value, label);
  assertExactKeys(point, ["x", "y"], label);
  assertSafeInteger(point.x, `${label}.x`);
  assertSafeInteger(point.y, `${label}.y`);
}

function assertRequiredAllowedKeys(
  record: Record<string, unknown>,
  required: readonly string[],
  allowed: readonly string[],
  label: string,
): void {
  const actual = Object.keys(record);
  if (required.some((key) => !actual.includes(key)) || actual.some((key) => !allowed.includes(key))) {
    fail("INVALID_SCHEMA", `${label} has unknown or missing fields`);
  }
}

function parseArtifact<T>(serialized: string, maxBytes: number, label: string, assertArtifact: (value: unknown) => asserts value is T): T {
  if (typeof serialized !== "string") fail("INVALID_SCHEMA", `Serialized ${label} must be a string`);
  assertByteLimit(serialized, maxBytes, label);
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    fail("INVALID_JSON", `Serialized ${label} is not valid JSON`);
  }
  assertJsonValue(parsed);
  assertArtifact(parsed);
  return cloneJson(parsed);
}

function serializeWithLimit(value: unknown, maxBytes: number, label: string): string {
  const serialized = stableStringify(value);
  assertByteLimit(serialized, maxBytes, label);
  return serialized;
}

function assertByteLimit(serialized: string, maxBytes: number, label: string): void {
  if (utf8ByteLength(serialized) > maxBytes) {
    fail("PAYLOAD_TOO_LARGE", `Serialized ${label} exceeds ${maxBytes} bytes`);
  }
}

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0)!;
    bytes += codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
  }
  return bytes;
}

function assertJsonValue(
  value: unknown,
  seen = new Set<object>(),
  depth = 0,
  budget = { nodes: 0 },
): void {
  budget.nodes += 1;
  if (budget.nodes > MATCH_PERSISTENCE_MAX_NODES) fail("PAYLOAD_TOO_LARGE", `Persistence data exceeds ${MATCH_PERSISTENCE_MAX_NODES} JSON nodes`);
  if (depth > MATCH_PERSISTENCE_MAX_DEPTH) fail("PAYLOAD_TOO_LARGE", `Persistence data exceeds JSON depth ${MATCH_PERSISTENCE_MAX_DEPTH}`);
  if (typeof value === "string" && value.length > MATCH_PERSISTENCE_MAX_STRING_LENGTH) {
    fail("PAYLOAD_TOO_LARGE", `Persistence data contains a string longer than ${MATCH_PERSISTENCE_MAX_STRING_LENGTH} characters`);
  }
  // Canonical live state can contain optional properties with `undefined`;
  // JSON cloning removes them before an artifact is serialized or parsed.
  if (value === undefined || value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail("INVALID_SCHEMA", "Persistence data contains a non-finite number");
    return;
  }
  if (typeof value !== "object") fail("INVALID_SCHEMA", "Persistence data must contain JSON values only");
  if (seen.has(value)) fail("INVALID_SCHEMA", "Persistence data cannot contain cycles");
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) assertJsonValue(item, seen, depth + 1, budget);
  } else {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) fail("INVALID_SCHEMA", "Persistence data must contain plain objects only");
    const record = value as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      if (key === "__proto__" || key === "prototype" || key === "constructor") {
        fail("INVALID_SCHEMA", `Persistence data contains forbidden object key: ${key}`);
      }
      if (key.length > MATCH_PERSISTENCE_MAX_STRING_LENGTH) fail("PAYLOAD_TOO_LARGE", "Persistence data contains an oversized object key");
      assertJsonValue(record[key], seen, depth + 1, budget);
    }
  }
  seen.delete(value);
}

function assertExactKeys(record: Record<string, unknown>, keys: readonly string[], label: string): void {
  const actual = Object.keys(record).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail("INVALID_SCHEMA", `${label} has unknown or missing fields`);
  }
}

function assertRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail("INVALID_SCHEMA", `${label} must be an object`);
  return value as Record<string, unknown>;
}

function assertNonEmptyString(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0) fail("INVALID_SCHEMA", `${label} must be a non-empty string`);
}

function assertSafeInteger(value: unknown, label: string): asserts value is number {
  if (!Number.isSafeInteger(value)) fail("INVALID_SCHEMA", `${label} must be a safe integer`);
}

function assertNonNegativeSafeInteger(value: unknown, label: string): asserts value is number {
  assertSafeInteger(value, label);
  if (value < 0) fail("INVALID_SCHEMA", `${label} must be non-negative`);
}

function assertPositiveSafeInteger(value: unknown, label: string): asserts value is number {
  assertSafeInteger(value, label);
  if (value <= 0) fail("INVALID_SCHEMA", `${label} must be positive`);
}

function assertNonNegativeFiniteNumber(value: unknown, label: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    fail("INVALID_SCHEMA", `${label} must be a finite non-negative number`);
  }
}

function assertPositiveFiniteNumber(value: unknown, label: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    fail("INVALID_SCHEMA", `${label} must be a finite positive number`);
  }
}

function assertTick(value: unknown, label: string): asserts value is number {
  assertNonNegativeSafeInteger(value, label);
  if (value > MATCH_PERSISTENCE_MAX_TICK) fail("PAYLOAD_TOO_LARGE", `${label} exceeds ${MATCH_PERSISTENCE_MAX_TICK}`);
}

function assertSafeIntegerArray(value: readonly unknown[], label: string): void {
  const seen = new Set<number>();
  for (const item of value) {
    assertNonNegativeSafeInteger(item, label);
    if (seen.has(item)) fail("INVALID_SCHEMA", `${label} cannot contain duplicates`);
    seen.add(item);
  }
}

function assertHash(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}$/.test(value)) fail("INVALID_SCHEMA", `${label} must be an eight-character lowercase hash`);
}

function isMatchPhase(value: unknown): boolean {
  return value === "lobby" || value === "loading" || value === "playing" || value === "finished" || value === "disposed";
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
}

function hashMatchContinuation(finalStateHash: string, runtime: MatchRuntimeSaveMetadata): string {
  const canonical = stableStringify({
    domain: "village-siege/continuation/1",
    finalStateHash,
    runtime: {
      humanPlayerId: runtime.humanPlayerId,
      nextPlayerSequence: runtime.nextPlayerSequence,
      accumulatorMs: runtime.accumulatorMs,
      aiBudgetMs: runtime.aiBudgetMs,
    },
  });
  let hash = 0x811c9dc5;
  for (let index = 0; index < canonical.length; index += 1) {
    hash = Math.imul(hash ^ canonical.charCodeAt(index), 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function fail(code: MatchPersistenceErrorCode, message: string): never {
  throw new MatchPersistenceError(code, message);
}
