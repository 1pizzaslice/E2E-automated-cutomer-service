import type { FastifyInstance } from "fastify";
import {
  getSupportTracer,
  SUPPORT_ATTR,
  SpanStatusCode,
  type Span,
  type SupportMetrics,
} from "@support/observability";

declare module "fastify" {
  interface FastifyRequest {
    telemetrySpan?: Span;
  }
}

/**
 * Per-request tracing, metrics, and log correlation. Must be registered
 * after `registerRequestContext` so the request/correlation/tenant ids are
 * available as span attributes and log bindings.
 *
 * Each request gets a server span carrying the `support.*` correlation
 * attributes (the cross-process trace key — see ADR-0018), the request
 * logger is rebound with `trace_id`/`request_id`/`correlation_id`/
 * `tenant_id`, and every response records the API request metrics.
 */
export function registerRequestTelemetry(
  app: FastifyInstance,
  metrics: SupportMetrics,
): void {
  app.addHook("onRequest", async (request) => {
    const context = request.requestContext;
    const span = getSupportTracer().startSpan("http.request", {
      attributes: {
        "http.request.method": request.method,
        "url.path": getPathname(request.url),
        ...(context
          ? {
              [SUPPORT_ATTR.requestId]: context.requestId,
              [SUPPORT_ATTR.correlationId]: context.correlationId,
              ...(context.tenant
                ? { [SUPPORT_ATTR.tenantId]: context.tenant.tenantId }
                : {}),
            }
          : {}),
      },
    });
    request.telemetrySpan = span;

    const spanContext = span.spanContext();
    request.log = request.log.child({
      ...(context
        ? {
            request_id: context.requestId,
            correlation_id: context.correlationId,
            ...(context.tenant ? { tenant_id: context.tenant.tenantId } : {}),
          }
        : {}),
      trace_id: spanContext.traceId,
      span_id: spanContext.spanId,
    });
  });

  app.addHook("onResponse", async (request, reply) => {
    const route = request.routeOptions.url ?? getPathname(request.url);
    const statusCode = reply.statusCode;
    const durationMs = reply.elapsedTime;

    const span = request.telemetrySpan;
    if (span) {
      span.setAttributes({
        "http.route": route,
        "http.response.status_code": statusCode,
      });
      if (statusCode >= 500) {
        span.setStatus({ code: SpanStatusCode.ERROR });
      }
      span.end();
    }

    metrics.recordApiRequest({
      method: request.method,
      route,
      statusCode,
      durationMs,
    });
  });
}

function getPathname(url: string): string {
  return new URL(url, "http://localhost").pathname;
}
