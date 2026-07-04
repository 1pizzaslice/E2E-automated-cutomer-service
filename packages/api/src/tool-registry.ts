import { randomUUID } from "node:crypto";
import {
  createDatabaseFromEnv,
  insertToolCallQuery,
  toolCallByIdempotencyKeyQuery,
  updateToolCallByIdQuery,
  visibleToolDefinitionByNameQuery,
  withTenantTransaction,
  type JsonObject,
  type PostgresClient,
} from "@support/db";
import type { ToolDefinition } from "@support/integrations";
import {
  createNoopSupportMetrics,
  SUPPORT_ATTR,
  withSpan,
  type SupportMetrics,
} from "@support/observability";
import {
  type ToolCallError,
  type ToolCallErrorCode,
  type ToolCallRequest,
  type ToolCallResult,
  type ToolPermissionClass,
  type ToolSideEffectClass,
} from "@support/shared-schemas";
import { z } from "zod";

/**
 * Maximum serialized size of a tool's output. Tool results are returned to the
 * AI runtime as evidence/context, so they are bounded: an oversized result is
 * rejected rather than truncated (silent truncation could drop the part that
 * changes an answer). Keeps a single tool call from flooding the model context.
 */
export const DEFAULT_MAX_OUTPUT_BYTES = 16 * 1024;

/**
 * The principal context a tool runs under. Tools are executed by the AI runtime
 * inside an `ai_run` on a `ticket`, so both ids are required and every audit row
 * is anchored to them. `grantedPermissions` is the set of permission classes the
 * caller holds; the executor checks each tool's required class against it.
 */
export interface ToolExecutionContext {
  readonly tenantId: string;
  readonly ticketId: string;
  readonly aiRunId: string;
  readonly grantedPermissions:
    | ReadonlySet<ToolPermissionClass>
    | readonly ToolPermissionClass[];
}

/**
 * A tool the executor can run: its declarative {@link ToolDefinition} contract
 * plus the argument/result schemas that make execution safe. `argsSchema`
 * rejects malformed arguments before the handler runs; `resultSchema` validates
 * (and thereby bounds/shapes) the handler's output before it is returned.
 */
export interface RegisteredTool {
  readonly definition: ToolDefinition;
  readonly argsSchema: z.ZodType;
  readonly resultSchema: z.ZodType<JsonObject>;
  handler(args: unknown, context: ToolExecutionContext): Promise<JsonObject>;
}

/**
 * Type-safe helper to define a tool. The handler receives arguments already
 * validated against `argsSchema` (typed as the schema's output) and must return
 * a value the executor re-validates against `resultSchema`.
 */
export function defineTool<A, R extends JsonObject>(spec: {
  readonly definition: ToolDefinition;
  readonly argsSchema: z.ZodType<A>;
  readonly resultSchema: z.ZodType<R>;
  readonly handler: (args: A, context: ToolExecutionContext) => Promise<R> | R;
}): RegisteredTool {
  return {
    definition: spec.definition,
    argsSchema: spec.argsSchema,
    resultSchema: spec.resultSchema as z.ZodType<JsonObject>,
    // The executor validates `args` against `argsSchema` before calling this, so
    // the cast recovers the handler's argument type without a second parse.
    handler: (args, context) =>
      Promise.resolve(spec.handler(args as A, context)),
  };
}

// --- Persistence boundary ----------------------------------------------------

/** The visible tool-definition row resolved for a tenant (tenant-scoped or global). */
export interface ResolvedToolDefinition {
  readonly toolDefinitionId: string;
  readonly sideEffectClass: ToolSideEffectClass;
}

/** A prior tool call found by idempotency key, used to replay its outcome. */
export interface PriorToolCall {
  readonly toolCallId: string;
  readonly status: "succeeded" | "failed" | "blocked" | "running" | "planned";
  readonly output: JsonObject | null;
  readonly errorCode: ToolCallErrorCode | null;
  readonly errorMessage: string | null;
}

export interface RecordStartParams {
  readonly tenantId: string;
  readonly ticketId: string;
  readonly aiRunId: string;
  readonly toolDefinitionId: string;
  readonly sideEffectClass: ToolSideEffectClass;
  readonly input: JsonObject;
  /** Non-null only for a side-effect execution that claims the key. */
  readonly idempotencyKey: string | null;
}

export interface RecordOutcomeParams {
  readonly tenantId: string;
  readonly toolCallId: string;
  readonly status: "succeeded" | "failed" | "blocked";
  readonly output?: JsonObject | null;
  readonly errorCode?: ToolCallErrorCode | null;
  readonly errorMessage?: string | null;
}

/**
 * Persistence boundary for the tool registry. `resolveDefinition` enforces
 * tenant-scoped tool visibility; the `record*` methods write the `tool_calls`
 * audit trail; `findByIdempotencyKey` backs idempotent replay. The DB
 * implementation runs each operation under `withTenantTransaction` (RLS); the
 * in-memory implementation mirrors the same semantics for unit tests.
 */
export interface ToolRegistryStore {
  resolveDefinition(
    tenantId: string,
    toolName: string,
  ): Promise<ResolvedToolDefinition | null>;
  findByIdempotencyKey(
    tenantId: string,
    toolDefinitionId: string,
    idempotencyKey: string,
  ): Promise<PriorToolCall | null>;
  recordStart(params: RecordStartParams): Promise<string>;
  recordOutcome(params: RecordOutcomeParams): Promise<void>;
  close?(): Promise<void>;
}

// --- Executor ----------------------------------------------------------------

export interface ToolExecutorDeps {
  readonly store: ToolRegistryStore;
  readonly tools: readonly RegisteredTool[];
  readonly maxOutputBytes?: number;
  /** Domain metrics recorder; defaults to no-op. */
  readonly metrics?: SupportMetrics;
}

export interface ToolExecutor {
  execute(
    context: ToolExecutionContext,
    request: ToolCallRequest,
  ): Promise<ToolCallResult>;
  listTools(): ToolDefinition[];
  close?(): Promise<void>;
}

function toGrantedSet(
  granted: ToolExecutionContext["grantedPermissions"],
): ReadonlySet<ToolPermissionClass> {
  return granted instanceof Set ? granted : new Set(granted);
}

function serializedSize(value: JsonObject): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

/** Race a promise against a timeout; rejects with a timeout marker if exceeded. */
const TIMEOUT_MARKER = Symbol("tool_timeout");

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(TIMEOUT_MARKER), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

/**
 * The tool execution interface. For every call it: resolves tenant-scoped tool
 * visibility, checks the caller's permission class, validates arguments against
 * the tool's schema, executes under a timeout, validates and bounds the result,
 * and writes a `tool_calls` audit row for the outcome. Side-effect-capable tools
 * additionally de-duplicate by idempotency key. Read-only tools ignore the key
 * (reads are naturally idempotent). Blocked results (visibility/permission) never
 * run the handler.
 */
export function createToolExecutor(deps: ToolExecutorDeps): ToolExecutor {
  const maxOutputBytes = deps.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  const metrics = deps.metrics ?? createNoopSupportMetrics();
  const registry = new Map<string, RegisteredTool>();
  for (const tool of deps.tools) {
    registry.set(tool.definition.name, tool);
  }

  function blocked(
    toolName: string,
    sideEffectClass: ToolSideEffectClass,
    toolCallId: string,
    error: ToolCallError,
  ): ToolCallResult {
    return {
      status: "blocked",
      tool_call_id: toolCallId,
      tool_name: toolName,
      side_effect_class: sideEffectClass,
      error,
      idempotent_replay: false,
    };
  }

  return {
    listTools() {
      return deps.tools.map((tool) => tool.definition);
    },

    // Wraps the execution in a span + tool-call metrics keyed by the final
    // outcome; the audit trail itself is written by the store calls inside.
    async execute(context, request) {
      const startedAtMs = Date.now();

      return withSpan(
        "tool.execute",
        {
          [SUPPORT_ATTR.tenantId]: context.tenantId,
          [SUPPORT_ATTR.ticketId]: context.ticketId,
          [SUPPORT_ATTR.aiRunId]: context.aiRunId,
          [SUPPORT_ATTR.toolName]: request.tool_name,
        },
        async (span) => {
          const result = await executeToolCall(context, request);

          span.setAttribute(SUPPORT_ATTR.outcome, result.status);
          metrics.recordToolCall({
            tool: request.tool_name,
            status: result.status,
            sideEffectClass: result.side_effect_class,
            durationMs: Date.now() - startedAtMs,
          });

          return result;
        },
      );
    },

    async close() {
      await deps.store.close?.();
    },
  };

  async function executeToolCall(
    context: ToolExecutionContext,
    request: ToolCallRequest,
  ): Promise<ToolCallResult> {
    const toolName = request.tool_name;
    const tool = registry.get(toolName);

    // Resolve tenant-scoped visibility first. A tool that is not visible to the
    // tenant (no active tool_definition row) never becomes a tenant tool call,
    // so there is no definition to anchor an audit row to.
    const resolved = await deps.store.resolveDefinition(
      context.tenantId,
      toolName,
    );
    if (!resolved) {
      return blocked(
        toolName,
        tool?.definition.sideEffectClass ?? "read_only",
        "",
        {
          code: "not_visible",
          message: `Tool "${toolName}" is not enabled for this tenant.`,
        },
      );
    }

    const sideEffectClass = resolved.sideEffectClass;
    const grants = toGrantedSet(context.grantedPermissions);

    // The tenant enables a tool the code doesn't implement: a misconfiguration.
    // We have a definition id, so this attempt is audited as blocked.
    if (!tool) {
      const toolCallId = await deps.store.recordStart({
        tenantId: context.tenantId,
        ticketId: context.ticketId,
        aiRunId: context.aiRunId,
        toolDefinitionId: resolved.toolDefinitionId,
        sideEffectClass,
        input: request.arguments,
        idempotencyKey: null,
      });
      await deps.store.recordOutcome({
        tenantId: context.tenantId,
        toolCallId,
        status: "blocked",
        errorCode: "not_found",
        errorMessage: `Tool "${toolName}" has no registered implementation.`,
      });
      return blocked(toolName, sideEffectClass, toolCallId, {
        code: "not_found",
        message: `Tool "${toolName}" has no registered implementation.`,
      });
    }

    const isSideEffecting = sideEffectClass !== "read_only";
    const idempotencyKey = request.idempotency_key ?? null;

    // Idempotent replay: a side-effect tool retried with a used key returns the
    // stored outcome (success or failure) instead of re-applying the effect.
    if (isSideEffecting && idempotencyKey) {
      const prior = await deps.store.findByIdempotencyKey(
        context.tenantId,
        resolved.toolDefinitionId,
        idempotencyKey,
      );
      if (prior) {
        return replayResult(toolName, sideEffectClass, prior);
      }
    }

    // Permission class gate. The tool is visible, but the caller must hold the
    // tool's required permission class to run it. Audited as blocked.
    if (!grants.has(tool.definition.permission)) {
      const toolCallId = await deps.store.recordStart({
        tenantId: context.tenantId,
        ticketId: context.ticketId,
        aiRunId: context.aiRunId,
        toolDefinitionId: resolved.toolDefinitionId,
        sideEffectClass,
        input: request.arguments,
        idempotencyKey: null,
      });
      const error: ToolCallError = {
        code: "unauthorized",
        message: `Missing permission "${tool.definition.permission}" for tool "${toolName}".`,
      };
      await deps.store.recordOutcome({
        tenantId: context.tenantId,
        toolCallId,
        status: "blocked",
        errorCode: error.code,
        errorMessage: error.message,
      });
      return blocked(toolName, sideEffectClass, toolCallId, error);
    }

    // Argument validation. Malformed arguments are rejected before the handler
    // runs. Audited as failed (the request routed, but its arguments were bad).
    const parsedArgs = tool.argsSchema.safeParse(request.arguments);
    if (!parsedArgs.success) {
      const toolCallId = await deps.store.recordStart({
        tenantId: context.tenantId,
        ticketId: context.ticketId,
        aiRunId: context.aiRunId,
        toolDefinitionId: resolved.toolDefinitionId,
        sideEffectClass,
        input: request.arguments,
        idempotencyKey: null,
      });
      const error: ToolCallError = {
        code: "invalid_arguments",
        message: formatZodError(parsedArgs.error),
      };
      await deps.store.recordOutcome({
        tenantId: context.tenantId,
        toolCallId,
        status: "failed",
        errorCode: error.code,
        errorMessage: error.message,
      });
      return failed(toolName, sideEffectClass, toolCallId, error);
    }

    // Claim the idempotency key on the execution row (side-effect tools only).
    const toolCallId = await deps.store.recordStart({
      tenantId: context.tenantId,
      ticketId: context.ticketId,
      aiRunId: context.aiRunId,
      toolDefinitionId: resolved.toolDefinitionId,
      sideEffectClass,
      input: request.arguments,
      idempotencyKey: isSideEffecting ? idempotencyKey : null,
    });

    let rawOutput: JsonObject;
    try {
      rawOutput = await withTimeout(
        tool.handler(parsedArgs.data, context),
        tool.definition.timeoutMs,
      );
    } catch (caught) {
      const error: ToolCallError =
        caught === TIMEOUT_MARKER
          ? {
              code: "timeout",
              message: `Tool "${toolName}" exceeded ${tool.definition.timeoutMs}ms.`,
            }
          : {
              code: "tool_error",
              message:
                caught instanceof Error ? caught.message : "Tool failed.",
            };
      await deps.store.recordOutcome({
        tenantId: context.tenantId,
        toolCallId,
        status: "failed",
        errorCode: error.code,
        errorMessage: error.message,
      });
      return failed(toolName, sideEffectClass, toolCallId, error);
    }

    // Validate the shape of the result: an out-of-contract output must not be
    // handed to the AI runtime as if it were trusted, bounded data.
    const parsedResult = tool.resultSchema.safeParse(rawOutput);
    if (!parsedResult.success) {
      const error: ToolCallError = {
        code: "output_invalid",
        message: `Tool "${toolName}" returned an out-of-contract result.`,
      };
      await deps.store.recordOutcome({
        tenantId: context.tenantId,
        toolCallId,
        status: "failed",
        errorCode: error.code,
        errorMessage: error.message,
      });
      return failed(toolName, sideEffectClass, toolCallId, error);
    }

    const output = parsedResult.data;

    // Bound the result size. Oversized results are rejected, not truncated.
    if (serializedSize(output) > maxOutputBytes) {
      const error: ToolCallError = {
        code: "result_too_large",
        message: `Tool "${toolName}" result exceeds ${maxOutputBytes} bytes.`,
      };
      await deps.store.recordOutcome({
        tenantId: context.tenantId,
        toolCallId,
        status: "failed",
        errorCode: error.code,
        errorMessage: error.message,
      });
      return failed(toolName, sideEffectClass, toolCallId, error);
    }

    await deps.store.recordOutcome({
      tenantId: context.tenantId,
      toolCallId,
      status: "succeeded",
      output,
    });

    return {
      status: "succeeded",
      tool_call_id: toolCallId,
      tool_name: toolName,
      side_effect_class: sideEffectClass,
      output,
      idempotent_replay: false,
    };
  }
}

function failed(
  toolName: string,
  sideEffectClass: ToolSideEffectClass,
  toolCallId: string,
  error: ToolCallError,
): ToolCallResult {
  return {
    status: "failed",
    tool_call_id: toolCallId,
    tool_name: toolName,
    side_effect_class: sideEffectClass,
    error,
    idempotent_replay: false,
  };
}

function replayResult(
  toolName: string,
  sideEffectClass: ToolSideEffectClass,
  prior: PriorToolCall,
): ToolCallResult {
  if (prior.status === "succeeded" && prior.output) {
    return {
      status: "succeeded",
      tool_call_id: prior.toolCallId,
      tool_name: toolName,
      side_effect_class: sideEffectClass,
      output: prior.output,
      idempotent_replay: true,
    };
  }
  return {
    status: "failed",
    tool_call_id: prior.toolCallId,
    tool_name: toolName,
    side_effect_class: sideEffectClass,
    error: {
      code: prior.errorCode ?? "tool_error",
      message:
        prior.errorMessage ??
        "A previous call with this idempotency key did not succeed.",
    },
    idempotent_replay: true,
  };
}

function formatZodError(error: z.ZodError): string {
  const [first] = error.issues;
  if (!first) {
    return "Invalid arguments.";
  }
  const path = first.path.join(".");
  return path ? `${path}: ${first.message}` : first.message;
}

// --- In-memory store (unit tests) --------------------------------------------

/** A tool-definition row as the in-memory store sees it (mirrors the DB table). */
export interface InMemoryToolDefinitionRow {
  readonly toolDefinitionId: string;
  readonly tenantId: string | null;
  readonly name: string;
  readonly sideEffectClass: ToolSideEffectClass;
  readonly status: "active" | "disabled" | "archived";
}

export interface RecordedToolCall {
  readonly toolCallId: string;
  readonly tenantId: string;
  readonly ticketId: string;
  readonly aiRunId: string;
  readonly toolDefinitionId: string;
  readonly sideEffectClass: ToolSideEffectClass;
  readonly input: JsonObject;
  readonly idempotencyKey: string | null;
  status: "planned" | "running" | "succeeded" | "failed" | "blocked";
  output: JsonObject | null;
  errorCode: ToolCallErrorCode | null;
  errorMessage: string | null;
}

export interface InMemoryToolRegistryStore extends ToolRegistryStore {
  /** All recorded tool calls, in insertion order (for audit assertions). */
  listCalls(): readonly RecordedToolCall[];
}

/**
 * In-memory tool registry store for unit tests. `resolveDefinition` mirrors
 * `visibleToolDefinitionByNameQuery` (tenant-scoped OR global, active only) and
 * the call log enforces the same idempotency uniqueness as the DB index.
 */
export function createInMemoryToolRegistryStore(
  definitions: readonly InMemoryToolDefinitionRow[],
): InMemoryToolRegistryStore {
  const calls: RecordedToolCall[] = [];

  return {
    async resolveDefinition(tenantId, toolName) {
      const match = definitions.find(
        (row) =>
          row.name === toolName &&
          row.status === "active" &&
          (row.tenantId === tenantId || row.tenantId === null),
      );
      return match
        ? {
            toolDefinitionId: match.toolDefinitionId,
            sideEffectClass: match.sideEffectClass,
          }
        : null;
    },

    async findByIdempotencyKey(tenantId, toolDefinitionId, idempotencyKey) {
      const match = calls.find(
        (call) =>
          call.tenantId === tenantId &&
          call.toolDefinitionId === toolDefinitionId &&
          call.idempotencyKey === idempotencyKey,
      );
      return match
        ? {
            toolCallId: match.toolCallId,
            status: match.status,
            output: match.output,
            errorCode: match.errorCode,
            errorMessage: match.errorMessage,
          }
        : null;
    },

    async recordStart(params) {
      if (params.idempotencyKey) {
        const clash = calls.some(
          (call) =>
            call.tenantId === params.tenantId &&
            call.toolDefinitionId === params.toolDefinitionId &&
            call.idempotencyKey === params.idempotencyKey,
        );
        if (clash) {
          throw new Error("duplicate idempotency key");
        }
      }
      const toolCallId = `tcl_${randomUUID()}`;
      calls.push({
        toolCallId,
        tenantId: params.tenantId,
        ticketId: params.ticketId,
        aiRunId: params.aiRunId,
        toolDefinitionId: params.toolDefinitionId,
        sideEffectClass: params.sideEffectClass,
        input: params.input,
        idempotencyKey: params.idempotencyKey,
        status: "running",
        output: null,
        errorCode: null,
        errorMessage: null,
      });
      return toolCallId;
    },

    async recordOutcome(params) {
      const call = calls.find(
        (entry) => entry.toolCallId === params.toolCallId,
      );
      if (!call) {
        return;
      }
      call.status = params.status;
      call.output = params.output ?? null;
      call.errorCode = params.errorCode ?? null;
      call.errorMessage = params.errorMessage ?? null;
    },

    listCalls() {
      return calls;
    },
  };
}

// --- Database store ----------------------------------------------------------

/**
 * PostgreSQL tool registry store. Each operation runs under
 * `withTenantTransaction` so RLS confines reads/writes to the calling tenant.
 * `resolveDefinition` reuses `visibleToolDefinitionByNameQuery` (Milestone 8's
 * required reuse surface); the `record*` methods persist the `tool_calls` audit
 * trail, whose unique idempotency index enforces at-most-once side effects.
 */
export function createDatabaseToolRegistryStore(
  database?: ReturnType<typeof createDatabaseFromEnv>,
): ToolRegistryStore {
  let handle = database;

  function getClient(): PostgresClient {
    if (!handle) {
      handle = createDatabaseFromEnv();
    }
    return handle.client;
  }

  return {
    async resolveDefinition(tenantId, toolName) {
      return withTenantTransaction(getClient(), { tenantId }, async (db) => {
        const [row] = await visibleToolDefinitionByNameQuery(
          db,
          { tenantId },
          toolName,
        );
        return row
          ? {
              toolDefinitionId: row.toolDefinitionId,
              sideEffectClass: row.sideEffectClass,
            }
          : null;
      });
    },

    async findByIdempotencyKey(tenantId, toolDefinitionId, idempotencyKey) {
      return withTenantTransaction(getClient(), { tenantId }, async (db) => {
        const [row] = await toolCallByIdempotencyKeyQuery(
          db,
          { tenantId },
          { toolDefinitionId, idempotencyKey },
        );
        return row
          ? {
              toolCallId: row.toolCallId,
              status: row.status,
              output: row.output ?? null,
              errorCode: (row.errorCode as ToolCallErrorCode | null) ?? null,
              errorMessage: row.errorMessage ?? null,
            }
          : null;
      });
    },

    async recordStart(params) {
      const toolCallId = `tcl_${randomUUID()}`;
      await withTenantTransaction(
        getClient(),
        { tenantId: params.tenantId },
        async (db) => {
          await insertToolCallQuery(
            db,
            { tenantId: params.tenantId },
            {
              toolCallId,
              ticketId: params.ticketId,
              aiRunId: params.aiRunId,
              toolDefinitionId: params.toolDefinitionId,
              sideEffectClass: params.sideEffectClass,
              input: params.input,
              status: "running",
              idempotencyKey: params.idempotencyKey,
              startedAt: new Date(),
            },
          );
        },
      );
      return toolCallId;
    },

    async recordOutcome(params) {
      await withTenantTransaction(
        getClient(),
        { tenantId: params.tenantId },
        async (db) => {
          await updateToolCallByIdQuery(
            db,
            { tenantId: params.tenantId },
            params.toolCallId,
            {
              status: params.status,
              output: params.output ?? null,
              errorCode: params.errorCode ?? null,
              errorMessage: params.errorMessage ?? null,
              completedAt: new Date(),
            },
          );
        },
      );
    },

    async close() {
      if (handle) {
        await handle.client.end();
      }
    },
  };
}
