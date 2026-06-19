import {
  createDatabase,
  type PostgresClient,
  type SupportDatabase,
} from "./client.js";
import type { TenantScope } from "./repositories.js";

export const APPLICATION_DATABASE_ROLE = "support_app";
export const TENANT_CONTEXT_SETTING = "app.current_tenant_id";

export async function setLocalTenantContext(
  client: PostgresClient,
  tenantId: string,
): Promise<void> {
  assertTenantContext(tenantId);

  await client`select set_config(${TENANT_CONTEXT_SETTING}, ${tenantId}, true)`;
}

export async function withTenantTransaction<T>(
  client: PostgresClient,
  scope: TenantScope,
  callback: (
    db: SupportDatabase,
    transactionClient: PostgresClient,
  ) => Promise<T>,
): Promise<T> {
  assertTenantContext(scope.tenantId);

  return client.begin(async (transaction) => {
    const transactionClient = transaction as unknown as PostgresClient;

    await transaction.unsafe(`set local role ${APPLICATION_DATABASE_ROLE}`);
    await setLocalTenantContext(transactionClient, scope.tenantId);

    transactionClient.options ??= client.options;

    return callback(createDatabase(transactionClient), transactionClient);
  }) as Promise<T>;
}

function assertTenantContext(tenantId: string): void {
  if (tenantId.trim().length === 0) {
    throw new Error("tenantId is required to set database tenant context");
  }
}
