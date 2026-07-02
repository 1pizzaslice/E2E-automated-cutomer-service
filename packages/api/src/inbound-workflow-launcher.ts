/**
 * Ticket lifecycle workflow coordinates that the inbound intake path uses to
 * start or signal the durable workflow. These MUST stay in sync with
 * `@support/workers` `packages/workers/src/workflows/ticket-lifecycle-types.ts`
 * (`TICKET_LIFECYCLE_TASK_QUEUE`, `TICKET_LIFECYCLE_WORKFLOW_TYPE`) and the
 * `message_received` signal defined in `ticket-lifecycle-workflow.ts`. They are
 * duplicated here rather than imported so the API package does not depend on the
 * Temporal worker runtime.
 */
export const TICKET_LIFECYCLE_TASK_QUEUE = "support-ticket-lifecycle";
export const TICKET_LIFECYCLE_WORKFLOW_TYPE = "ticketLifecycleWorkflow";
export const MESSAGE_RECEIVED_SIGNAL = "message_received";

/** Mirror of the worker `TicketLifecycleWorkflowInput` start contract. */
export interface InboundTicketWorkflowInput {
  readonly tenant_id: string;
  readonly ticket_id: string;
  readonly initial_message_id: string;
  readonly correlation_id: string;
}

/** Mirror of the worker `TicketLifecycleMessageReceivedSignal` contract. */
export interface InboundMessageReceivedSignal {
  readonly message_id: string;
  readonly conversation_id: string;
  readonly channel_id: string;
  readonly received_at: string;
  readonly external_message_id: string | null;
  readonly external_thread_id: string | null;
  readonly idempotency_key: string | null;
}

export interface DeliverInboundMessageParams {
  readonly workflowId: string;
  readonly taskQueue: string;
  readonly input: InboundTicketWorkflowInput;
  readonly signal: InboundMessageReceivedSignal;
}

export interface DeliverInboundMessageResult {
  readonly workflow_id: string;
  readonly run_id: string | null;
}

/**
 * Starts or signals the ticket lifecycle workflow for an inbound message. The
 * default implementation uses Temporal `signalWithStart` so the first message
 * for a conversation starts the workflow and later messages are delivered as
 * `message_received` signals to the already-running workflow.
 */
export interface InboundWorkflowLauncher {
  deliverInboundMessage(
    params: DeliverInboundMessageParams,
  ): Promise<DeliverInboundMessageResult>;
  close?(): Promise<void>;
}

export interface TemporalInboundWorkflowLauncherConfig {
  readonly address?: string;
  readonly namespace?: string;
}

/**
 * Temporal-backed launcher. The client connection is established lazily on the
 * first delivery so environments that never receive webhooks (and test/CI runs
 * that inject a fake launcher) do not open a Temporal connection.
 */
export function createTemporalInboundWorkflowLauncher(
  config: TemporalInboundWorkflowLauncherConfig = {},
): InboundWorkflowLauncher {
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
    async deliverInboundMessage(params) {
      const { client } = await getClient();
      const handle = await client.signalWithStart(
        TICKET_LIFECYCLE_WORKFLOW_TYPE,
        {
          taskQueue: params.taskQueue,
          workflowId: params.workflowId,
          args: [params.input],
          signal: MESSAGE_RECEIVED_SIGNAL,
          signalArgs: [params.signal],
        },
      );

      return {
        workflow_id: params.workflowId,
        run_id: handle.signaledRunId ?? null,
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
 * Recording launcher for tests. Captures every delivery so tests can assert the
 * workflow start/signal boundary without a running Temporal service.
 */
export function createRecordingInboundWorkflowLauncher(): InboundWorkflowLauncher & {
  readonly calls: DeliverInboundMessageParams[];
} {
  const calls: DeliverInboundMessageParams[] = [];

  return {
    calls,
    async deliverInboundMessage(params) {
      calls.push(params);
      return { workflow_id: params.workflowId, run_id: null };
    },
  };
}
