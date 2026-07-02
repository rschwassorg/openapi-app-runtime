# OpenAPI App Runtime

Reusable Express and OpenAPI runtime for rschwassorg services.

Apps provide an OpenAPI spec and operation handlers. This package provides the
common HTTP runtime: request validation, operation dispatch, request IDs,
logging, auth wiring, standard JSON errors, and Swagger UI docs.

```ts
import { createOpenApiApp } from '@rschwass/openapi-app-runtime';
import { handlers } from './handlers/index.js';

const app = await createOpenApiApp({
  name: 'example-api',
  specPath: './openapi/openapi.yaml',
  handlers,
  auth: {
    apiKey: process.env.API_KEY,
    jwtSecret: process.env.JWT_SECRET,
  },
});

app.listen(Number(process.env.PORT || 3000));
```

## Handler Shape

Each OpenAPI operation should have an `operationId` that matches a handler key.

```ts
export async function createProperty(context, req, res) {
  const body = context.request.requestBody;
  const user = req.user;
  return res.status(201).json({ ownerId: user?.id, ...body });
}
```

Handlers can be typed from a generated OpenAPI `operations` type:

```bash
npx openapi-typescript openapi/openapi.yaml -o src/openapi-types.ts
```

```ts
import {
  createOpenApiApp,
  defineOpenApiHandlers,
} from '@rschwass/openapi-app-runtime';
import type { operations } from './openapi-types.js';

export const handlers = defineOpenApiHandlers<operations>()({
  createProperty: (context, req, res) => {
    const body = context.request.requestBody;
    const ownerId = req.user?.id;
    return res.status(201).json({ ownerId, ...body });
  },
});

const app = await createOpenApiApp({
  name: 'example-api',
  specPath: './openapi/openapi.yaml',
  handlers,
});
```

`defineOpenApiHandlers` requires every generated `operationId` by default,
types `params`, `query`, `headers`, `requestBody`, and JSON response bodies, and
rejects handler keys that are not operation IDs. To intentionally leave an
operation to the runtime's `not_implemented` response, pass it as the second
generic:

```ts
export const handlers = defineOpenApiHandlers<operations, 'futureOperation'>()({
  createProperty: (context, req, res) => {
    return res.status(201).json({ ownerId: req.user?.id, ...context.request.requestBody });
  },
});
```

Missing handlers return:

```json
{
  "error": "not_implemented",
  "message": "Handler not implemented",
  "operationId": "createProperty",
  "requestId": "..."
}
```

## Built-In Routes

- `/docs`: Swagger UI, when `docs` is not `false`
- `/openapi.json`: parsed OpenAPI document, when `docs` is not `false`

## Built-In Security Handlers

- `bearerAuth`: verifies JWT bearer tokens with `auth.jwtSecret`
- `apiKeyAuth`: validates `x-api-key` against `auth.apiKey`

Custom security handlers can be passed with `auth.securityHandlers`.

## Spec Tests

Apps can validate their OpenAPI spec, require handler coverage, and run explicit
request cases from tests with the testing export:

```ts
import {
  assertOpenApiCoverage,
  assertOpenApiOperationTests,
} from '@rschwass/openapi-app-runtime/testing';
import { createOpenApiApp } from '@rschwass/openapi-app-runtime';
import { handlers } from '../src/handlers/index.js';

const specPath = './openapi/openapi.yaml';

await assertOpenApiCoverage({
  specPath,
  handlers,
  cases: [
    {
      operationId: 'healthCheck',
      request: { method: 'get', path: '/health' },
      expectedStatus: 200,
    },
  ],
  requireOperationTestCases: true,
});

const app = await createOpenApiApp({ name: 'example-api', specPath, handlers });
await assertOpenApiOperationTests({
  app,
  cases: [
    {
      operationId: 'healthCheck',
      request: { method: 'get', path: '/health' },
      expectedStatus: 200,
    },
  ],
});
```
