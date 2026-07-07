import { createDatabaseFromEnv } from "./client.js";
import { applyPilotSeed, buildPilotSeedPlan } from "./seed-pilot.js";

const { db, client } = createDatabaseFromEnv();

// Optional links from the seeded pilot users to real hosted-IdP identities
// (Milestone 16); unset vars leave idp_subject null (the user cannot sign in
// under production JWT auth until linked).
const idpSubjects = {
  ...(process.env.PILOT_SEED_OPS_IDP_SUBJECT
    ? { ops: process.env.PILOT_SEED_OPS_IDP_SUBJECT }
    : {}),
  ...(process.env.PILOT_SEED_AGENT_IDP_SUBJECT
    ? { agent: process.env.PILOT_SEED_AGENT_IDP_SUBJECT }
    : {}),
  ...(process.env.PILOT_SEED_QA_IDP_SUBJECT
    ? { qa: process.env.PILOT_SEED_QA_IDP_SUBJECT }
    : {}),
};

try {
  const result = await applyPilotSeed(db, buildPilotSeedPlan({ idpSubjects }));
  const summary = Object.entries(result.inserted)
    .map(([family, count]) => `${family}=${count}`)
    .join(" ");

  console.log(`Pilot seed applied (inserted counts): ${summary}`);
} finally {
  await client.end();
}
