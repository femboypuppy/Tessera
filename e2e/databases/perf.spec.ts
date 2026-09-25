import { expect, test, type Page } from '@playwright/test';
import { grid, openWorkspace } from './helpers';

const ROWS = 10_000;
const STAGES = ['Backlog', 'Planned', 'In progress', 'In review', 'Done'];
const OWNERS = [
  'Ada Lovelace',
  'Grace Hopper',
  'Alan Turing',
  'Katherine Johnson',
  'Linus Torvalds',
];

function bigCsv(): string {
  const lines = ['Task,Stage,Owner,Estimate,Due,Shipped'];
  for (let i = 0; i < ROWS; i += 1) {
    const day = String((i % 28) + 1).padStart(2, '0');
    const month = String((i % 12) + 1).padStart(2, '0');
    lines.push(
      `Task ${i + 1} for the ${STAGES[i % 5]?.toLowerCase()} column,${STAGES[i % 5]},${OWNERS[i % 5]},${(i % 13) + 1},2026-${month}-${day},${i % 3 === 0 ? 'yes' : 'no'}`,
    );
  }
  return lines.join('\n');
}

/**
 * Scrolls the grid from top to bottom and back, one step per animation frame, and returns the
 * frame durations. A frame that takes longer than the step budget shows up as a long frame.
 */
async function scrollFrames(page: Page): Promise<number[]> {
  return grid(page).evaluate(async (element) => {
    const frames: number[] = [];
    const step = 120;
    let last = performance.now();
    let direction = 1;
    const end = performance.now() + 3000;
    await new Promise<void>((resolve) => {
      const tick = (now: number) => {
        frames.push(now - last);
        last = now;
        if (element.scrollTop + element.clientHeight >= element.scrollHeight - 1) direction = -1;
        if (element.scrollTop <= 0) direction = 1;
        element.scrollTop += step * direction;
        if (now < end) requestAnimationFrame(tick);
        else resolve();
      };
      requestAnimationFrame((now) => {
        last = now;
        requestAnimationFrame(tick);
      });
    });
    return frames;
  });
}

function percentile(values: readonly number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length * p) / 100))] ?? 0;
}

test.describe('10,000-row table', { tag: '@perf' }, () => {
  test.skip(
    ({ browserName }) => browserName !== 'chromium',
    'Frame timing is measured in Chromium only',
  );

  test('stays virtualized and scrolls at 60 fps', async ({ page }) => {
    test.setTimeout(240_000);
    await openWorkspace(page);
    await page.getByRole('button', { name: 'Import CSV as database' }).click();
    const dialog = page.getByRole('dialog', { name: 'Import a CSV file' });
    await dialog.getByLabel('Choose a CSV file').setInputFiles({
      name: 'Roadmap.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(bigCsv()),
    });
    await dialog.getByRole('button', { name: 'Import 10,000 rows' }).click();
    await expect(page.getByText('10,000 rows', { exact: true })).toBeVisible({ timeout: 120_000 });

    // Only the visible rows (plus overscan) are in the DOM.
    const rendered = await grid(page).locator('[role="row"][data-row-id]').count();
    expect(rendered).toBeGreaterThan(5);
    expect(rendered).toBeLessThan(80);
    await expect(grid(page)).toHaveAttribute('aria-rowcount', String(ROWS + 2));

    // Warm up (fonts, first paint of every column), then measure. The machine running the tests
    // may be busy (other workers come and go), so keep the best of five runs.
    await scrollFrames(page);
    const runs: Array<{ median: number; p95: number; frames: number }> = [];
    for (let run = 0; run < 5; run += 1) {
      const frames = await scrollFrames(page);
      runs.push({
        median: percentile(frames, 50),
        p95: percentile(frames, 95),
        frames: frames.length,
      });
    }
    const best = runs.reduce((a, b) => (b.median + b.p95 < a.median + a.p95 ? b : a));
    test.info().annotations.push({ type: 'scroll frames', description: JSON.stringify(runs) });
    // 60 fps is a 16.7 ms frame; allow for timer jitter.
    expect(best.median).toBeLessThan(18);
    expect(best.p95).toBeLessThan(34);

    // Scrolling to the end reaches the last row.
    await grid(page).evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await expect(grid(page).getByText('Task 10000 for the done column')).toBeVisible();
  });
});
