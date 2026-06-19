import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { loadDatabaseConfig, type DatabaseConfig } from "./config.js";
import * as schema from "./schema.js";

export type PostgresClient = postgres.Sql;
export type SupportDatabase = ReturnType<typeof createDatabase>;

export function createPostgresClient(
  config: DatabaseConfig = loadDatabaseConfig(),
  options: postgres.Options<Record<string, postgres.PostgresType>> = {},
): PostgresClient {
  return postgres(config.databaseUrl, options);
}

export function createDatabase(client: PostgresClient) {
  return drizzle(client, { schema });
}

export function createDatabaseFromEnv(env: NodeJS.ProcessEnv = process.env) {
  const client = createPostgresClient(loadDatabaseConfig(env));

  return {
    client,
    db: createDatabase(client),
  };
}
