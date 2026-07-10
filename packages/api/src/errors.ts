import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import {
  ApiErrorResponseSchema,
  type ApiErrorCode,
  type ApiErrorResponse,
} from "@support/shared-schemas";

export class HttpError extends Error {
  readonly statusCode: number;
  readonly code: ApiErrorCode;
  readonly details: unknown[];

  constructor(
    statusCode: number,
    code: ApiErrorCode,
    message: string,
    details: unknown[] = [],
  ) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export function createErrorResponse(
  error: HttpError,
  requestId: string,
): ApiErrorResponse {
  return ApiErrorResponseSchema.parse({
    error: {
      code: error.code,
      message: error.message,
      details: error.details,
      request_id: requestId,
    },
  });
}

export function registerErrorHandler(app: {
  setErrorHandler: (
    handler: (
      error: FastifyError | Error,
      request: FastifyRequest,
      reply: FastifyReply,
    ) => Promise<void>,
  ) => void;
}) {
  app.setErrorHandler(async (error, request, reply) => {
    const requestId = request.requestContext?.requestId ?? request.id;
    const httpError = toHttpError(error);

    // 5xx are unexpected faults worth an error log; expected client errors
    // (including rate-limit rejections translated below) are not.
    if (!(error instanceof HttpError) && httpError.statusCode >= 500) {
      request.log.error({ error }, "unhandled api error");
    }

    reply
      .status(httpError.statusCode)
      .send(createErrorResponse(httpError, requestId));
  });
}

/**
 * Normalizes a thrown error to an `HttpError`. Everything unrecognized becomes
 * a masked 500; the one framework error we surface deliberately is the
 * `@fastify/rate-limit` 429 (Milestone 20), mapped to the taxonomy's
 * `RATE_LIMITED` code. Its `Retry-After` / `X-RateLimit-*` headers are already
 * on the reply and survive the error response.
 */
function toHttpError(error: FastifyError | Error): HttpError {
  if (error instanceof HttpError) {
    return error;
  }

  if ((error as FastifyError).statusCode === 429) {
    return new HttpError(
      429,
      "RATE_LIMITED",
      error.message || "Rate limit exceeded.",
    );
  }

  return new HttpError(500, "INTERNAL_ERROR", "An internal error occurred.");
}
