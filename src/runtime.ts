import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Ajv } from 'ajv';
import cors from 'cors';
import express, { type Express, type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import helmet from 'helmet';
import formatsPlugin from 'ajv-formats';
import { OpenAPIBackend, type Context as BackendContext, type Document, type Request as BackendRequest } from 'openapi-backend';
import { pinoHttp } from 'pino-http';
import swaggerUi from 'swagger-ui-express';
import YAML from 'yaml';

import { createSecurityHandlers, runSecurityHandler } from './auth.js';
import { ApiError, sendApiError, toApiError } from './errors.js';
import { requestContext } from './requestContext.js';
import type { CreateOpenApiAppOptions, OpenApiHandlerContext, RuntimeRequest } from './types.js';

type OpenApiBackendContext = BackendContext;
const addFormats = formatsPlugin as unknown as (ajv: Ajv) => void;

function resolveSpecPath(specPath: string): string {
  if (specPath.startsWith('file://')) return fileURLToPath(specPath);
  return path.resolve(process.cwd(), specPath);
}

function loadOpenApiDocument(specPath: string): Document {
  const resolvedPath = resolveSpecPath(specPath);
  const content = fs.readFileSync(resolvedPath, 'utf8');
  if (resolvedPath.endsWith('.json')) return JSON.parse(content) as Document;
  return YAML.parse(content) as Document;
}

function requestHeaders(req: RuntimeRequest): Record<string, string | string[]> {
  const headers: Record<string, string | string[]> = {};
  for (const [name, value] of Object.entries(req.headers)) {
    if (typeof value === 'string' || Array.isArray(value)) headers[name] = value;
  }
  return headers;
}

function requestQuery(req: RuntimeRequest): Record<string, string | string[]> {
  const query: Record<string, string | string[]> = {};
  for (const [name, value] of Object.entries(req.query)) {
    if (typeof value === 'string') {
      query[name] = value;
    } else if (Array.isArray(value)) {
      query[name] = value.map((entry) => String(entry));
    } else if (value != null) {
      query[name] = String(value);
    }
  }
  return query;
}

function createBackendRequest(req: RuntimeRequest): BackendRequest {
  return {
    method: req.method,
    path: req.path,
    body: req.body,
    query: requestQuery(req),
    headers: requestHeaders(req),
  };
}

function extractOperationId(context: OpenApiBackendContext): string {
  return String(context.operation?.operationId || '');
}

function declaredSecuritySchemes(document: Document): Set<string> {
  const securitySchemes = (document.components as { securitySchemes?: Record<string, unknown> } | undefined)?.securitySchemes || {};
  return new Set(Object.keys(securitySchemes));
}

function createUnhandledOperationHandler(operationId: string) {
  return async (_context: OpenApiHandlerContext, req: RuntimeRequest, res: Response) => {
    sendApiError(res, req, new ApiError(501, 'not_implemented', 'Handler not implemented', { operationId }));
  };
}

export async function createOpenApiApp(options: CreateOpenApiAppOptions): Promise<Express> {
  const {
    name,
    specPath,
    handlers,
    auth = {},
    corsOptions = {},
    docs = true,
    beforeMiddleware = [],
  } = options;

  const document = loadOpenApiDocument(specPath);
  const app = express();
  const securityHandlers = createSecurityHandlers(auth);
  const securitySchemes = declaredSecuritySchemes(document);

  app.disable('x-powered-by');
  for (const middleware of beforeMiddleware) app.use(middleware);
  app.use(helmet());
  app.use(cors(corsOptions));
  app.use(express.json({ limit: '1mb' }));
  app.use(requestContext as RequestHandler);
  app.use(pinoHttp({
    name,
    enabled: process.env.NODE_ENV !== 'test',
    customProps: (req: Request) => ({ requestId: (req as RuntimeRequest).id }),
  }) as RequestHandler);

  if (docs) {
    app.get('/openapi.json', (_req, res) => res.json(document));
    app.use('/docs', swaggerUi.serve, swaggerUi.setup(document as Record<string, unknown>));
  }

  const api = new OpenAPIBackend({
    definition: document,
    quick: true,
    customizeAjv: (ajv) => {
      addFormats(ajv);
      return ajv;
    },
  });

  api.register({
    ...handlers,
    validationFail: async (context, req: RuntimeRequest, res: Response) => {
      sendApiError(res, req, new ApiError(400, 'validation_failed', 'Request failed OpenAPI validation', {
        details: context.validation?.errors || [],
      }));
    },
    notFound: async (_context, req: RuntimeRequest, res: Response) => {
      sendApiError(res, req, new ApiError(404, 'not_found', 'Route not found'));
    },
    notImplemented: async (context, req: RuntimeRequest, res: Response) => {
      const operationId = extractOperationId(context);
      await createUnhandledOperationHandler(operationId)(context, req, res);
    },
  });
  api.register('unauthorizedHandler', async (_context, req: RuntimeRequest, res: Response) => {
    const authError = (req as RuntimeRequest & { authError?: ApiError }).authError;
    sendApiError(res, req, authError || new ApiError(401, 'unauthorized', 'Authentication is required'));
  });

  for (const [schemeName, handler] of Object.entries(securityHandlers)) {
    if (!securitySchemes.has(schemeName)) continue;
    api.registerSecurityHandler(schemeName, async (context: OpenApiBackendContext, req: RuntimeRequest, res: Response) => {
      return runSecurityHandler(handler, context, req, res);
    });
  }

  await api.init();

  app.use(async (req: Request, res: Response, next: NextFunction) => {
    try {
      await api.handleRequest(createBackendRequest(req as RuntimeRequest), req, res);
      if (!res.headersSent) next();
    } catch (error) {
      next(error);
    }
  });

  app.use((error: unknown, req: Request, res: Response, _next: NextFunction) => {
    if (res.headersSent) return;
    sendApiError(res, req as RuntimeRequest, toApiError(error));
  });

  return app;
}
