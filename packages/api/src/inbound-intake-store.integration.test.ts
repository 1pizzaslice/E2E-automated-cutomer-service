import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  channels,
  createDatabase,
  createPostgresClient,
  messages,
  migrateDatabase,
  tenants,
  type PostgresClient,
} from "@support/db";
import {
  NormalizedInboundMessageSchema,
  type NormalizedInboundMessage,
} from "@support/shared-schemas";
import { createInboundIntakeService } from "./inbound-intake.js";
import { createDatabaseInboundIntakeStore } from "./inbound-intake-store.js";
import { createRecordingInboundWorkflowLauncher } from "./inbound-workflow-launcher.js";

const describeLive =
  process.env.RUN_API_INTEGRATION_TESTS === "true" ? describe : describe.skip;

const fixturePrefix = `intake_it_${process.pid}_${Date.now()}`;
const ids = {
  tenant: `${fixturePrefix}_ten`,
  channel: `${fixturePrefix}_chn`,
};

function makeMessage(
  overrides: Partial<NormalizedInboundMessage> = {},
): NormalizedInboundMessage {
  return NormalizedInboundMessageSchema.parse({
    tenant_id: ids.tenant,
    channel_id: ids.channel,
    channel: "email",
    provider: "mailgun",
    external_thread_id: `${fixturePrefix}_thread`,
    external_message_id: `${fixturePrefix}_msg_1`,
    customer_identity: {
      type: "email",
      value: `${fixturePrefix}@example.test`,
      display_name: "Live Intake Customer",
    },
    direction: "inbound",
    body: { text: "Where is my order?", html: null },
    attachments: [],
    raw_payload_ref: `file:///tmp/${fixturePrefix}/raw-1.json`,
    received_at: "2026-07-02T00:00:00.000Z",
    idempotency_key: `${fixturePrefix}_msg_1`,
    ...overrides,
  });
}

describeLive("live PostgreSQL inbound intake store", () => {
  let client: PostgresClient | undefined;
  let db: ReturnType<typeof createDatabase>;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error(
        "DATABASE_URL is required when RUN_API_INTEGRATION_TESTS=true",
      );
    }

    client = createPostgresClient(undefined, { max: 1 });
    db = createDatabase(client);

    await migrateDatabase(client);
    await db.insert(tenants).values({
      tenantId: ids.tenant,
      name: `${fixturePrefix} Tenant`,
    });
    await db.insert(channels).values({
      channelId: ids.channel,
      tenantId: ids.tenant,
      type: "email",
      provider: "mailgun",
      status: "active",
    });
  });

  afterAll(async () => {
    if (client) {
      await client`delete from messages where tenant_id = ${ids.tenant}`;
      await client`delete from conversations where tenant_id = ${ids.tenant}`;
      await client`delete from customer_identities where tenant_id = ${ids.tenant}`;
      await client`delete from customers where tenant_id = ${ids.tenant}`;
      await client`delete from channels where tenant_id = ${ids.tenant}`;
      await client`delete from tenants where tenant_id = ${ids.tenant}`;
      await client.end();
    }
  });

  function makeService() {
    const store = createDatabaseInboundIntakeStore({ client: client!, db });
    const launcher = createRecordingInboundWorkflowLauncher();
    const intake = createInboundIntakeService({ store, launcher });
    return { intake, launcher };
  }

  it("persists a new inbound message and creates a threaded conversation", async () => {
    const { intake, launcher } = makeService();

    const result = await intake.ingestNormalizedMessage(makeMessage());

    expect(result.deduplicated).toBe(false);
    expect(result.customer_id).not.toBeNull();
    expect(launcher.calls).toHaveLength(1);

    const rows = await client!`
      select count(*)::int as count from messages
      where tenant_id = ${ids.tenant}
        and external_message_id = ${`${fixturePrefix}_msg_1`}
    `;
    expect(rows[0]!.count).toBe(1);
  });

  it("deduplicates a repeated provider event without a second message or workflow", async () => {
    const { intake, launcher } = makeService();

    const repeat = await intake.ingestNormalizedMessage(makeMessage());

    expect(repeat.deduplicated).toBe(true);
    expect(launcher.calls).toHaveLength(0);

    const rows = await client!`
      select count(*)::int as count from messages
      where tenant_id = ${ids.tenant}
        and external_message_id = ${`${fixturePrefix}_msg_1`}
    `;
    expect(rows[0]!.count).toBe(1);
  });

  it("threads a reply on the same external_thread_id into one conversation", async () => {
    const { intake } = makeService();

    const first = await intake.ingestNormalizedMessage(
      makeMessage({
        external_message_id: `${fixturePrefix}_msg_first`,
        idempotency_key: `${fixturePrefix}_msg_first`,
      }),
    );
    const reply = await intake.ingestNormalizedMessage(
      makeMessage({
        external_message_id: `${fixturePrefix}_msg_reply`,
        idempotency_key: `${fixturePrefix}_msg_reply`,
      }),
    );

    expect(reply.deduplicated).toBe(false);
    expect(reply.conversation_id).toBe(first.conversation_id);
    expect(reply.customer_id).toBe(first.customer_id);

    const conversationRows = await client!`
      select count(*)::int as count from conversations
      where tenant_id = ${ids.tenant}
        and external_thread_id = ${`${fixturePrefix}_thread`}
    `;
    expect(conversationRows[0]!.count).toBe(1);
  });
});
