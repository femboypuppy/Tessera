/**
 * The axe check of the graph view, in both themes (the other screens are in
 * accessibility.spec.ts). It has a file of its own because the graph draws with WebGL, in software
 * on Linux CI: a browser setting, which applies to a whole file.
 */
import { expect, test } from '../support';
import { softwareWebGL } from '../support/webgl';
import { expectAccessible, furnish } from './accessibility-checks';

test.use(softwareWebGL);

for (const colorScheme of ['light', 'dark'] as const) {
  test.describe(`${colorScheme} theme`, () => {
    test.use({ colorScheme });

    test('graph view', async ({ freshWorkspace: app, page }) => {
      await app.expectFeatures('graph');
      await furnish(app);
      await page.goto('/graph');
      await expect(page.locator('main')).toBeVisible();
      await expectAccessible(page);
    });
  });
}
