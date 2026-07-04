/**
 * Approval decision → Temporal workflow signal boundary. The coordinates MUST
 * stay in sync with `@support/workers`
 * `packages/workers/src/workflows/ticket-lifecycle-workflow.ts`
 * (`approval_completed` signal, `TicketLifecycleApprovalCompletedSignal`
 * payload) and the `ticket-lifecycle:{tenant}:{conversation}` workflow id
 * convention in `inbound-intake.ts`. They are duplicated here rather than
 * imported so the API package does not depend on the Temporal worker runtime.
 */
export const APPROVAL_COMPLETED_SIGNAL = "approval_completed";

/** Mirror of the worker `TicketLifecycleApprovalCompletedSignal` contract. */
export interface ApprovalCompletedWorkflowSignal {
  readonly approval_id: string;
  readonly status: "approved" | "rejected" | "edited" | "escalated";
  readonly actor_id: string;
  readonly decided_at: string;
  readonly notes: string | null;
}

export interface SignalApprovalCompletedParams {
  readonly workflowId: string;
  readonly signal: ApprovalCompletedWorkflowSignal;
}

export interface SignalApprovalCompletedResult {
  readonly delivered: boolean;
  readonly workflow_id: string;
  /** Why delivery was skipped when `delivered` is false. */
  readonly reason: string | null;
}

/**
 * Delivers the human approval decision to the waiting ticket lifecycle
 * workflow so it resumes (send / complete / escalate). A missing workflow is
 * reported, not thrown: approvals created outside a workflow run (seeds,
 * manual records) have no waiting workflow to resume, and the persisted
 * decision is already the source of truth.
 */
export interface ApprovalWorkflowSignaler {
  signalApprovalCompleted(
    params: SignalApprovalCompletedParams,
  ): Promise<SignalApprovalCompletedResult>;
  close?(): Promise<void>;
}

export interface TemporalApprovalWorkflowSignalerConfig {
  readonly address?: string;
  readonly namespace?: string;
}

/**
 * Temporal-backed signaler. The client connection is established lazily on
 * the first decision so deployments that never resolve approvals (and tests
 * that inject the recording signaler) do not open a Temporal connection.
 */
export function createTemporalApprovalWorkflowSignaler(
  config: TemporalApprovalWorkflowSignalerConfig = {},
): ApprovalWorkflowSignaler {
  const address =
    config.address ?? process.env.TEMPORAL_ADDRESS ?? "localhost:7233";
  const namespace =
    config.namespace ?? process.env.TEMPORAL_NAMESPACE ?? "default";

  let clientPromise: Promise<{
    client: import("@temporalio/client").WorkflowClient;
    connection: import("@temporalio/client").Connection;
  }> | null = null;

  function getClient() {
    if (!clientPromise) {
      clientPromise = (async () => {
        const { Connection, WorkflowClient } =
          await import("@temporalio/client");
        const connection = await Connection.connect({ address });
        const client = new WorkflowClient({ connection, namespace });
        return { client, connection };
      })();
    }

    return clientPromise;
  }

  return {
    async signalApprovalCompleted(params) {
      const { client } = await getClient();

      try {
        await client
          .getHandle(params.workflowId)
          .signal(APPROVAL_COMPLETED_SIGNAL, params.signal);
      } catch (error) {
        if (isWorkflowNotFoundError(error)) {
          return {
            delivered: false,
            workflow_id: params.workflowId,
            reason: "workflow_not_found",
          };
        }

        throw error;
      }

      return {
        delivered: true,
        workflow_id: params.workflowId,
        reason: null,
      };
    },
    async close() {
      if (clientPromise) {
        const { connection } = await clientPromise;
        await connection.close();
      }
    },
  };
}

/**
 * Detected by name so the Temporal client stays a lazy dynamic import. Covers
 * `WorkflowNotFoundError` and the underlying gRPC not-found service error.
 */
function isWorkflowNotFoundError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return (
    error.name === "WorkflowNotFoundError" ||
    (error.name === "ServiceError" && /not found/i.test(error.message))
  );
}

/**
 * Recording signaler for tests. Captures every delivery so tests can assert
 * the decision → workflow resume boundary without a running Temporal service.
 */
export function createRecordingApprovalWorkflowSignaler(): ApprovalWorkflowSignaler & {
  readonly calls: SignalApprovalCompletedParams[];
} {
  const calls: SignalApprovalCompletedParams[] = [];

  return {
    calls,
    async signalApprovalCompleted(params) {
      calls.push(params);
      return { delivered: true, workflow_id: params.workflowId, reason: null };
    },
  };
}
