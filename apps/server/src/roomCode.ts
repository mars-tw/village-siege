import { randomBytes } from "node:crypto";

const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const ROOM_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{6}$/;

export function createRoomCode(): string {
  const bytes = randomBytes(6);
  let code = "";
  for (const byte of bytes) code += ROOM_CODE_ALPHABET[byte & 31];
  return code;
}

export function normalizeRoomCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const code = value.trim().toUpperCase();
  return ROOM_CODE_PATTERN.test(code) ? code : null;
}
