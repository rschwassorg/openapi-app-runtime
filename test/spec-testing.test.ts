import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { createOpenApiApp, type OpenApiHandler } from '../src/index.js';
import {
  assertOpenApiCoverage,
  assertOpenApiOperationTests,
  assertValidOpenApiSpec,
  checkOpenApiCoverage,
  validateOpenApiSpec,
  type OpenApiOperationTestCase,
} from '../src/testing/index.js';

process.env.NODE_ENV = 'test';

const specPath = path.join(process.cwd(), 'test/fixtures/openapi.yaml');
const apiKey = 'test-api-key';

function handlers(overrides: Record<string, OpenApiHandler> = {}): Record<string, OpenApiHandler> {
  return {
    healthCheck: (_context, _req, res) => res.json({ ok: true }),
    createWidget: (context, _req, res) => {
      const body = context.request.requestBody as { name: string };
      return res.status(201).json({ id: 'widget-1', name: body.name });
    },
    getWidget: (context, _req, res) => {
      return res.json({
        id: String(context.request.params?.widgetId),
        name: 'Existing widget',
      });
    },
    adminOnly: (_context, _req, res) => res.json({ admin: true }),
    missingHandler: (_context, _req, res) => res.json({ ok: true }),
    ...overrides,
  };
}

const operationCases: OpenApiOperationTestCase[] = [
  {
    operationId: 'healthCheck',
    request: { method: 'get', path: '/health' },
    expectedStatus: 200,
  },
  {
    operationId: 'createWidget',
    request: {
      method: 'post',
      path: '/widgets',
      headers: { 'x-api-key': apiKey },
      body: { name: 'Valid widget' },
    },
    expectedStatus: 201,
  },
];

describe('OpenAPI spec testing helpers', () => {
  it('validates a spec and lists operation metadata', async () => {
    const report = await validateOpenApiSpec({ specPath });

    expect(report.valid).toBe(true);
    expect(report.errors).toEqual([]);
    expect(report.operations).toEqual(expect.arrayContaining([
      expect.objectContaining({ method: 'GET', path: '/health', operationId: 'healthCheck' }),
      expect.objectContaining({ method: 'POST', path: '/widgets', operationId: 'createWidget' }),
    ]));

    await expect(assertValidOpenApiSpec({ specPath })).resolves.toMatchObject({ valid: true });
  });

  it('reports missing handlers and missing explicit operation test cases', async () => {
    const { missingHandler: _missingHandler, ...incompleteHandlers } = handlers();
    const report = await checkOpenApiCoverage({
      specPath,
      handlers: incompleteHandlers,
      cases: operationCases,
      requireOperationTestCases: true,
      ignoredOperationIds: ['adminOnly'],
    });

    expect(report.valid).toBe(false);
    expect(report.missingHandlers).toEqual(['missingHandler']);
    expect(report.missingTestCases).toEqual(['getWidget', 'missingHandler']);
    expect(report.unknownHandlers).toEqual([]);
  });

  it('asserts handler and explicit request-case coverage', async () => {
    await expect(assertOpenApiCoverage({
      specPath,
      handlers: handlers(),
      cases: operationCases,
      requireOperationTestCases: true,
      ignoredOperationIds: ['adminOnly', 'getWidget', 'missingHandler'],
    })).resolves.toMatchObject({ valid: true });
  });

  it('runs explicit operation request cases against the runtime app', async () => {
    const app = await createOpenApiApp({
      name: 'spec-testing-runtime-test',
      specPath,
      handlers: handlers(),
      auth: { apiKey },
    });

    const results = await assertOpenApiOperationTests({ app, cases: operationCases });

    expect(results).toEqual([
      expect.objectContaining({ operationId: 'healthCheck', expectedStatus: 200, actualStatus: 200, ok: true }),
      expect.objectContaining({ operationId: 'createWidget', expectedStatus: 201, actualStatus: 201, ok: true }),
    ]);
  });
});
