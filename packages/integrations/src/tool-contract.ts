import { z } from "zod";

export const ToolSideEffectClassSchema = z.enum([
  "read_only",
  "draft_side_effect",
  "reversible_write",
  "irreversible_write",
]);

export const ToolDefinitionSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  permission: z.string().min(1),
  sideEffectClass: ToolSideEffectClassSchema,
  requiresHumanApproval: z.boolean(),
  timeoutMs: z.number().int().positive(),
});

export type ToolSideEffectClass = z.infer<typeof ToolSideEffectClassSchema>;
export type ToolDefinition = z.infer<typeof ToolDefinitionSchema>;

export function defineReadOnlyTool(
  input: Omit<ToolDefinition, "sideEffectClass" | "requiresHumanApproval">,
): ToolDefinition {
  return ToolDefinitionSchema.parse({
    ...input,
    sideEffectClass: "read_only",
    requiresHumanApproval: false,
  });
}
