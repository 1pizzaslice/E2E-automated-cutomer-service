import type { ReactNode } from "react";

/**
 * A bearer credential acquired by a credential gate (Clerk or the dev token
 * form). Either a static `token` (dev) or a `getToken` thunk (Clerk, which
 * rotates short-lived tokens). `tenantHint` seeds the tenant when `GET /v1/me`
 * reports no home tenant (a platform user in the dev path); a tenant-bound
 * reviewer's tenant comes from `/v1/me` and needs no hint.
 */
export interface Credentials {
  readonly token?: string;
  readonly getToken?: () => Promise<string | null>;
  readonly tenantHint?: string;
  readonly signOut: () => void;
}

export interface CredentialsGateProps {
  /** Rendered with the acquired credentials once the caller is signed in. */
  readonly children: (credentials: Credentials) => ReactNode;
}
