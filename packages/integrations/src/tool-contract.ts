import { z } from "zod";
import {
  ToolPermissionClassSchema,
  ToolSideEffectClassSchema,
  type ToolPermissionClass,
  type ToolSideEffectClass,
} from "@support/shared-schemas";

// The canonical side-effect and permission class enums live in
// `@support/shared-schemas` (they are shared with the DB contract and the AI
// runtime). They are re-exported here so the historical
// `@support/integrations/tool-contract` surface stays stable for callers.
export {
  ToolPermissionClassSchema,
  ToolSideEffectClassSchema,
  type ToolPermissionClass,
  type ToolSideEffectClass,
};

/**
 * Declarative metadata for a tool the AI runtime or a workflow may execute.
 * This is the contract half of a tool; the executable half (argument/result
 * schemas + handler) is registered at runtime in the tool registry. `permission`
 * is a canonical permission class the caller must be granted; `sideEffectClass`
 * drives idempotency and approval gating; `timeoutMs` bounds execution.
 */
export const ToolDefinitionSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  permission: ToolPermissionClassSchema,
  sideEffectClass: ToolSideEffectClassSchema,
  requiresHumanApproval: z.boolean(),
  timeoutMs: z.number().int().positive(),
});

export type ToolDefinition = z.infer<typeof ToolDefinitionSchema>;

/**
 * Build a read-only tool definition: it observes state, never mutates, and needs
 * no human approval. Read-only is the safe default for the first-party lookup
 * and calculator tools.
 */
export function defineReadOnlyTool(
  input: Omit<ToolDefinition, "sideEffectClass" | "requiresHumanApproval">,
): ToolDefinition {
  return ToolDefinitionSchema.parse({
    ...input,
    sideEffectClass: "read_only",
    requiresHumanApproval: false,
  });
}

/**
 * Build a side-effect-capable tool definition. Anything that is not `read_only`
 * mutates external state, so it defaults to requiring human approval (callers may
 * override once an auto-send allowlist exists) and is eligible for idempotency
 * de-duplication in the executor.
 */
export function defineSideEffectTool(
  input: Omit<ToolDefinition, "requiresHumanApproval"> & {
    readonly sideEffectClass: Exclude<ToolSideEffectClass, "read_only">;
    readonly requiresHumanApproval?: boolean;
  },
): ToolDefinition {
  const { requiresHumanApproval, ...rest } = input;
  return ToolDefinitionSchema.parse({
    ...rest,
    requiresHumanApproval: requiresHumanApproval ?? true,
  });
}
