import type { PostgresClient } from "./client.js";

export const APPLICATION_DATABASE_ROLE = "support_app";
export const TENANT_CONTEXT_SETTING = "app.current_tenant_id";

export async function setLocalTenantContext(
  client: PostgresClient,
  tenantId: string,
): Promise<void> {
  if (tenantId.trim().length === 0) {
    throw new Error("tenantId is required to set database tenant context");
  }

  await client`select set_config(${TENANT_CONTEXT_SETTING}, ${tenantId}, true)`;
}
