import type {
  Fixtures,
  LaunchOptions,
  PlaywrightTestArgs,
  PlaywrightTestOptions,
  PlaywrightWorkerArgs,
  PlaywrightWorkerOptions,
} from '@playwright/test';

const linuxCI = Boolean(process.env.CI) && process.platform === 'linux';

/**
 * WebGL drawn in software, for the specs that draw the graph (`test.use(softwareWebGL)`), on Linux
 * CI: GitHub's runners have no GPU. Elsewhere it changes nothing.
 *
 * Chromium gets SwiftShader, set explicitly (Chrome no longer falls back to it on its own). Only
 * these specs get it: with it, the runners also draw every page more slowly (the 10,000-row table
 * scrolled at 30 fps instead of 60). Headless Firefox has no WebGL on Linux whatever its prefs, so
 * these specs run it headed on the virtual display CI starts (`xvfb-run`), where Mesa's llvmpipe
 * draws WebGL.
 */
export const softwareWebGL: Fixtures<
  Record<never, never>,
  Record<never, never>,
  PlaywrightTestArgs & PlaywrightTestOptions,
  PlaywrightWorkerArgs & PlaywrightWorkerOptions
> = linuxCI
  ? {
      launchOptions: [
        async ({ browserName }, use) => {
          const options: LaunchOptions =
            browserName === 'chromium'
              ? { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] }
              : browserName === 'firefox'
                ? { firefoxUserPrefs: { 'webgl.force-enabled': true } }
                : {};
          await use(options);
        },
        { scope: 'worker' },
      ],
      headless: [
        async ({ browserName }, use) => {
          await use(!(browserName === 'firefox' && process.env.DISPLAY));
        },
        { scope: 'worker' },
      ],
    }
  : {};
