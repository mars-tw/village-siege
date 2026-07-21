#!/bin/sh
set -eu

# Backups can contain player names, match state, and database metadata.
umask 077

BACKUP_DIR=${BACKUP_DIR:-/backups}
BACKUP_TMPDIR=${BACKUP_TMPDIR:-${TMPDIR:-/tmp}}
RETENTION_DAYS=${RETENTION_DAYS:-14}

fail() {
  printf '%s\n' "backup-postgres: $*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "required command not found: $1"
}

case "$BACKUP_DIR" in
  /*) ;;
  *) fail "BACKUP_DIR must be an absolute path" ;;
esac
case "$BACKUP_TMPDIR" in
  /*) ;;
  *) fail "BACKUP_TMPDIR must be an absolute path" ;;
esac
[ -d "$BACKUP_TMPDIR" ] && [ -w "$BACKUP_TMPDIR" ] || fail "BACKUP_TMPDIR is not a writable directory"

case "$RETENTION_DAYS" in
  ''|*[!0-9]*) fail "RETENTION_DAYS must be an integer from 1 to 3650" ;;
esac
[ "$RETENTION_DAYS" -ge 1 ] && [ "$RETENTION_DAYS" -le 3650 ] \
  || fail "RETENTION_DAYS must be an integer from 1 to 3650"
: "${AGE_RECIPIENT:?AGE_RECIPIENT is required to encrypt authoritative backups}"

if [ -n "${PGPASSWORD_FILE:-}" ]; then
  [ -r "$PGPASSWORD_FILE" ] || fail "PGPASSWORD_FILE is not readable"
  [ -z "${PGPASSWORD:-}" ] || fail "set only one of PGPASSWORD or PGPASSWORD_FILE"
  require_command cat
  PGPASSWORD=$(cat "$PGPASSWORD_FILE") || fail "could not read PGPASSWORD_FILE"
  [ -n "$PGPASSWORD" ] || fail "PGPASSWORD_FILE is empty"
  export PGPASSWORD
fi

if [ -n "${DATABASE_URL:-}" ]; then
  if [ -n "${PGDATABASE:-}" ] && [ "$PGDATABASE" != "$DATABASE_URL" ]; then
    fail "DATABASE_URL and PGDATABASE select different targets"
  fi
  PGDATABASE=$DATABASE_URL
  export PGDATABASE
fi
: "${PGDATABASE:?set DATABASE_URL or libpq PGDATABASE connection settings}"

require_command date
require_command find
require_command mktemp
require_command mv
require_command age
require_command pg_dump
require_command pg_restore

mkdir -p "$BACKUP_DIR"
[ -d "$BACKUP_DIR" ] && [ -w "$BACKUP_DIR" ] || fail "BACKUP_DIR is not a writable directory"

timestamp=$(date -u '+%Y%m%dT%H%M%SZ')
final_file="$BACKUP_DIR/village-siege-$timestamp.dump.age"
[ ! -e "$final_file" ] || fail "backup already exists for timestamp $timestamp"

plain_dir=$(mktemp -d "$BACKUP_TMPDIR/.village-siege-plain.XXXXXX") \
  || fail "could not create a private plaintext directory in BACKUP_TMPDIR"
plain_file="$plain_dir/archive.dump"
encrypted_file=
cleanup() {
  rm -f "$plain_file"
  [ -z "$encrypted_file" ] || rm -f "$encrypted_file"
  rmdir "$plain_dir" 2>/dev/null || true
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM
encrypted_file=$(mktemp "$BACKUP_DIR/.village-siege-backup.XXXXXX") \
  || fail "could not create an encrypted temporary file in BACKUP_DIR"

# PGDATABASE is inherited by libpq, keeping the connection string out of argv.
pg_dump \
  --format=custom \
  --compress=6 \
  --no-owner \
  --no-privileges \
  --file="$plain_file"

# Reject a truncated archive, encrypt it, and publish only ciphertext. Plaintext
# stays in BACKUP_TMPDIR while the encrypted temp stays beside the final archive.
chmod 600 "$plain_file"
pg_restore --list "$plain_file" >/dev/null
age --encrypt --recipient "$AGE_RECIPIENT" "$plain_file" > "$encrypted_file"
[ -s "$encrypted_file" ] || fail "age produced an empty encrypted archive"
chmod 600 "$encrypted_file"
rm -f "$plain_file"
rmdir "$plain_dir"
mv "$encrypted_file" "$final_file"
trap - EXIT HUP INT TERM

# Retention runs only after a verified backup has been published. The pattern and
# max depth constrain deletion to archives created by this script.
find "$BACKUP_DIR" \
  -maxdepth 1 \
  -type f \
  -name 'village-siege-*.dump.age' \
  -mtime "+$RETENTION_DAYS" \
  -exec rm -f '{}' ';'

printf '%s\n' "Backup complete: $final_file"
