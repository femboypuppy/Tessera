import { describe, expect, it } from 'vitest';
import { lighthouseMarkdown } from './summary.ts';

describe('lighthouseMarkdown', () => {
  it('shows the representative run of each page with colored scores', () => {
    const markdown = lighthouseMarkdown([
      {
        url: 'http://localhost:4173/',
        isRepresentativeRun: true,
        summary: { performance: 0.97, accessibility: 0.88, 'best-practices': 1, seo: 0.42 },
      },
      {
        url: 'http://localhost:4173/',
        isRepresentativeRun: false,
        summary: { performance: 0.5, accessibility: 0.5, 'best-practices': 0.5, seo: 0.5 },
      },
      {
        url: 'http://localhost:4173/dev/ui',
        isRepresentativeRun: true,
        summary: { performance: 0.91 },
      },
    ]);
    expect(markdown).toContain('| `/` | 🟢 97 | 🟠 88 | 🟢 100 | 🔴 42 |');
    expect(markdown).toContain('| `/dev/ui` | 🟢 91 | – | – | – |');
    expect(markdown).not.toContain('🟠 50');
  });

  it('says so when there are no results', () => {
    expect(lighthouseMarkdown(null)).toContain('| (no results) |');
  });
});
