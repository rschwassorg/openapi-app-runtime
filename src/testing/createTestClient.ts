import request from 'supertest';
import type { Express } from 'express';

export function createTestClient(app: Express): request.Agent {
  return request(app);
}
