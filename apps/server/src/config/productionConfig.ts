export interface RecoveryConfiguration {
  readonly redisUrl?: string;
  readonly postgresUrl?: string;
  readonly durable: boolean;
}

export function resolveRecoveryConfiguration(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): RecoveryConfiguration {
  const redisUrl = environment.REDIS_URL?.trim() || undefined;
  const postgresUrl = environment.DATABASE_URL?.trim() || undefined;
  const hasRedis = redisUrl !== undefined;
  const hasPostgres = postgresUrl !== undefined;

  if (hasRedis !== hasPostgres) {
    throw new Error("REDIS_URL and DATABASE_URL must be configured together for durable match recovery");
  }
  if (environment.NODE_ENV === "production" && (!hasRedis || !hasPostgres)) {
    throw new Error("Production requires REDIS_URL and DATABASE_URL; memory-only recovery is not allowed");
  }

  return { redisUrl, postgresUrl, durable: hasRedis && hasPostgres };
}
