import path from 'node:path';

import jwt from 'jsonwebtoken';
import { describe, expect, it } from 'vitest';

import { ApiError, createOpenApiApp, type OpenApiHandler } from '../src/index.js';
import { createTestClient } from '../src/testing/createTestClient.js';

process.env.NODE_ENV = 'test';

const specPath = path.join(process.cwd(), 'test/fixtures/openapi.yaml');
const jwtSecret = 'test-secret';
const apiKey = 'test-api-key';

function handlers(overrides: Record<string, OpenApiHandler> = {}): Record<string, OpenApiHandler> {
  return {
    healthCheck: (_context, _req, res) => res.json({ ok: true }),
    createWidget: (context, _req, res) => {
      const body = context.request.requestBody as { name: string };
      return res.status(201).json({ id: 'widget-1', name: body.name });
    },
    getWidget: (context, req, res) => {
      return res.json({
        id: String(context.request.params?.widgetId),
        name: 'Existing widget',
        ownerId: req.user?.id,
      });
    },
    adminOnly: (_context, req, res) => res.json({ admin: true, userId: req.user?.id }),
    ...overrides,
  };
}

async function appWith(overrides: Parameters<typeof createOpenApiApp>[0] = {}) {
  return createOpenApiApp({
    name: 'runtime-test',
    specPath,
    handlers: handlers(),
    auth: {
      apiKey,
      jwtSecret,
    },
    ...overrides,
  });
}

describe('createOpenApiApp', () => {
  it('dispatches operationId handlers', async () => {
    const app = await appWith();
    const response = await createTestClient(app).get('/health').expect(200);
    expect(response.body).toEqual({ ok: true });
  });

  it('serves OpenAPI JSON and Swagger UI docs by default', async () => {
    const app = await appWith();
    const openApiResponse = await createTestClient(app).get('/openapi.json').expect(200);
    expect(openApiResponse.body.info.title).toBe('Runtime Fixture API');

    const docsResponse = await createTestClient(app).get('/docs/').expect(200);
    expect(docsResponse.text).toContain('Swagger UI');
  });

  it('can disable docs routes', async () => {
    const app = await appWith({ docs: false });
    await createTestClient(app).get('/openapi.json').expect(404);
    await createTestClient(app).get('/docs/').expect(404);
  });

  it('can pass selected request paths through to later middleware', async () => {
    const app = await appWith({
      docs: false,
      handleRequestPath: (req) => req.path.startsWith('/health'),
    });
    app.get('/spa', (_req, res) => res.type('html').send('<main>SPA</main>'));

    await createTestClient(app).get('/health').expect(200);
    const response = await createTestClient(app).get('/spa').expect(200);
    expect(response.text).toBe('<main>SPA</main>');
  });

  it('returns standard validation errors', async () => {
    const app = await appWith();
    const response = await createTestClient(app)
      .post('/widgets')
      .set('x-api-key', apiKey)
      .send({})
      .expect(400);

    expect(response.body.error).toBe('validation_failed');
    expect(response.body.message).toBe('Request failed OpenAPI validation');
    expect(response.body.requestId).toBeTruthy();
    expect(response.body.details).toEqual(expect.any(Array));
  });

  it('validates apiKeyAuth with x-api-key', async () => {
    const app = await appWith();
    await createTestClient(app).post('/widgets').send({ name: 'No key' }).expect(401);

    const response = await createTestClient(app)
      .post('/widgets')
      .set('x-api-key', apiKey)
      .send({ name: 'Valid key' })
      .expect(201);

    expect(response.body).toEqual({ id: 'widget-1', name: 'Valid key' });
  });

  it('validates bearerAuth and assigns req.user', async () => {
    const app = await appWith();
    const token = jwt.sign({ sub: 'user-1', roles: ['owner'] }, jwtSecret);
    const response = await createTestClient(app)
      .get('/widgets/widget-1')
      .set('authorization', `Bearer ${token}`)
      .expect(200);

    expect(response.body.ownerId).toBe('user-1');
  });

  it('supports custom security handlers', async () => {
    const app = await appWith({
      auth: {
        apiKey,
        jwtSecret,
        securityHandlers: {
          customAdmin: async (_context, req) => {
            if (req.headers['x-admin-token'] !== 'admin-token') {
              throw new ApiError(403, 'forbidden', 'Admin token is invalid');
            }
            return { id: 'admin-1', roles: ['admin'] };
          },
        },
      },
    });

    await createTestClient(app).get('/admin').expect(403);
    const response = await createTestClient(app).get('/admin').set('x-admin-token', 'admin-token').expect(200);
    expect(response.body).toEqual({ admin: true, userId: 'admin-1' });
  });

  it('returns standard not implemented errors for missing handlers', async () => {
    const app = await appWith();
    const response = await createTestClient(app).get('/missing').expect(501);
    expect(response.body.error).toBe('not_implemented');
    expect(response.body.operationId).toBe('missingHandler');
  });

  it('propagates or generates x-request-id', async () => {
    const app = await appWith();
    const provided = await createTestClient(app).get('/missing').set('x-request-id', 'request-123').expect(501);
    expect(provided.headers['x-request-id']).toBe('request-123');
    expect(provided.body.requestId).toBe('request-123');

    const generated = await createTestClient(app).get('/missing').expect(501);
    expect(generated.headers['x-request-id']).toBeTruthy();
    expect(generated.body.requestId).toBe(generated.headers['x-request-id']);
  });
});
