import { randomUUID } from 'node:crypto';
import type { NextFunction, Response } from 'express';
import type { RuntimeRequest } from './types.js';

export function requestContext(req: RuntimeRequest, res: Response, next: NextFunction): void {
  const headerValue = req.headers['x-request-id'];
  req.id = Array.isArray(headerValue) ? headerValue[0] || randomUUID() : headerValue || randomUUID();
  res.setHeader('x-request-id', req.id);
  next();
}
