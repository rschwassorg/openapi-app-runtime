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

type EmptyObject = Record<string, never>;
type JsonContent<Content> = Content extends { 'application/json': infer Json }
  ? Json
  : Content extends Record<string, infer Body>
    ? Body
    : unknown;
type OptionalNeverToEmpty<Value> = [Value] extends [never] ? EmptyObject : NonNullable<Value>;
type OperationParameters<Operation> = Operation extends { parameters: infer Parameters } ? Parameters : EmptyObject;
type OperationRequestBody<Operation> = Operation extends { requestBody: { content: infer Content } }
  ? JsonContent<Content>
  : unknown;
type OperationResponseContent<ResponseValue> = ResponseValue extends { content: infer Content }
  ? JsonContent<Content>
  : unknown;
type StatusResponseBody<Responses, Status extends keyof Responses> = OperationResponseContent<Responses[Status]>;
type SuccessStatus<Responses> = Extract<keyof Responses, 200 | 201 | 202 | 203 | 204 | 205 | 206 | 207 | 208 | 226>;
type FirstSuccessStatus<Responses> =
  200 extends keyof Responses ? 200
    : 201 extends keyof Responses ? 201
      : 202 extends keyof Responses ? 202
        : 203 extends keyof Responses ? 203
          : 204 extends keyof Responses ? 204
            : 205 extends keyof Responses ? 205
              : 206 extends keyof Responses ? 206
                : 207 extends keyof Responses ? 207
                  : 208 extends keyof Responses ? 208
                    : 226 extends keyof Responses ? 226
                      : never;
type OperationResponseBody<Operation> = Operation extends { responses: infer Responses }
  ? FirstSuccessStatus<Responses> extends keyof Responses
    ? StatusResponseBody<Responses, FirstSuccessStatus<Responses>>
    : SuccessStatus<Responses> extends keyof Responses
      ? StatusResponseBody<Responses, SuccessStatus<Responses>>
      : unknown
  : unknown;

export interface TypedOpenApiRequestValues<Operation> {
  params: OptionalNeverToEmpty<OperationParameters<Operation> extends { path?: infer Path } ? Path : EmptyObject>;
  query: OptionalNeverToEmpty<OperationParameters<Operation> extends { query?: infer Query } ? Query : EmptyObject>;
  headers: OptionalNeverToEmpty<OperationParameters<Operation> extends { header?: infer Headers } ? Headers : EmptyObject>;
  requestBody: OperationRequestBody<Operation>;
}

export interface TypedOpenApiHandlerContext<Operation> extends Omit<OpenApiHandlerContext, 'request'> {
  request: TypedOpenApiRequestValues<Operation>;
}

export type OpenApiHandlerFor<Operation> = (
  context: TypedOpenApiHandlerContext<Operation>,
  req: RuntimeRequest,
  res: Response<OperationResponseBody<Operation>>
) => Promise<unknown> | unknown;

export type OpenApiHandlers<
  Operations extends object,
  IgnoredOperationIds extends keyof Operations = never,
> = {
  [OperationId in Exclude<keyof Operations, IgnoredOperationIds>]: OpenApiHandlerFor<Operations[OperationId]>;
} & {
  [OperationId in IgnoredOperationIds]?: OpenApiHandlerFor<Operations[OperationId]>;
};

export function defineOpenApiHandlers<
  Operations extends object,
  IgnoredOperationIds extends keyof Operations = never,
>() {
  return <Handlers extends OpenApiHandlers<Operations, IgnoredOperationIds>>(
    handlers: Handlers & Record<Exclude<keyof Handlers, keyof Operations>, never>,
  ): Handlers & Record<string, OpenApiHandler> => {
    return handlers as Handlers & Record<string, OpenApiHandler>;
  };
}

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
  handleRequestPath?: (req: RuntimeRequest) => boolean;
}

export interface ErrorResponseBody {
  error: string;
  message: string;
  requestId: string;
  details?: unknown;
  operationId?: string;
}
