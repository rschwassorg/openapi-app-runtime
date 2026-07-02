import { createOpenApiApp, defineOpenApiHandlers } from '../src/index.js';
import type { operations } from './fixtures/openapi-types.js';

const completeHandlers = defineOpenApiHandlers<operations>()({
  healthCheck: (context, _req, res) => {
    const params: Record<string, never> = context.request.params;
    const body: unknown = context.request.requestBody;
    return res.json({ ok: Object.keys(params).length === 0 && body === undefined });
  },
  createWidget: (context, _req, res) => {
    const name: string = context.request.requestBody.name;
    return res.status(201).json({ id: 'widget-1', name });
  },
  getWidget: (context, _req, res) => {
    const widgetId: string = context.request.params.widgetId;
    return res.json({ id: widgetId, name: 'Existing widget' });
  },
  adminOnly: (_context, _req, res) => {
    return res.json({});
  },
  missingHandler: (_context, _req, res) => {
    return res.json({});
  },
});

await createOpenApiApp({
  name: 'typed-runtime-test',
  specPath: 'test/fixtures/openapi.yaml',
  handlers: completeHandlers,
});

defineOpenApiHandlers<operations, 'missingHandler'>()({
  healthCheck: (_context, _req, res) => res.json({ ok: true }),
  createWidget: (context, _req, res) => res.status(201).json({ id: 'widget-1', name: context.request.requestBody.name }),
  getWidget: (context, _req, res) => res.json({ id: context.request.params.widgetId, name: 'Existing widget' }),
  adminOnly: (_context, _req, res) => res.json({}),
});

defineOpenApiHandlers<operations, 'missingHandler'>()({
  healthCheck: (_context, _req, res) => res.json({ ok: true }),
  createWidget: (context, _req, res) => res.status(201).json({ id: 'widget-1', name: context.request.requestBody.name }),
  getWidget: (context, _req, res) => res.json({ id: context.request.params.widgetId, name: 'Existing widget' }),
  adminOnly: (_context, _req, res) => res.json({}),
  missingHandler: (_context, _req, res) => res.json({}),
});

// @ts-expect-error missingHandler is required unless explicitly ignored.
defineOpenApiHandlers<operations>()({
  healthCheck: (_context, _req, res) => res.json({ ok: true }),
  createWidget: (context, _req, res) => res.status(201).json({ id: 'widget-1', name: context.request.requestBody.name }),
  getWidget: (context, _req, res) => res.json({ id: context.request.params.widgetId, name: 'Existing widget' }),
  adminOnly: (_context, _req, res) => res.json({}),
});

defineOpenApiHandlers<operations, 'missingHandler'>()({
  healthCheck: (_context, _req, res) => res.json({ ok: true }),
  createWidget: (context, _req, res) => res.status(201).json({ id: 'widget-1', name: context.request.requestBody.name }),
  getWidget: (context, _req, res) => res.json({ id: context.request.params.widgetId, name: 'Existing widget' }),
  adminOnly: (_context, _req, res) => res.json({}),
  // @ts-expect-error extraHandler is not an operationId in the generated spec.
  extraHandler: (_context, _req, res) => res.json({}),
});

defineOpenApiHandlers<operations, 'adminOnly' | 'missingHandler' | 'healthCheck' | 'createWidget'>()({
  getWidget: (context, _req, res) => {
    // @ts-expect-error widgetId is a string path parameter, not a number.
    const widgetId: number = context.request.params.widgetId;
    return res.json({ id: String(widgetId), name: 'Existing widget' });
  },
});

defineOpenApiHandlers<operations, 'adminOnly' | 'missingHandler' | 'healthCheck' | 'getWidget'>()({
  createWidget: (context, _req, res) => {
    // @ts-expect-error request body has name, not title.
    const title = context.request.requestBody.title;
    return res.status(201).json({ id: 'widget-1', name: String(title) });
  },
});

defineOpenApiHandlers<operations, 'adminOnly' | 'missingHandler' | 'createWidget' | 'getWidget'>()({
  healthCheck: (_context, _req, res) => {
    // @ts-expect-error healthCheck response requires ok: boolean.
    return res.json({ ok: 'yes' });
  },
});
