import { z } from "zod";

const JsonObjectSchema = z.record(z.string(), z.unknown());

export const ServiceNameSchema = z.enum([
  "api",
  "workers",
  "ai-runtime",
  "db",
  "integrations",
]);

export const HealthStatusSchema = z.enum(["ok", "degraded", "down"]);

export const HealthResponseSchema = z.object({
  service: ServiceNameSchema,
  status: HealthStatusSchema,
  timestamp: z.string().datetime(),
  version: z.string(),
});

export type ServiceName = z.infer<typeof ServiceNameSchema>;
export type HealthStatus = z.infer<typeof HealthStatusSchema>;
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

export function createHealthResponse(
  service: ServiceName,
  status: HealthStatus = "ok",
  version = "0.1.0",
): HealthResponse {
  return HealthResponseSchema.parse({
    service,
    status,
    timestamp: new Date().toISOString(),
    version,
  });
}

export const ApiErrorCodeSchema = z.enum([
  "VALIDATION_ERROR",
  "AUTH_REQUIRED",
  "FORBIDDEN",
  "TENANT_CONTEXT_REQUIRED",
  "TENANT_NOT_FOUND",
  "RESOURCE_NOT_FOUND",
  "CONFLICT",
  "IDEMPOTENCY_CONFLICT",
  "RATE_LIMITED",
  "PROVIDER_ERROR",
  "WORKFLOW_ERROR",
  "AI_RUNTIME_ERROR",
  "TOOL_EXECUTION_ERROR",
  "INTERNAL_ERROR",
]);

export const ApiErrorResponseSchema = z.object({
  error: z.object({
    code: ApiErrorCodeSchema,
    message: z.string().min(1),
    details: z.array(z.unknown()).default([]),
    request_id: z.string().min(1),
  }),
});

export type ApiErrorCode = z.infer<typeof ApiErrorCodeSchema>;
export type ApiErrorResponse = z.infer<typeof ApiErrorResponseSchema>;

export const RoleNameSchema = z.enum([
  "platform_admin",
  "ops_admin",
  "support_agent",
  "qa_reviewer",
  "client_viewer",
  "integration_admin",
]);

export type RoleName = z.infer<typeof RoleNameSchema>;

export const TenantResponseSchema = z.object({
  tenant_id: z.string().min(1),
  name: z.string().min(1),
  status: z.enum(["active", "suspended", "archived"]),
  default_timezone: z.string().min(1),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

export const TenantResourceResponseSchema = z.object({
  tenant: TenantResponseSchema,
});

export type TenantResponse = z.infer<typeof TenantResponseSchema>;
export type TenantResourceResponse = z.infer<
  typeof TenantResourceResponseSchema
>;

export const CustomerResponseSchema = z.object({
  customer_id: z.string().min(1),
  tenant_id: z.string().min(1),
  display_name: z.string().nullable(),
  email: z.string().email().nullable(),
  phone: z.string().nullable(),
  external_customer_ref: z.string().nullable(),
  metadata: JsonObjectSchema,
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

export const CustomerResourceResponseSchema = z.object({
  customer: CustomerResponseSchema,
});

export type CustomerResponse = z.infer<typeof CustomerResponseSchema>;
export type CustomerResourceResponse = z.infer<
  typeof CustomerResourceResponseSchema
>;

export const TicketStatusSchema = z.enum([
  "new",
  "triaged",
  "waiting_ai",
  "waiting_human",
  "waiting_customer",
  "resolved",
  "closed",
  "reopened",
  "failed",
]);

export const TicketPrioritySchema = z.enum(["p0", "p1", "p2", "p3"]);

export const AutomationModeSchema = z.enum([
  "auto_send",
  "human_approve",
  "human_only",
]);

export const TicketResponseSchema = z.object({
  ticket_id: z.string().min(1),
  tenant_id: z.string().min(1),
  conversation_id: z.string().min(1),
  customer_id: z.string().min(1),
  status: TicketStatusSchema,
  priority: TicketPrioritySchema,
  topic: z.string().nullable(),
  subtopic: z.string().nullable(),
  language: z.string().nullable(),
  sentiment: z.string().nullable(),
  urgency_score: z.number().int().nullable(),
  automation_mode: AutomationModeSchema,
  assigned_queue: z.string().nullable(),
  assigned_user_id: z.string().nullable(),
  sla_policy_id: z.string().nullable(),
  policy_version_id: z.string().nullable(),
  opened_at: z.string().datetime(),
  first_response_due_at: z.string().datetime().nullable(),
  next_response_due_at: z.string().datetime().nullable(),
  resolution_due_at: z.string().datetime().nullable(),
  resolved_at: z.string().datetime().nullable(),
  closed_at: z.string().datetime().nullable(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

export const TicketResourceResponseSchema = z.object({
  ticket: TicketResponseSchema,
});

export type TicketStatus = z.infer<typeof TicketStatusSchema>;
export type TicketPriority = z.infer<typeof TicketPrioritySchema>;
export type AutomationMode = z.infer<typeof AutomationModeSchema>;
export type TicketResponse = z.infer<typeof TicketResponseSchema>;
export type TicketResourceResponse = z.infer<
  typeof TicketResourceResponseSchema
>;
