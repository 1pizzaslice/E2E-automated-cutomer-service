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
    const httpError =
      error instanceof HttpError
        ? error
        : new HttpError(500, "INTERNAL_ERROR", "An internal error occurred.");

    if (!(error instanceof HttpError)) {
      request.log.error({ error }, "unhandled api error");
    }

    reply
      .status(httpError.statusCode)
      .send(createErrorResponse(httpError, requestId));
  });
}
