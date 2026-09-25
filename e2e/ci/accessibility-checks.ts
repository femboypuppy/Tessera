/** Shared by the axe specs: the check itself and a workspace to check. */
import type { Page } from '@playwright/test';
import { expect, formatViolations, scanAccessibility, test, type TesseraApp } from '../support';
import { partitionViolations } from './accessibility-baseline';

/**
 * Fails on any serious or critical axe violation not in the baseline; known ones become
 * annotations.
 */
export async function expectAccessible(page: Page): Promise<void> {
  const { fresh, known } = partitionViolations(await scanAccessibility(page));
  if (known.length) {
    test.info().annotations.push({
      type: 'known accessibility issues',
      description: formatViolations(known),
    });
  }
  expect(fresh, formatViolations(fresh)).toEqual([]);
}

/** A workspace with a few nested pages, an icon and a favorite. */
export async function furnish(app: TesseraApp): Promise<void> {
  await app.newPage('Apollo program');
  await app.newPage('Mission control');
  await app.newPage('Reading list');
}
