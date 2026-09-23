import { expect, test } from '@playwright/test';
import { createWorkspace, researchVault, sidebar, writeZip } from './helpers';

interface Heartbeat {
  longestGap: number;
  phases: string[];
  stop: () => void;
}

test('a 2,000-note vault imports without freezing the page', async ({ page }, testInfo) => {
  test.slow();
  await createWorkspace(page, 'Research');
  await sidebar(page).getByRole('button', { name: 'Import', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Import' });
  await dialog.getByTestId('import-files-input').setInputFiles({
    name: 'Research vault.zip',
    mimeType: 'application/zip',
    buffer: writeZip(researchVault(2000)),
  });
  const start = dialog.getByRole('button', { name: 'Import 2,000 files' });
  await expect(start).toBeVisible();

  // A heartbeat in the page: the longest gap between its ticks is the longest freeze, and it
  // records the phases the progress dialog showed. (It runs in the page because the test
  // runner's own checks queue behind the import's work in some browsers.)
  await page.evaluate(() => {
    const state = window as unknown as { heartbeat: Heartbeat };
    let last = performance.now();
    const heartbeat: Heartbeat = { longestGap: 0, phases: [], stop: () => undefined };
    const timer = setInterval(() => {
      const now = performance.now();
      heartbeat.longestGap = Math.max(heartbeat.longestGap, now - last);
      last = now;
      const phase = document.querySelector('[data-phase]')?.getAttribute('data-phase');
      if (phase && heartbeat.phases.at(-1) !== phase) heartbeat.phases.push(phase);
    }, 20);
    heartbeat.stop = () => clearInterval(timer);
    state.heartbeat = heartbeat;
  });
  const started = Date.now();
  await start.click();
  const report = page.getByRole('dialog', { name: 'Import complete' });
  await expect(report).toBeVisible({ timeout: 240_000 });
  const seconds = (Date.now() - started) / 1000;
  const { longestGap, phases } = await page.evaluate(() => {
    const { heartbeat } = window as unknown as { heartbeat: Heartbeat };
    heartbeat.stop();
    return { longestGap: heartbeat.longestGap, phases: heartbeat.phases };
  });
  await expect(report.getByTestId('count-Pages')).toHaveText('Pages2,011');
  await expect(report.getByTestId('count-Links')).toHaveText('Links4,000');
  const summary = `2,000 notes in ${seconds.toFixed(1)} s; longest main-thread gap ${Math.round(longestGap)} ms; phases shown: ${phases.join(' → ')}`;
  testInfo.annotations.push({ type: 'timing', description: summary });
  console.info(`[${testInfo.project.name}] ${summary}`);
  // The progress kept rendering through the main-thread phases.
  expect(phases).toEqual(expect.arrayContaining(['links', 'pages', 'finishing']));
  // Busy CI machines stretch timers: a freeze is a gap of seconds, not a few frames.
  expect(longestGap).toBeLessThan(1000);
});
