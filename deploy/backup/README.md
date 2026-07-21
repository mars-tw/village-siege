# PostgreSQL backup and restore

These scripts use encrypted PostgreSQL custom-format archives and do not contain credentials. Supply the connection through `DATABASE_URL`, or through standard libpq variables such as `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, and `PGDATABASE`. A mounted secret can be passed as `PGPASSWORD_FILE`; the scripts reject setting it together with `PGPASSWORD`.

## Backup

Install `age` and PostgreSQL client tools, then run `backup-postgres.sh` from a host or container that can reach the database. `AGE_RECIPIENT` is the public age recipient and is safe to keep in deployment configuration:

```sh
AGE_RECIPIENT=age1... BACKUP_DIR=/backups BACKUP_TMPDIR=/tmp RETENTION_DAYS=14 sh ./deploy/backup/backup-postgres.sh
```

The script creates and validates a plaintext archive in a private mode `0700` directory under the absolute, writable `BACKUP_TMPDIR` (defaulting to `TMPDIR` or `/tmp`). It encrypts with age into a mode `0600` temporary file inside `BACKUP_DIR`, deletes the plaintext, and atomically renames the same-filesystem ciphertext to `village-siege-*.dump.age`. A trap removes both temporary files on error or interruption. Use a memory-backed or encrypted `BACKUP_TMPDIR`; retention runs only after publication and only matches encrypted archives in the backup directory.

Store the backup volume separately from the database volume, copy archives to off-site storage, keep the private age identity outside the backup location, and test restores on an isolated database regularly.

## Restore

Restore is destructive. Set `AGE_IDENTITY_FILE` to a readable private age identity supplied by the deployment secret store. The script decrypts into a private mode `0600` temporary file, validates it, and requires a TTY plus two typed confirmations: the database name read from PostgreSQL and the exact encrypted archive filename.

```sh
AGE_IDENTITY_FILE=/run/secrets/backup_age_identity sh ./deploy/backup/restore-postgres.sh /backups/village-siege-20260101T000000Z.dump.age
```

The restore runs `pg_restore --clean --if-exists` in one transaction and traps deletion of the plaintext file on success, error, and common termination signals. Deletion is not a secure erase on every filesystem, so use an encrypted ephemeral volume or memory-backed `RESTORE_TMPDIR` when the host's storage is not already encrypted. To keep credentials out of process arguments it rejects `DATABASE_URL` and requires `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD` (directly or loaded from `PGPASSWORD_FILE`), and a `PGDATABASE` containing only a database name. PostgreSQL roles, extensions, and major-version compatibility remain operator responsibilities. Stop game writes or place the service in maintenance mode before a restore, and restore only archives from a trusted source.
