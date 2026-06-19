import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { PostgresClient } from "./client.js";

export interface SqlMigration {
  readonly id: string;
  readonly filename: string;
  readonly sql: string;
}

export const MIGRATIONS_TABLE = "schema_migrations";
export const MIGRATIONS_ADVISORY_LOCK_ID = 513248771777;

export function migrationIdFromFilename(filename: string): string {
  const match = /^(?<id>\d{4,}_[a-z0-9_]+)\.sql$/.exec(filename);

  if (!match?.groups?.id) {
    throw new Error(`Invalid migration filename: ${filename}`);
  }

  return match.groups.id;
}

export function defaultMigrationsDirectory(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "../migrations");
}

export async function loadSqlMigrations(
  migrationsDirectory = defaultMigrationsDirectory(),
): Promise<SqlMigration[]> {
  const filenames = (await readdir(migrationsDirectory))
    .filter((filename) => filename.endsWith(".sql"))
    .sort();

  return Promise.all(
    filenames.map(async (filename) => ({
      id: migrationIdFromFilename(filename),
      filename,
      sql: await readFile(join(migrationsDirectory, filename), "utf8"),
    })),
  );
}

export async function ensureMigrationsTable(client: PostgresClient) {
  await client.unsafe(`
    create table if not exists ${MIGRATIONS_TABLE} (
      id text primary key,
      filename text not null,
      applied_at timestamptz not null default now()
    )
  `);
}

export async function appliedMigrationIds(
  client: PostgresClient,
): Promise<ReadonlySet<string>> {
  await ensureMigrationsTable(client);
  const rows = await client<{ id: string }[]>`
    select id
    from schema_migrations
    order by id
  `;

  return new Set(rows.map((row) => row.id));
}

export async function applySqlMigrations(
  client: PostgresClient,
  migrations: readonly SqlMigration[],
): Promise<string[]> {
  await client`select pg_advisory_lock(${MIGRATIONS_ADVISORY_LOCK_ID})`;

  try {
    const applied = await appliedMigrationIds(client);
    const newlyApplied: string[] = [];

    for (const migration of migrations) {
      if (applied.has(migration.id)) {
        continue;
      }

      await client.begin(async (transaction) => {
        await transaction.unsafe(migration.sql);
        await transaction`
          insert into schema_migrations (id, filename)
          values (${migration.id}, ${migration.filename})
        `;
      });

      newlyApplied.push(migration.id);
    }

    return newlyApplied;
  } finally {
    await client`select pg_advisory_unlock(${MIGRATIONS_ADVISORY_LOCK_ID})`;
  }
}

export async function migrateDatabase(
  client: PostgresClient,
  migrationsDirectory = defaultMigrationsDirectory(),
): Promise<string[]> {
  const migrations = await loadSqlMigrations(migrationsDirectory);
  return applySqlMigrations(client, migrations);
}
