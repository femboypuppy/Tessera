import { importFileFromText, type ImportFile, type ImportProgress } from '@tessera/core';
import { describe, expect, it } from 'vitest';
import { createObsidianImporter } from './importers';
import { importContext, importWorkspace } from './test/helpers';

/** A realistic vault: 40 folders of 50 notes with frontmatter, links, tags, tasks and a table. */
export function generateVault(notes: number, folders = 40): ImportFile[] {
  const files: ImportFile[] = [importFileFromText('.obsidian/app.json', '{}')];
  const perFolder = Math.ceil(notes / folders);
  const title = (index: number) => `Note ${index}`;
  for (let index = 0; index < notes; index += 1) {
    const folder = `Area ${Math.floor(index / perFolder)}`;
    const body = [
      '---',
      `tags: [area-${Math.floor(index / perFolder)}, generated]`,
      `aliases: [N${index}]`,
      '---',
      '',
      `# ${title(index)}`,
      '',
      `Links to [[${title((index + 1) % notes)}]], [[${title((index * 7) % notes)}#Details|details]] and [[N${(index + 13) % notes}]]. #topic/${index % 10}`,
      '',
      '## Details',
      '',
      `- [ ] Task ${index}`,
      `- [x] Done ${index} ^task-${index}`,
      '',
      '| Key | Value |',
      '| --- | --- |',
      `| id | ${index} |`,
      '',
      '> [!note] Remember',
      `> Written for the ${notes}-file benchmark.`,
    ].join('\n');
    files.push(importFileFromText(`${folder}/${title(index)}.md`, body));
  }
  return files;
}

describe('performance', () => {
  it('imports a 2,000-file vault while yielding to the page often', async () => {
    const files = generateVault(2000);
    const test = await importWorkspace();
    try {
      const gaps = new Map<ImportProgress['phase'], number>();
      let last = performance.now();
      const started = last;
      const phaseStarts = new Map<ImportProgress['phase'], number>();
      const report = await createObsidianImporter().run(
        files,
        importContext(test.ctx, 'Benchmark'),
        (progress) => {
          const now = performance.now();
          if (!phaseStarts.has(progress.phase)) phaseStarts.set(progress.phase, now);
          gaps.set(progress.phase, Math.max(gaps.get(progress.phase) ?? 0, now - last));
          last = now;
        },
        new AbortController().signal,
      );
      const total = performance.now() - started;
      expect(report.issues.filter((issue) => issue.severity === 'error')).toEqual([]);
      expect(report.counts.pages).toBe(2000 + 40 + 1);
      expect(report.counts.links).toBe(6000);
      // Steps that run on the main thread in the app hand control back at least every 250 ms
      // (planning runs in a worker there; in this test it runs inline).
      for (const phase of ['reading', 'pages', 'finishing'] as const) {
        expect(gaps.get(phase) ?? 0).toBeLessThan(250);
      }
      console.info(
        `2,000-file import: ${Math.round(total)} ms total; phases start at`,
        Object.fromEntries(
          [...phaseStarts].map(([phase, time]) => [phase, Math.round(time - started)]),
        ),
        'longest gaps',
        Object.fromEntries([...gaps].map(([phase, gap]) => [phase, Math.round(gap)])),
      );
    } finally {
      await test.dispose();
    }
  }, 600_000);
});
