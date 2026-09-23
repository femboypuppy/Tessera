/**
 * Accessibility checks with axe-core. `scanAccessibility` runs axe on the page (or part of it)
 * against WCAG 2.2 A/AA plus axe's best practices and returns the violations of the given
 * impacts; `formatViolations` makes them readable in a test failure.
 */
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';

export type Impact = 'minor' | 'moderate' | 'serious' | 'critical';

export interface AxeViolation {
  id: string;
  impact: Impact | null;
  help: string;
  helpUrl: string;
  nodes: Array<{ target: string[]; failureSummary: string }>;
}

export interface ScanOptions {
  /** Only these parts of the page (CSS selectors). */
  include?: string[];
  /** Skip these parts (CSS selectors), for example third-party embeds. */
  exclude?: string[];
  /** Rules to leave out, each with the reason in a comment where it's used. */
  disableRules?: string[];
  /** Which impacts count. Default: serious and critical. */
  impacts?: Impact[];
}

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];

/** Runs axe and returns the violations with the requested impacts. */
export async function scanAccessibility(
  page: Page,
  options: ScanOptions = {},
): Promise<AxeViolation[]> {
  let builder = new AxeBuilder({ page }).withTags(TAGS);
  for (const selector of options.include ?? []) builder = builder.include(selector);
  for (const selector of options.exclude ?? []) builder = builder.exclude(selector);
  if (options.disableRules?.length) builder = builder.disableRules(options.disableRules);
  const results = await builder.analyze();
  const impacts = new Set<Impact>(options.impacts ?? ['serious', 'critical']);
  return results.violations
    .filter((violation) => violation.impact && impacts.has(violation.impact as Impact))
    .map((violation) => ({
      id: violation.id,
      impact: (violation.impact ?? null) as Impact | null,
      help: violation.help,
      helpUrl: violation.helpUrl,
      nodes: violation.nodes.map((node) => ({
        target: node.target.map((part) =>
          Array.isArray(part) ? part.join(' >>> ') : String(part),
        ),
        failureSummary: node.failureSummary ?? '',
      })),
    }));
}

/** A readable report: one block per rule with its first few offending elements. */
export function formatViolations(violations: readonly AxeViolation[]): string {
  if (!violations.length) return 'No accessibility violations.';
  return violations
    .map((violation) => {
      const nodes = violation.nodes
        .slice(0, 5)
        .map(
          (node) =>
            `    - ${node.target.join(' ')}\n      ${node.failureSummary.replace(/\n/g, '\n      ')}`,
        )
        .join('\n');
      const more =
        violation.nodes.length > 5 ? `\n    …and ${violation.nodes.length - 5} more` : '';
      return `[${violation.impact}] ${violation.id}: ${violation.help}\n  ${violation.helpUrl}\n${nodes}${more}`;
    })
    .join('\n\n');
}
