import { expect, test } from '@playwright/test';
import {
  githubSlug,
  linkTargets,
  promisedScreenshots,
  readRepoFile,
  repoFileExists,
  repoPath,
} from './repo-files';
import { readFileSync } from 'node:fs';

/**
 * The README must render correctly on GitHub: every relative link and image resolves, or it is a
 * screenshot another agent has promised (those land at merge time).
 */

const DOCS = [
  'README.md',
  'CONTRIBUTING.md',
  'CODE_OF_CONDUCT.md',
  '.github/PULL_REQUEST_TEMPLATE.md',
];

function isExternal(target: string): boolean {
  return /^(https?:|mailto:)/.test(target);
}

for (const file of DOCS) {
  test(`${file}: every relative link and image resolves`, () => {
    const markdown = readRepoFile(file);
    const headings = markdown
      .split('\n')
      .filter((line) => /^#{1,6}\s/.test(line))
      .map((line) => githubSlug(line.replace(/^#+\s*/, '')));
    const promised = promisedScreenshots();
    const missing: string[] = [];
    for (const target of linkTargets(markdown)) {
      if (isExternal(target)) continue;
      if (target.startsWith('#')) {
        if (!headings.includes(target.slice(1))) missing.push(target);
        continue;
      }
      const relative = decodeURIComponent(target.split(/[?#]/)[0] ?? '').replace(/^\.\//, '');
      const base = file.includes('/') ? file.slice(0, file.lastIndexOf('/') + 1) : '';
      const resolved = `${base}${relative}`.replace(/\/$/, '');
      if (repoFileExists(resolved)) continue;
      const screenshot = /^assets\/screenshots\/([a-z]+)\/([a-z0-9-]+)-(light|dark)\.png$/.exec(
        resolved,
      );
      if (screenshot && promised.get(screenshot[1] ?? '')?.has(screenshot[2] ?? '')) continue;
      missing.push(target);
    }
    expect(missing).toEqual([]);
  });
}

test('README references screenshots only by the names their agents promise', () => {
  const promised = promisedScreenshots();
  const shots = linkTargets(readRepoFile('README.md')).filter((target) =>
    target.startsWith('assets/screenshots/'),
  );
  expect(shots.length).toBeGreaterThan(10);
  for (const shot of shots) {
    const match = /^assets\/screenshots\/([a-z]+)\/([a-z0-9-]+)-(light|dark)\.png$/.exec(shot);
    expect(match, shot).not.toBeNull();
    const [, area = '', name = ''] = match ?? [];
    if (repoFileExists(shot)) continue;
    expect(promised.get(area)?.has(name), `${shot} is not a promised screenshot`).toBe(true);
  }
  // Each light screenshot has its dark twin next to it (the <picture> elements).
  const light = shots.filter((shot) => shot.endsWith('-light.png'));
  for (const shot of light) expect(shots).toContain(shot.replace('-light.png', '-dark.png'));
});

test('README images all have alt text', () => {
  const readme = readRepoFile('README.md');
  const images = [...readme.matchAll(/<img\b[^>]*>/g)].map((match) => match[0]);
  expect(images.length).toBeGreaterThan(5);
  for (const image of images) expect(image, image).toMatch(/\balt="[^"]{3,}"/);
});

test('README top: logo, tagline, badges, links row and the demo', () => {
  const readme = readRepoFile('README.md');
  const top = readme.slice(0, readme.indexOf('## Features'));
  expect(top).toContain('assets/brand/wordmark-light.svg');
  expect(top).toContain('assets/brand/wordmark-dark.svg');
  expect(top).toContain("Notion's power, Obsidian's freedom.");
  for (const badge of [
    'actions/workflows/ci.yml/badge.svg',
    'github/v/release',
    'github/license',
    'docker',
  ]) {
    expect(top).toContain(badge);
  }
  for (const link of ['Docs', 'Download', 'Self-host', 'Plugins', 'Roadmap']) {
    expect(top).toContain(`**[${link}]`);
  }
  expect(top).toContain('assets/demo.gif');
  expect(top).toContain('PLACEHOLDER');
});

test('the demo placeholder is a real GIF', () => {
  const header = readFileSync(repoPath('assets/demo.gif')).subarray(0, 6).toString('ascii');
  expect(['GIF87a', 'GIF89a']).toContain(header);
});

test('README quickstart blocks stay short (four commands at most)', () => {
  const readme = readRepoFile('README.md');
  const quickstart = readme.slice(
    readme.indexOf('## Quickstart'),
    readme.indexOf('## How Tessera compares'),
  );
  const blocks = [...quickstart.matchAll(/```bash\n([\s\S]*?)```/g)].map((match) => match[1] ?? '');
  expect(blocks.length).toBeGreaterThanOrEqual(3);
  for (const block of blocks) {
    const commands = block.split('\n').filter((line) => line.trim() !== '');
    expect(commands.length, block).toBeLessThanOrEqual(4);
  }
});

test('the comparison table is dated and covers every product and criterion', () => {
  const readme = readRepoFile('README.md');
  const section = readme.slice(
    readme.indexOf('## How Tessera compares'),
    readme.indexOf('## Roadmap'),
  );
  expect(section).toMatch(/Last checked \*\*\d{4}-\d{2}-\d{2}\*\*/);
  const header = section
    .split('\n')
    .find((line) => line.startsWith('|') && line.includes('Notion'));
  for (const product of ['Tessera', 'Notion', 'Obsidian', 'Anytype', 'AFFiNE', 'Logseq']) {
    expect(header).toContain(product);
  }
  for (const row of [
    'Open source',
    'Local-first',
    'Self-hostable',
    'Real-time collaboration',
    'Databases',
    'Plugins',
    'Graph view',
    'Price',
  ]) {
    expect(section).toMatch(new RegExp(`^\\| ${row}`, 'm'));
  }
  // Every footnote used in the table is defined.
  const used = new Set([...section.matchAll(/\[\^([a-z-]+)\](?!:)/g)].map((match) => match[1]));
  const defined = new Set([...section.matchAll(/^\[\^([a-z-]+)\]:/gm)].map((match) => match[1]));
  expect([...used].sort()).toEqual([...defined].sort());
});
