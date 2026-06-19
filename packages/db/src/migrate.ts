import { createDatabaseFromEnv } from "./client.js";
import { migrateDatabase } from "./migrations.js";

const { client } = createDatabaseFromEnv();

try {
  const applied = await migrateDatabase(client);
  const summary =
    applied.length === 0
      ? "No pending migrations."
      : `Applied migrations: ${applied.join(", ")}`;

  console.log(summary);
} finally {
  await client.end();
}
