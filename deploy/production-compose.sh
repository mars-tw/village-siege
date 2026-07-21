#!/bin/sh
set -eu

script_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
production_env_file="${PRODUCTION_ENV_FILE:-$script_dir/production.env}"
redis_password_file="${REDIS_PASSWORD_FILE:-/etc/village-siege/secrets/redis_password}"
postgres_password_file="${POSTGRES_PASSWORD_FILE:-/etc/village-siege/secrets/postgres_password}"

read_base64url_secret() {
  secret_label="$1"
  secret_path="$2"

  if [ ! -r "$secret_path" ]; then
    echo "$secret_label secret file is not readable: $secret_path" >&2
    exit 1
  fi

  secret_directory="$(dirname -- "$secret_path")"
  secret_directory_mode="$(stat -c '%a' "$secret_directory")"
  secret_file_mode="$(stat -c '%a' "$secret_path")"
  if [ "$secret_directory_mode" != "700" ]; then
    echo "$secret_label secret directory must have mode 0700: $secret_directory" >&2
    exit 1
  fi
  if [ "$secret_file_mode" != "444" ]; then
    echo "$secret_label secret file must have mode 0444 inside its protected directory: $secret_path" >&2
    exit 1
  fi

  secret_value="$(cat "$secret_path")"
  secret_length="${#secret_value}"
  if [ "$secret_length" -lt 32 ] || [ "$secret_length" -gt 128 ]; then
    echo "$secret_label secret must contain 32 to 128 base64url characters" >&2
    exit 1
  fi
  case "$secret_value" in
    *[!A-Za-z0-9_-]*)
      echo "$secret_label secret must contain only base64url characters" >&2
      exit 1;;
  esac

  unset secret_value secret_length
}

read_base64url_secret Redis "$redis_password_file"
read_base64url_secret PostgreSQL "$postgres_password_file"
COMPOSE_REDIS_SECRET_FILE="$redis_password_file"
COMPOSE_POSTGRES_SECRET_FILE="$postgres_password_file"
export COMPOSE_REDIS_SECRET_FILE COMPOSE_POSTGRES_SECRET_FILE

exec docker compose \
  --env-file "$production_env_file" \
  -f "$script_dir/compose.production.yaml" \
  "$@"
