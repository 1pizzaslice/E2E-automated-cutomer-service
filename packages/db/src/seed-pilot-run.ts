import { createDatabaseFromEnv } from "./client.js";
import { applyPilotSeed, buildPilotSeedPlan } from "./seed-pilot.js";

const { db, client } = createDatabaseFromEnv();

try {
  const result = await applyPilotSeed(db, buildPilotSeedPlan());
  const summary = Object.entries(result.inserted)
    .map(([family, count]) => `${family}=${count}`)
    .join(" ");

  console.log(`Pilot seed applied (inserted counts): ${summary}`);
} finally {
  await client.end();
}
