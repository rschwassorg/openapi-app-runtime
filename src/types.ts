import type { Request, Response } from 'express';
import type { RequestHandler } from 'express';
import type { CorsOptions } from 'cors';

export interface RuntimeUser {
  id?: string;
  roles?: string[];
  [key: string]: unknown;
}

export interface RuntimeRequest extends Request {
  id: string;
  user?: RuntimeUser;
}

export interface OpenApiRequestValues {
  params?: Record<string, unknown>;
  query?: Record<string, unknown>;
  requestBody?: unknown;
  headers?: Record<string, unknown>;
}

export interface OpenApiHandlerContext {
  request: OpenApiRequestValues;
  operation?: {
    operationId?: string;
    [key: string]: unknown;
  };
  validation?: {
    errors?: unknown[] | null;
  };
}

export type OpenApiHandler = (
  context: OpenApiHandlerContext,
  req: RuntimeRequest,
  res: Response
) => Promise<unknown> | unknown;

export type SecurityHandler = (
  context: OpenApiHandlerContext,
  req: RuntimeRequest,
  res: Response
) => Promise<boolean | RuntimeUser | void> | boolean | RuntimeUser | void;

export interface RuntimeAuthOptions {
  apiKey?: string;
  jwtSecret?: string;
  securityHandlers?: Record<string, SecurityHandler>;
}

export interface CreateOpenApiAppOptions {
  name: string;
  specPath: string;
  handlers: Record<string, OpenApiHandler>;
  auth?: RuntimeAuthOptions;
  corsOptions?: CorsOptions;
  docs?: boolean;
  beforeMiddleware?: RequestHandler[];
  handleApiRequests?: boolean;
}

export interface ErrorResponseBody {
  error: string;
  message: string;
  requestId: string;
  details?: unknown;
  operationId?: string;
}
