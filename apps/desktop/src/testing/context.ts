import { detectPlatform } from '@tessera/core';
import { createTestAppContext, type TestAppContext } from '@tessera/core/testing';
import { resetDesktopRuntime } from '../runtime';
import {
  fakeTauri,
  installFakeTauri,
  uninstallFakeTauri,
  type FakeTauriHandle,
  type FakeTauriOptions,
} from './fake-tauri';

export interface DesktopTestContext extends TestAppContext {
  fake: FakeTauriHandle;
}

/**
 * A workspace session running the real desktop feature (its services, commands and activation)
 * on the fake Tauri runtime. Call {@link cleanupDesktop} after each test.
 */
const open: DesktopTestContext[] = [];

export async function desktopTestContext(
  options: FakeTauriOptions & { workspaceName?: string } = {},
): Promise<DesktopTestContext> {
  installFakeTauri(options);
  const { createDesktopFeature } = await import('../index');
  const test = await createTestAppContext({
    features: [createDesktopFeature()],
    workspaceName: options.workspaceName ?? 'Apollo research',
    runtime: {
      platform: detectPlatform({
        navigator: { userAgent: options.os === 'macos' ? 'Macintosh' : 'Windows NT 10.0' },
        tauri: true,
        matchMedia: () => ({ matches: false }),
      }),
    },
  });
  const context = { ...test, fake: fakeTauri() };
  open.push(context);
  return context;
}

/** Closes the sessions, then removes the fake and the page-wide singletons. */
export async function cleanupDesktop(): Promise<void> {
  for (const context of open.splice(0)) await context.dispose().catch(() => undefined);
  resetDesktopRuntime();
  uninstallFakeTauri();
}
