#!/bin/sh
set -eu

umask 077

fail() {
  printf '%s\n' "restore-postgres: $*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "required command not found: $1"
}

[ "$#" -eq 1 ] || fail "usage: restore-postgres.sh /absolute/path/to/village-siege-TIMESTAMP.dump.age"
backup_file=$1

case "$backup_file" in
  /*) ;;
  *) fail "backup path must be absolute" ;;
esac
[ -f "$backup_file" ] || fail "backup is not a regular file: $backup_file"
[ ! -L "$backup_file" ] || fail "symbolic-link backup paths are not accepted"
case "$backup_file" in
  *.dump.age) ;;
  *) fail "backup must use the .dump.age extension" ;;
esac
: "${AGE_IDENTITY_FILE:?AGE_IDENTITY_FILE is required to decrypt authoritative backups}"
[ -f "$AGE_IDENTITY_FILE" ] && [ -r "$AGE_IDENTITY_FILE" ] || fail "AGE_IDENTITY_FILE must be a readable regular file"

RESTORE_TMPDIR=${RESTORE_TMPDIR:-${TMPDIR:-/tmp}}
case "$RESTORE_TMPDIR" in
  /*) ;;
  *) fail "RESTORE_TMPDIR must be an absolute path" ;;
esac
[ -d "$RESTORE_TMPDIR" ] && [ -w "$RESTORE_TMPDIR" ] || fail "RESTORE_TMPDIR is not a writable directory"

[ -z "${DATABASE_URL:-}" ] || fail "DATABASE_URL is forbidden for restore because it may expose credentials in process arguments"
: "${PGHOST:?PGHOST is required for restore}"
: "${PGPORT:?PGPORT is required for restore}"
: "${PGUSER:?PGUSER is required for restore}"
: "${PGDATABASE:?PGDATABASE is required for restore}"
case "$PGPORT" in
  ''|*[!0-9]*) fail "PGPORT must be an integer from 1 to 65535" ;;
esac
[ "$PGPORT" -ge 1 ] && [ "$PGPORT" -le 65535 ] || fail "PGPORT must be an integer from 1 to 65535"
case "$PGDATABASE" in
  *[!A-Za-z0-9_.-]*) fail "PGDATABASE must be a database name, not a URL or connection string" ;;
esac

if [ -n "${PGPASSWORD_FILE:-}" ]; then
  [ -r "$PGPASSWORD_FILE" ] || fail "PGPASSWORD_FILE is not readable"
  [ -z "${PGPASSWORD:-}" ] || fail "set only one of PGPASSWORD or PGPASSWORD_FILE"
  require_command cat
  PGPASSWORD=$(cat "$PGPASSWORD_FILE") || fail "could not read PGPASSWORD_FILE"
  [ -n "$PGPASSWORD" ] || fail "PGPASSWORD_FILE is empty"
  export PGPASSWORD
fi
: "${PGPASSWORD:?set PGPASSWORD or PGPASSWORD_FILE for restore}"

require_command age
require_command mktemp
require_command pg_restore
require_command psql

temp_dir=$(mktemp -d "$RESTORE_TMPDIR/.village-siege-restore.XXXXXX") \
  || fail "could not create a private restore directory"
plain_file="$temp_dir/archive.dump"
cleanup() {
  rm -f "$plain_file"
  rmdir "$temp_dir" 2>/dev/null || true
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM

age --decrypt --identity "$AGE_IDENTITY_FILE" --output "$plain_file" "$backup_file" \
  || fail "backup decryption failed"
chmod 600 "$plain_file"
pg_restore --list "$plain_file" >/dev/null || fail "decrypted archive validation failed"

# A restore cleans objects from the selected database. Refuse redirected input so
# that a CI variable or copied command cannot silently approve data destruction.
[ -t 0 ] && [ -t 1 ] || fail "restore requires an interactive terminal for two confirmations"

target_database=$(psql -X -v ON_ERROR_STOP=1 -Atqc 'SELECT current_database()') \
  || fail "could not identify the target database"
[ -n "$target_database" ] || fail "database returned an empty identity"
[ "$target_database" = "$PGDATABASE" ] || fail "connected database does not match PGDATABASE"
backup_name=${backup_file##*/}

printf '%s\n' "WARNING: this will clean and replace objects in PostgreSQL database: $target_database" >&2
printf '%s' "First confirmation - type the exact database name: " >&2
IFS= read -r first_confirmation
[ "$first_confirmation" = "$target_database" ] || fail "first confirmation did not match"

printf '%s' "Second confirmation - type RESTORE $backup_name: " >&2
IFS= read -r second_confirmation
[ "$second_confirmation" = "RESTORE $backup_name" ] || fail "second confirmation did not match"

pg_restore \
  --clean \
  --if-exists \
  --no-owner \
  --no-privileges \
  --exit-on-error \
  --single-transaction \
  --dbname="$PGDATABASE" \
  "$plain_file"

psql -X -v ON_ERROR_STOP=1 -Atqc 'SELECT 1' >/dev/null
printf '%s\n' "Restore completed and connection verified for database: $target_database"
