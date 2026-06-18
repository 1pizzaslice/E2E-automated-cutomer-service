import { z } from "zod";

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
