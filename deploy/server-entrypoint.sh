#!/bin/sh
set -eu

if [ -n "${REDIS_URL:-}" ] || [ -n "${DATABASE_URL:-}" ]; then
  if [ -z "${REDIS_URL:-}" ] || [ -z "${DATABASE_URL:-}" ]; then
    echo "REDIS_URL and DATABASE_URL must be configured together" >&2
    exit 1
  fi
else
  if [ -n "${REDIS_PASSWORD:-}" ] && [ -n "${REDIS_PASSWORD_FILE:-}" ]; then
    echo "Set only one of REDIS_PASSWORD or REDIS_PASSWORD_FILE" >&2
    exit 1
  fi
  if [ -n "${POSTGRES_PASSWORD:-}" ] && [ -n "${POSTGRES_PASSWORD_FILE:-}" ]; then
    echo "Set only one of POSTGRES_PASSWORD or POSTGRES_PASSWORD_FILE" >&2
    exit 1
  fi

  if [ -n "${REDIS_PASSWORD_FILE:-}" ]; then
    if [ ! -r "${REDIS_PASSWORD_FILE}" ]; then
      echo "REDIS_PASSWORD_FILE is not readable" >&2
      exit 1
    fi
    REDIS_PASSWORD="$(cat "${REDIS_PASSWORD_FILE}")"
    export REDIS_PASSWORD
  fi
  if [ -n "${POSTGRES_PASSWORD_FILE:-}" ]; then
    if [ ! -r "${POSTGRES_PASSWORD_FILE}" ]; then
      echo "POSTGRES_PASSWORD_FILE is not readable" >&2
      exit 1
    fi
    POSTGRES_PASSWORD="$(cat "${POSTGRES_PASSWORD_FILE}")"
    export POSTGRES_PASSWORD
  fi

  : "${REDIS_PASSWORD:?REDIS_PASSWORD is required when REDIS_URL is not set}"
  : "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required when DATABASE_URL is not set}"

  export REDIS_HOST="${REDIS_HOST:-redis}"
  export REDIS_PORT="${REDIS_PORT:-6379}"
  export POSTGRES_HOST="${POSTGRES_HOST:-postgres}"
  export POSTGRES_PORT="${POSTGRES_PORT:-5432}"
  export POSTGRES_USER="${POSTGRES_USER:-village_siege}"
  export POSTGRES_DB="${POSTGRES_DB:-village_siege}"

  REDIS_URL="$(node --input-type=module -e '
    const url = new URL("redis://localhost");
    url.username = "default";
    url.password = process.env.REDIS_PASSWORD;
    url.hostname = process.env.REDIS_HOST;
    url.port = process.env.REDIS_PORT;
    process.stdout.write(url.href);
  ')"
  DATABASE_URL="$(node --input-type=module -e '
    const url = new URL("postgresql://localhost");
    url.username = process.env.POSTGRES_USER;
    url.password = process.env.POSTGRES_PASSWORD;
    url.hostname = process.env.POSTGRES_HOST;
    url.port = process.env.POSTGRES_PORT;
    url.pathname = process.env.POSTGRES_DB;
    process.stdout.write(url.href);
  ')"
  export REDIS_URL DATABASE_URL
  unset REDIS_PASSWORD POSTGRES_PASSWORD
fi

exec "$@"
