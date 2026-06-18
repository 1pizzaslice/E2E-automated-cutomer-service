import {
  createHealthResponse,
  type HealthResponse,
} from "@support/shared-schemas";

export function getWorkerHealth(): HealthResponse {
  return createHealthResponse("workers");
}
