export interface RandomStep {
  readonly value: number;
  readonly state: number;
}

const ZERO_SEED_FALLBACK = 0x6d2b79f5;

export function normalizeSeed(seed: number): number {
  if (!Number.isFinite(seed)) return ZERO_SEED_FALLBACK;
  const normalized = Math.trunc(seed) >>> 0;
  return normalized === 0 ? ZERO_SEED_FALLBACK : normalized;
}

export function nextUint32(state: number): RandomStep {
  let value = normalizeSeed(state);
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  const nextState = value >>> 0;
  return { value: nextState, state: nextState };
}

export function randomInt(state: number, minimum: number, maximumExclusive: number): RandomStep {
  if (!Number.isSafeInteger(minimum) || !Number.isSafeInteger(maximumExclusive) || maximumExclusive <= minimum) {
    throw new RangeError("randomInt requires a non-empty safe-integer range");
  }
  const step = nextUint32(state);
  return { value: minimum + (step.value % (maximumExclusive - minimum)), state: step.state };
}

export function shuffleDeterministic<T>(items: readonly T[], seed: number): { readonly items: readonly T[]; readonly state: number } {
  const copy = [...items];
  let state = normalizeSeed(seed);
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const step = randomInt(state, 0, index + 1);
    state = step.state;
    const selected = copy[step.value]!;
    copy[step.value] = copy[index]!;
    copy[index] = selected;
  }
  return { items: copy, state };
}
