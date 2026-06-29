import jwt from 'jsonwebtoken';
import { ApiError } from './errors.js';
import type { OpenApiHandlerContext, RuntimeAuthOptions, RuntimeRequest, RuntimeUser, SecurityHandler } from './types.js';
import type { Response } from 'express';

function userFromJwtPayload(payload: string | jwt.JwtPayload): RuntimeUser {
  if (typeof payload === 'string') return { id: payload };
  const roles = Array.isArray(payload.roles) ? payload.roles.filter((role): role is string => typeof role === 'string') : undefined;
  return {
    ...payload,
    id: typeof payload.sub === 'string' ? payload.sub : typeof payload.id === 'string' ? payload.id : undefined,
    ...(roles ? { roles } : {}),
  };
}

export function createSecurityHandlers(auth: RuntimeAuthOptions = {}): Record<string, SecurityHandler> {
  const builtInHandlers: Record<string, SecurityHandler> = {
    bearerAuth: async (_context: OpenApiHandlerContext, req: RuntimeRequest) => {
      if (!auth.jwtSecret) throw new ApiError(500, 'internal_error', 'JWT auth is not configured');
      const authorization = req.headers.authorization || '';
      const match = /^Bearer\s+(.+)$/i.exec(Array.isArray(authorization) ? authorization[0] || '' : authorization);
      if (!match) throw new ApiError(401, 'unauthorized', 'Bearer token is required');
      try {
        const payload = jwt.verify(match[1], auth.jwtSecret);
        req.user = userFromJwtPayload(payload);
        return true;
      } catch {
        throw new ApiError(401, 'unauthorized', 'Bearer token is invalid');
      }
    },
    apiKeyAuth: async (_context: OpenApiHandlerContext, req: RuntimeRequest) => {
      if (!auth.apiKey) throw new ApiError(500, 'internal_error', 'API key auth is not configured');
      const headerValue = req.headers['x-api-key'];
      const apiKey = Array.isArray(headerValue) ? headerValue[0] : headerValue;
      if (!apiKey || apiKey !== auth.apiKey) throw new ApiError(401, 'unauthorized', 'API key is invalid');
      return true;
    },
  };

  return {
    ...builtInHandlers,
    ...(auth.securityHandlers || {}),
  };
}

export async function runSecurityHandler(
  handler: SecurityHandler,
  context: OpenApiHandlerContext,
  req: RuntimeRequest,
  res: Response
): Promise<boolean> {
  try {
    const result = await handler(context, req, res);
    if (res.headersSent) return false;
    if (result && typeof result === 'object') req.user = result;
    return result !== false;
  } catch (error) {
    if (error instanceof ApiError) {
      (req as RuntimeRequest & { authError?: ApiError }).authError = error;
      return false;
    }
    throw error;
  }
}
