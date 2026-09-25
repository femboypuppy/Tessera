import type {
  Fixtures,
  PlaywrightTestArgs,
  PlaywrightTestOptions,
  PlaywrightWorkerArgs,
  PlaywrightWorkerOptions,
} from '@playwright/test';

const linuxCI = Boolean(process.env.CI) && process.platform === 'linux';

/**
 * WebGL for the specs that draw the graph (`test.use(softwareWebGL)`), on Linux CI: GitHub's
 * runners have no GPU. Elsewhere it changes nothing.
 *
 * Chromium needs nothing: Playwright launches it with `--enable-unsafe-swiftshader`, so WebGL falls
 * back to SwiftShader on its own. (Forcing SwiftShader for everything with `--use-angle=swiftshader`
 * put all of Chromium's drawing through it: the 10,000-row table scrolled at 30 fps instead of 60.)
 * Headless Firefox has no WebGL on Linux whatever its prefs, so these specs run it headed on the
 * virtual display CI starts (`xvfb-run`), where Mesa's llvmpipe draws WebGL.
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
          await use(
            browserName === 'firefox' ? { firefoxUserPrefs: { 'webgl.force-enabled': true } } : {},
          );
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
