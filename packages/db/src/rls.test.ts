import { describe, expect, it } from "vitest";
import type { PostgresClient } from "./client.js";
import {
  APPLICATION_DATABASE_ROLE,
  TENANT_CONTEXT_SETTING,
  setLocalTenantContext,
  withTenantTransaction,
} from "./rls.js";

describe("row-level security helpers", () => {
  it("rejects blank tenant context values before hitting PostgreSQL", async () => {
    await expect(
      setLocalTenantContext({} as PostgresClient, "   "),
    ).rejects.toThrow("tenantId is required to set database tenant context");
  });

  it("sets application role and tenant context before scoped work", async () => {
    const events: string[] = [];
    const values: unknown[][] = [];
    const transaction = makeTransaction(events, values);
    const client = makeClient(transaction, events);

    const result = await withTenantTransaction(
      client,
      { tenantId: "ten_test" },
      async () => {
        events.push("callback");
        return "ok";
      },
    );

    expect(result).toBe("ok");
    expect(events).toEqual([
      "begin",
      `unsafe:set local role ${APPLICATION_DATABASE_ROLE}`,
      "sql",
      "callback",
    ]);
    expect(values).toEqual([[TENANT_CONTEXT_SETTING, "ten_test"]]);
  });

  it("rejects blank tenant transaction scopes before opening a transaction", async () => {
    const events: string[] = [];
    const client = makeClient(makeTransaction(events, []), events);

    await expect(
      withTenantTransaction(client, { tenantId: " " }, async () => "unused"),
    ).rejects.toThrow("tenantId is required to set database tenant context");
    expect(events).toEqual([]);
  });
});

function makeClient(transaction: unknown, events: string[]): PostgresClient {
  return {
    begin: async (callback: (transaction: unknown) => Promise<unknown>) => {
      events.push("begin");
      return callback(transaction);
    },
  } as unknown as PostgresClient;
}

function makeTransaction(
  events: string[],
  values: unknown[][],
): PostgresClient {
  const transaction = (async (
    _strings: TemplateStringsArray,
    ...sqlValues: unknown[]
  ) => {
    events.push("sql");
    values.push(sqlValues);
    return [];
  }) as PostgresClient;

  transaction.unsafe = (async (sql: string) => {
    events.push(`unsafe:${sql}`);
    return [];
  }) as PostgresClient["unsafe"];
  transaction.options = {
    parsers: {},
    serializers: {},
  } as PostgresClient["options"];

  return transaction;
}
