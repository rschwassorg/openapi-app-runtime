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
