import { describe, expect, it } from 'vitest';
import { createApp } from './app';

describe('server app', () => {
  it('answers the health check', async () => {
    const response = await createApp().request('/api/health');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, version: '0.0.0' });
  });
});
