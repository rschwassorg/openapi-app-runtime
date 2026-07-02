import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Express } from 'express';
import { OpenAPIBackend, type Document } from 'openapi-backend';
import request from 'supertest';
import YAML from 'yaml';

import type { OpenApiHandler } from '../types.js';

const httpMethods = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'] as const;

export type OpenApiHttpMethod = typeof httpMethods[number];

export interface OpenApiOperationSummary {
  method: Uppercase<OpenApiHttpMethod>;
  path: string;
  operationId: string;
  security: unknown[];
  responseStatuses: string[];
}

export interface OpenApiSpecValidationError {
  code: string;
  message: string;
  method?: string;
  path?: string;
  operationId?: string;
}

export interface OpenApiSpecValidationReport {
  valid: boolean;
  errors: OpenApiSpecValidationError[];
  operations: OpenApiOperationSummary[];
}

export interface OpenApiCoverageOptions {
  specPath?: string;
  document?: Document;
  handlers: Record<string, OpenApiHandler>;
  cases?: OpenApiOperationTestCase[];
  ignoredOperationIds?: string[];
  requireOperationTestCases?: boolean;
  failOnUnknownHandlers?: boolean;
}

export interface OpenApiCoverageReport {
  valid: boolean;
  errors: OpenApiSpecValidationError[];
  operations: OpenApiOperationSummary[];
  missingHandlers: string[];
  unknownHandlers: string[];
  missingTestCases: string[];
  unknownTestCases: string[];
}

export interface OpenApiOperationTestRequest {
  method: OpenApiHttpMethod | Uppercase<OpenApiHttpMethod>;
  path: string;
  headers?: Record<string, string>;
  query?: Record<string, unknown>;
  body?: string | object;
}

export interface OpenApiOperationTestCase {
  operationId: string;
  request: OpenApiOperationTestRequest;
  expectedStatus: number;
}

export interface OpenApiOperationTestResult {
  operationId: string;
  method: string;
  path: string;
  expectedStatus: number;
  actualStatus: number;
  ok: boolean;
  body: unknown;
}

export interface RunOpenApiOperationTestsOptions {
  app: Express;
  cases: OpenApiOperationTestCase[];
}

function resolveSpecPath(specPath: string): string {
  if (specPath.startsWith('file://')) return fileURLToPath(specPath);
  return path.resolve(process.cwd(), specPath);
}

export function loadOpenApiDocument(specPath: string): Document {
  const resolvedPath = resolveSpecPath(specPath);
  const content = fs.readFileSync(resolvedPath, 'utf8');
  if (resolvedPath.endsWith('.json')) return JSON.parse(content) as Document;
  return YAML.parse(content) as Document;
}

function documentFromOptions(options: { specPath?: string; document?: Document }): Document {
  if (options.document) return options.document;
  if (options.specPath) return loadOpenApiDocument(options.specPath);
  throw new Error('Either specPath or document is required.');
}

function operationEntries(document: Document): OpenApiOperationSummary[] {
  const operations: OpenApiOperationSummary[] = [];
  const paths = (document.paths || {}) as Record<string, Record<string, unknown>>;
  for (const [routePath, pathItem] of Object.entries(paths)) {
    for (const method of httpMethods) {
      const operation = pathItem?.[method] as Record<string, unknown> | undefined;
      if (!operation) continue;
      const responses = operation.responses as Record<string, unknown> | undefined;
      operations.push({
        method: method.toUpperCase() as Uppercase<OpenApiHttpMethod>,
        path: routePath,
        operationId: String(operation.operationId || ''),
        security: Array.isArray(operation.security) ? operation.security : [],
        responseStatuses: responses ? Object.keys(responses) : [],
      });
    }
  }
  return operations;
}

function formatValidationErrors(errors: OpenApiSpecValidationError[]): string {
  return errors
    .map((error) => {
      const location = [error.method, error.path].filter(Boolean).join(' ');
      return `- ${error.code}${location ? ` (${location})` : ''}: ${error.message}`;
    })
    .join('\n');
}

export async function validateOpenApiSpec(options: { specPath?: string; document?: Document }): Promise<OpenApiSpecValidationReport> {
  const document = documentFromOptions(options);
  const errors: OpenApiSpecValidationError[] = [];

  try {
    const api = new OpenAPIBackend({ definition: document, quick: true });
    await api.init();
  } catch (error) {
    errors.push({
      code: 'invalid_openapi_document',
      message: error instanceof Error ? error.message : String(error),
    });
  }

  const operations = operationEntries(document);
  if (!operations.length) {
    errors.push({
      code: 'no_operations',
      message: 'The OpenAPI document does not declare any operations.',
    });
  }

  const seenOperationIds = new Map<string, OpenApiOperationSummary>();
  for (const operation of operations) {
    if (!operation.operationId) {
      errors.push({
        code: 'missing_operation_id',
        message: 'Every operation must declare an operationId so the runtime can dispatch to a handler.',
        method: operation.method,
        path: operation.path,
      });
      continue;
    }
    const existing = seenOperationIds.get(operation.operationId);
    if (existing) {
      errors.push({
        code: 'duplicate_operation_id',
        message: `operationId "${operation.operationId}" is used by both ${existing.method} ${existing.path} and ${operation.method} ${operation.path}.`,
        method: operation.method,
        path: operation.path,
        operationId: operation.operationId,
      });
    }
    seenOperationIds.set(operation.operationId, operation);
  }

  return {
    valid: errors.length === 0,
    errors,
    operations,
  };
}

export async function assertValidOpenApiSpec(options: { specPath?: string; document?: Document }): Promise<OpenApiSpecValidationReport> {
  const report = await validateOpenApiSpec(options);
  if (!report.valid) {
    throw new Error(`OpenAPI spec validation failed:\n${formatValidationErrors(report.errors)}`);
  }
  return report;
}

export async function checkOpenApiCoverage(options: OpenApiCoverageOptions): Promise<OpenApiCoverageReport> {
  const validation = await validateOpenApiSpec(options);
  const ignored = new Set(options.ignoredOperationIds || []);
  const operationIds = new Set(validation.operations.map((operation) => operation.operationId).filter(Boolean));
  const caseOperationIds = new Set((options.cases || []).map((testCase) => testCase.operationId));
  const handlerIds = new Set(Object.keys(options.handlers));

  const missingHandlers = [...operationIds]
    .filter((operationId) => !ignored.has(operationId) && !handlerIds.has(operationId))
    .sort();
  const unknownHandlers = [...handlerIds]
    .filter((operationId) => !operationIds.has(operationId))
    .sort();
  const missingTestCases = options.requireOperationTestCases
    ? [...operationIds].filter((operationId) => !ignored.has(operationId) && !caseOperationIds.has(operationId)).sort()
    : [];
  const unknownTestCases = [...caseOperationIds]
    .filter((operationId) => !operationIds.has(operationId))
    .sort();

  const hasCoverageErrors = missingHandlers.length > 0
    || unknownTestCases.length > 0
    || missingTestCases.length > 0
    || Boolean(options.failOnUnknownHandlers && unknownHandlers.length > 0);

  return {
    valid: validation.valid && !hasCoverageErrors,
    errors: validation.errors,
    operations: validation.operations,
    missingHandlers,
    unknownHandlers,
    missingTestCases,
    unknownTestCases,
  };
}

export async function assertOpenApiCoverage(options: OpenApiCoverageOptions): Promise<OpenApiCoverageReport> {
  const report = await checkOpenApiCoverage(options);
  if (report.valid) return report;

  const messages = [
    ...report.errors.map((error) => `${error.code}: ${error.message}`),
    report.missingHandlers.length ? `Missing handlers: ${report.missingHandlers.join(', ')}` : '',
    report.unknownTestCases.length ? `Unknown operation test cases: ${report.unknownTestCases.join(', ')}` : '',
    report.missingTestCases.length ? `Missing operation test cases: ${report.missingTestCases.join(', ')}` : '',
    options.failOnUnknownHandlers && report.unknownHandlers.length ? `Unknown handlers: ${report.unknownHandlers.join(', ')}` : '',
  ].filter(Boolean);

  throw new Error(`OpenAPI coverage check failed:\n${messages.map((message) => `- ${message}`).join('\n')}`);
}

export async function runOpenApiOperationTests(options: RunOpenApiOperationTestsOptions): Promise<OpenApiOperationTestResult[]> {
  const client = request(options.app);
  const results: OpenApiOperationTestResult[] = [];

  for (const testCase of options.cases) {
    const method = testCase.request.method.toLowerCase() as OpenApiHttpMethod;
    let pendingRequest = client[method](testCase.request.path);
    for (const [name, value] of Object.entries(testCase.request.headers || {})) {
      pendingRequest = pendingRequest.set(name, value);
    }
    if (testCase.request.query) pendingRequest = pendingRequest.query(testCase.request.query);
    if (testCase.request.body !== undefined) pendingRequest = pendingRequest.send(testCase.request.body);

    const response = await pendingRequest;
    results.push({
      operationId: testCase.operationId,
      method: method.toUpperCase(),
      path: testCase.request.path,
      expectedStatus: testCase.expectedStatus,
      actualStatus: response.status,
      ok: response.status === testCase.expectedStatus,
      body: response.body,
    });
  }

  return results;
}

export async function assertOpenApiOperationTests(options: RunOpenApiOperationTestsOptions): Promise<OpenApiOperationTestResult[]> {
  const results = await runOpenApiOperationTests(options);
  const failures = results.filter((result) => !result.ok);
  if (failures.length) {
    throw new Error(`OpenAPI operation tests failed:\n${failures
      .map((failure) => `- ${failure.operationId} ${failure.method} ${failure.path}: expected ${failure.expectedStatus}, got ${failure.actualStatus}`)
      .join('\n')}`);
  }
  return results;
}
