import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from './config';

describe('loadConfig', () => {
  it('needs nothing but DATA_DIR', () => {
    const config = loadConfig({ DATA_DIR: './tmp-data' });
    expect(config).toMatchObject({
      port: 8787,
      host: '0.0.0.0',
      dataDir: path.resolve('./tmp-data'),
      publicUrl: null,
      maxUploadBytes: 25 * 1024 * 1024,
      signupMode: 'invite',
      logLevel: 'info',
      corsOrigins: [],
      trustProxy: false,
      sessionDays: 30,
    });
  });

  it('reads every documented variable', () => {
    const config = loadConfig({
      PORT: '9000',
      DATA_DIR: '/srv/tessera',
      PUBLIC_URL: 'https://notes.example.com/some/path',
      MAX_UPLOAD_MB: '5',
      SIGNUP_MODE: 'open',
      LOG_LEVEL: 'debug',
      CORS_ORIGINS: 'http://localhost:5173, https://app.example.com',
      TRUST_PROXY: 'true',
      SESSION_DAYS: '7',
      SETUP_CODE: 'my-setup-code',
    });
    expect(config).toMatchObject({
      port: 9000,
      publicUrl: 'https://notes.example.com',
      maxUploadBytes: 5 * 1024 * 1024,
      signupMode: 'open',
      logLevel: 'debug',
      corsOrigins: ['http://localhost:5173', 'https://app.example.com'],
      trustProxy: true,
      sessionDays: 7,
      setupCode: 'my-setup-code',
    });
  });

  it('explains every problem in plain words', () => {
    let error: unknown;
    try {
      loadConfig({
        PORT: 'eighty',
        SIGNUP_MODE: 'everyone',
        PUBLIC_URL: 'ftp://x',
        MAX_UPLOAD_MB: '-1',
      });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(ConfigError);
    const problems = (error as ConfigError).problems;
    expect(problems).toContain('PORT must be a number (got "eighty")');
    expect(problems).toContain('SIGNUP_MODE must be invite, open or closed (got "everyone")');
    expect(problems).toContain('MAX_UPLOAD_MB must be more than 0 (got "-1")');
    expect(
      problems.some((problem) =>
        problem.startsWith('PUBLIC_URL must be an http:// or https:// URL'),
      ),
    ).toBe(true);
    expect((error as ConfigError).message).toContain('apps/server/README.md');
  });

  it('rejects malformed CORS origins', () => {
    expect(() => loadConfig({ CORS_ORIGINS: 'not a url' })).toThrow(/CORS_ORIGINS/);
  });
});
