import type { Response } from 'express';
import type { ErrorResponseBody, RuntimeRequest } from './types.js';

export class ApiError extends Error {
  statusCode: number;
  code: string;
  details?: unknown;
  operationId?: string;

  constructor(statusCode: number, code: string, message: string, options: { details?: unknown; operationId?: string } = {}) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = options.details;
    this.operationId = options.operationId;
  }
}

export function createErrorResponse(error: ApiError, requestId: string): ErrorResponseBody {
  return {
    error: error.code,
    message: error.message,
    requestId,
    ...(error.details == null ? {} : { details: error.details }),
    ...(error.operationId ? { operationId: error.operationId } : {}),
  };
}

export function sendApiError(res: Response, req: RuntimeRequest, error: ApiError): void {
  res.status(error.statusCode).json(createErrorResponse(error, req.id));
}

export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (error instanceof Error) return new ApiError(500, 'internal_error', error.message || 'Internal server error');
  return new ApiError(500, 'internal_error', 'Internal server error');
}
