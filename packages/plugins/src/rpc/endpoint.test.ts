import type { PluginPermission } from '@tessera/core';
import fc from 'fast-check';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PLUGIN_LIMITS } from '../constants';
import { HostEndpoint, type ApiHandlers, type RpcPort } from './endpoint';
import { inspectMessage } from './inspect';
import { API_METHODS, type ApiMethod } from './protocol';

/** A port pair where the "plugin" side is driven by the test. */
function ports() {
  const toHost: RpcPort = {
    onmessage: null,
    postMessage: () => undefined,
    close: () => undefined,
  };
  const sent: unknown[] = [];
  toHost.postMessage = (message) => sent.push(structuredClone(message));
  const send = (message: unknown) => toHost.onmessage?.({ data: message } as MessageEvent);
  return { port: toHost, sent, send };
}

type HandlerMap = { [M in ApiMethod]: ReturnType<typeof vi.fn> };

function setup(
  options: { granted?: PluginPermission[]; surface?: 'worker' | 'panel' | 'block' } = {},
) {
  const { port, sent, send } = ports();
  const handlers = Object.fromEntries(
    Object.keys(API_METHODS).map((method) => [method, vi.fn(() => ({ ok: method }))]),
  ) as HandlerMap;
  const warnings: string[] = [];
  const notifications: Array<[string, unknown]> = [];
  const denied: string[] = [];
  const internal: unknown[] = [];
  let granted = options.granted ?? [];
  const endpoint = new HostEndpoint({
    port,
    surface: options.surface ?? 'worker',
    pluginName: () => 'Word count',
    granted: () => granted,
    describe: (permission) => `use ${permission}`,
    handlers: handlers as unknown as ApiHandlers,
    onNotify: (method, params) => notifications.push([method, params]),
    onWarning: (message) => warnings.push(message),
    onInternalError: (_method, error) => internal.push(error),
    onPermissionDenied: (permission) => denied.push(permission),
  });
  const request = (id: number, method: string, params?: unknown) =>
    send(
      params === undefined
        ? { v: 1, type: 'request', id, method }
        : { v: 1, type: 'request', id, method, params },
    );
  const responses = () =>
    sent.filter(
      (
        message,
      ): message is { id: number; ok: boolean; error?: { code: string; message: string } } =>
        typeof message === 'object' &&
        message !== null &&
        (message as { type?: string }).type === 'response',
    );
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  return {
    endpoint,
    handlers,
    sent,
    send,
    request,
    responses,
    settle,
    warnings,
    notifications,
    denied,
    internal,
    setGranted: (next: PluginPermission[]) => {
      granted = next;
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('inspectMessage', () => {
  const limits = { depth: 5, nodes: 50, chars: 100 };
  it('accepts plain JSON-like data', () => {
    expect(inspectMessage({ a: [1, 'two', null, { b: true }] }, limits)).toBeNull();
  });
  it.each([
    ['too deep', { a: { b: { c: { d: { e: { f: 1 } } } } } }, 'depth'],
    ['too many values', Array.from({ length: 60 }, (_, i) => i), 'nodes'],
    ['too many characters', 'x'.repeat(101), 'chars'],
    ['long keys', { ['k'.repeat(101)]: 1 }, 'chars'],
    ['a Date', { when: new Date() }, 'type'],
    ['a Map', new Map(), 'type'],
    ['a typed array', new Uint8Array(4), 'type'],
    ['NaN', { n: Number.NaN }, 'type'],
    ['Infinity', [Number.POSITIVE_INFINITY], 'type'],
    ['a bigint', { n: 1n }, 'type'],
  ])('refuses %s', (_label, value, problem) => {
    expect(inspectMessage(value, limits)).toBe(problem);
  });
  it('refuses cycles and shared references', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(inspectMessage(cyclic, limits)).toBe('cycle');
    const shared = { x: 1 };
    expect(inspectMessage([shared, shared], limits)).toBe('cycle');
  });
});

describe('HostEndpoint', () => {
  it('dispatches valid requests and returns results', async () => {
    const t = setup({ granted: ['pages:read'] });
    t.request(1, 'pages.get', { id: 'page-1' });
    await t.settle();
    expect(t.handlers['pages.get']).toHaveBeenCalledWith({ id: 'page-1' });
    expect(t.responses()).toEqual([
      { v: 1, type: 'response', id: 1, ok: true, result: { ok: 'pages.get' } },
    ]);
  });

  it('checks the permission of every method on every call, with a friendly message', async () => {
    const t = setup({ granted: [] });
    for (const [method, spec] of Object.entries(API_METHODS)) {
      const permission = (spec as { permission?: string }).permission;
      if (!permission) continue;
      t.request(
        1000 + Object.keys(API_METHODS).indexOf(method),
        method,
        sampleParams(method as ApiMethod),
      );
    }
    await t.settle();
    const guarded = Object.values(API_METHODS).filter(
      (spec) => (spec as { permission?: string }).permission,
    );
    const denied = t.responses().filter((response) => response.error?.code === 'permission_denied');
    // Methods limited to other surfaces answer with invalid_operation before the permission check.
    const surfaceLimited = t
      .responses()
      .filter((response) => response.error?.code === 'invalid_operation');
    expect(denied.length + surfaceLimited.length).toBe(guarded.length);
    expect(denied[0]?.error?.message).toMatch(/^Word count doesn’t have permission to use /);
    for (const handler of Object.values(t.handlers)) expect(handler).not.toHaveBeenCalled();
  });

  it('applies a revoked permission to the very next call', async () => {
    const t = setup({ granted: ['storage'] });
    t.request(1, 'storage.get', { key: 'a' });
    await t.settle();
    t.setGranted([]);
    t.request(2, 'storage.get', { key: 'a' });
    await t.settle();
    expect(t.responses().map((response) => response.ok)).toEqual([true, false]);
    expect(t.denied).toEqual(['storage']);
  });

  it('refuses registrations outside the worker and block calls outside blocks', async () => {
    const panel = setup({ granted: ['ui:commands', 'ui:blocks'], surface: 'panel' });
    panel.request(1, 'commands.register', { id: 'a', title: 'A' });
    panel.request(2, 'block.setData', { data: 1 });
    await panel.settle();
    expect(panel.responses().map((response) => response.error?.code)).toEqual([
      'invalid_operation',
      'invalid_operation',
    ]);
  });

  it('validates parameters strictly', async () => {
    const t = setup({ granted: ['pages:read', 'ui:commands', 'storage', 'ui:blocks'] });
    t.request(1, 'pages.get', { id: '../../etc' });
    t.request(2, 'pages.get', { id: 'a', extra: true });
    t.request(3, 'commands.register', { id: 'Bad ID', title: 'x' });
    t.request(4, 'storage.set', { key: 'a', value: { toJSON: 'not a function but fine' } });
    t.request(5, 'ui.addBlock', { type: 'x', title: 'X', initialData: 'y'.repeat(70_000) });
    await t.settle();
    const codes = t
      .responses()
      .map((response) => [response.id, response.error?.code ?? 'ok'])
      .sort((a, b) => Number(a[0]) - Number(b[0]));
    expect(codes).toEqual([
      [1, 'invalid'],
      [2, 'invalid'],
      [3, 'invalid'],
      [4, 'ok'],
      [5, 'invalid'],
    ]);
  });

  it('answers unknown methods, reused IDs and floods without calling handlers', async () => {
    const t = setup({ granted: ['pages:read'] });
    t.request(1, 'fs.readFile', { path: '/' });
    t.handlers['pages.list'].mockImplementation(() => new Promise(() => undefined));
    t.request(2, 'pages.list');
    t.request(2, 'pages.list');
    for (let i = 0; i < PLUGIN_LIMITS.inFlightRequests + 5; i += 1)
      t.request(100 + i, 'pages.list');
    await t.settle();
    const errors = t.responses().map((response) => response.error?.code);
    expect(errors[0]).toBe('not_found');
    expect(errors[1]).toBe('invalid');
    expect(errors.filter((code) => code === 'unavailable')).toHaveLength(6);
    expect(t.endpoint.inFlightCount).toBe(PLUGIN_LIMITS.inFlightRequests);
  });

  it('refuses oversized and malformed messages, answering what it can', async () => {
    const t = setup({ granted: ['storage'] });
    t.send({
      v: 1,
      type: 'request',
      id: 7,
      method: 'storage.set',
      params: { key: 'a', value: 'x'.repeat(PLUGIN_LIMITS.messageChars + 1) },
    });
    t.send({ v: 2, type: 'request', id: 8, method: 'storage.keys' });
    t.send({ v: 1, type: 'request', id: -1, method: 'storage.keys' });
    t.send('hello');
    t.send(null);
    t.send({ v: 1, type: 'teleport' });
    await t.settle();
    expect(t.responses().map((response) => [response.id, response.error?.code])).toEqual([
      [7, 'invalid'],
      [8, 'invalid'],
    ]);
    expect(t.warnings.length).toBeGreaterThanOrEqual(5);
    expect(t.handlers['storage.set']).not.toHaveBeenCalled();
  });

  it('matches responses to host requests and ignores out-of-order or invented ones', async () => {
    vi.useFakeTimers();
    const t = setup();
    const first = t.endpoint.request('ping', undefined, 1_000);
    const second = t.endpoint.request('activate', undefined, 1_000);
    const [ping, activate] = t.sent as Array<{ id: number }>;
    t.send({ v: 1, type: 'response', id: activate?.id, ok: true, result: 'activated' });
    t.send({ v: 1, type: 'response', id: 999, ok: true });
    t.send({ v: 1, type: 'response', id: activate?.id, ok: true, result: 'again' });
    t.send({
      v: 1,
      type: 'response',
      id: ping?.id,
      ok: false,
      error: { code: 'internal', message: 'boom' },
    });
    await expect(second).resolves.toBe('activated');
    await expect(first).rejects.toThrow('boom');
    const late = t.endpoint.request('ping', undefined, 50);
    vi.advanceTimersByTime(60);
    await expect(late).rejects.toMatchObject({ code: 'timeout' });
    expect(t.warnings.filter((message) => message.includes('unexpected response'))).toHaveLength(2);
  });

  it('maps handler errors: expected ones as they are, others as internal', async () => {
    const t = setup({ granted: ['pages:read'] });
    const { NotFoundError } = await import('@tessera/core');
    t.handlers['pages.get'].mockImplementation(() => {
      throw new NotFoundError('Page', 'x');
    });
    t.handlers['pages.list'].mockImplementation(() => {
      throw new Error('database exploded at /secret/path');
    });
    t.request(1, 'pages.get', { id: 'x' });
    t.request(2, 'pages.list');
    await t.settle();
    const [notFound, internal] = t.responses();
    expect(notFound?.error).toEqual({ code: 'not_found', message: 'Page "x" was not found' });
    expect(internal?.error?.code).toBe('internal');
    expect(internal?.error?.message).not.toContain('/secret/path');
    expect(t.internal).toHaveLength(1);
  });

  it('validates notifications before handing them over', () => {
    const t = setup();
    t.send({ v: 1, type: 'notify', method: 'log', params: { level: 'log', message: 'hi' } });
    t.send({ v: 1, type: 'notify', method: 'shell.exec', params: {} });
    expect(t.notifications).toEqual([['log', { level: 'log', message: 'hi' }]]);
  });

  it('stops answering after dispose and rejects pending host requests', async () => {
    const t = setup({ granted: ['pages:read'] });
    const pending = t.endpoint.request('ping', undefined, 10_000);
    t.endpoint.dispose();
    await expect(pending).rejects.toMatchObject({ code: 'unavailable' });
    t.request(1, 'pages.list');
    await t.settle();
    expect(t.responses()).toEqual([]);
  });
});

describe('HostEndpoint fuzzing', () => {
  it('never throws and never calls a handler with invalid parameters, whatever arrives', async () => {
    const methods = [...Object.keys(API_METHODS), 'unknown', '__proto__', 'constructor'];
    const message = fc.oneof(
      fc.anything(),
      fc.record({
        v: fc.oneof(fc.constant(1), fc.anything()),
        type: fc.constantFrom('request', 'response', 'notify', 'event'),
        id: fc.oneof(fc.integer(), fc.double(), fc.string(), fc.constant(undefined)),
        method: fc.oneof(fc.constantFrom(...methods), fc.string()),
        params: fc.anything({ maxDepth: 4 }),
        ok: fc.boolean(),
        result: fc.anything(),
      }),
    );
    await fc.assert(
      fc.asyncProperty(fc.array(message, { maxLength: 30 }), async (messages) => {
        const t = setup({
          granted: [
            'pages:read',
            'pages:write',
            'storage',
            'ui:commands',
            'ui:panels',
            'ui:blocks',
          ],
        });
        for (const value of messages) expect(() => t.send(value)).not.toThrow();
        await t.settle();
        for (const [method, handler] of Object.entries(t.handlers)) {
          const spec = API_METHODS[method as ApiMethod];
          for (const [params] of handler.mock.calls)
            expect(spec.params.safeParse(params).success).toBe(true);
        }
        for (const response of t.responses()) expect(Number.isInteger(response.id)).toBe(true);
        t.endpoint.dispose();
      }),
      { numRuns: 200 },
    );
  }, 60_000);

  it('answers every well-formed request exactly once, in any order', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uniqueArray(fc.integer({ min: 1, max: 10_000 }), { minLength: 1, maxLength: 40 }),
        fc.array(fc.constantFrom('pages.list', 'storage.keys', 'pages.current', 'nope'), {
          minLength: 40,
          maxLength: 40,
        }),
        async (ids, methods) => {
          const t = setup({ granted: ['pages:read'] });
          ids.forEach((id, index) => t.request(id, methods[index] ?? 'pages.list'));
          await t.settle();
          const answered = t
            .responses()
            .map((response) => response.id)
            .sort((a, b) => a - b);
          expect(answered).toEqual([...ids].sort((a, b) => a - b));
          t.endpoint.dispose();
        },
      ),
      { numRuns: 100 },
    );
  }, 60_000);
});

/** Valid parameters for each method (the permission check runs after validation). */
function sampleParams(method: ApiMethod): unknown {
  const samples: Partial<Record<ApiMethod, unknown>> = {
    'commands.register': { id: 'a', title: 'A' },
    'commands.unregister': { id: 'a' },
    'ui.addPanel': { id: 'a', title: 'A' },
    'ui.removePanel': { id: 'a' },
    'ui.openPanel': { id: 'a' },
    'ui.addBlock': { type: 'a', title: 'A' },
    'ui.removeBlock': { type: 'a' },
    'pages.get': { id: 'page' },
    'pages.create': { title: 'x' },
    'pages.update': { id: 'page', title: 'x' },
    'pages.open': { id: 'page' },
    'databases.get': { id: 'db' },
    'databases.query': { id: 'db' },
    'databases.addRow': { id: 'db' },
    'databases.updateRow': { id: 'db', rowId: 'row', input: {} },
    'storage.get': { key: 'k' },
    'storage.set': { key: 'k', value: 1 },
    'storage.delete': { key: 'k' },
    'block.setData': { data: 1 },
  };
  return samples[method];
}
