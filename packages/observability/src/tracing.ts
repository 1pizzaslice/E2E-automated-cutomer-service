import {
  SpanStatusCode,
  trace,
  type Attributes,
  type Span,
  type Tracer,
} from "@opentelemetry/api";
import { SUPPORT_INSTRUMENTATION_SCOPE } from "./telemetry.js";

export interface ActiveTraceContext {
  trace_id: string;
  span_id: string;
}

/**
 * Returns the active span's trace/span ids for log correlation, or null
 * when no recording span is active (e.g. telemetry disabled).
 */
export function getActiveTraceContext(): ActiveTraceContext | null {
  const span = trace.getActiveSpan();
  if (span === undefined) {
    return null;
  }
  const spanContext = span.spanContext();
  if (!trace.isSpanContextValid(spanContext)) {
    return null;
  }
  return { trace_id: spanContext.traceId, span_id: spanContext.spanId };
}

export function getSupportTracer(): Tracer {
  return trace.getTracer(SUPPORT_INSTRUMENTATION_SCOPE);
}

/**
 * Runs `fn` inside an active span. Errors are recorded on the span and
 * rethrown; the span always ends. With no SDK registered this is a no-op
 * passthrough, so callers never need to guard on telemetry being enabled.
 */
export async function withSpan<T>(
  name: string,
  attributes: Attributes,
  fn: (span: Span) => Promise<T>,
  tracer: Tracer = getSupportTracer(),
): Promise<T> {
  return tracer.startActiveSpan(name, { attributes }, async (span) => {
    try {
      const result = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.recordException(
        error instanceof Error ? error : new Error(String(error)),
      );
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      span.end();
    }
  });
}
