/**
 * Accessibility violations that exist in code this branch doesn't own (the design tokens and
 * components of `packages/ui`), recorded so the axe checks fail on anything *new* while these
 * wait for their fix. Each entry names the exact cause; HANDOFF/ci.md has the proposed token
 * values. Delete an entry as soon as its fix lands: a stale entry hides nothing, but a baseline
 * that only grows is how accessibility erodes.
 */
import type { AxeViolation } from '../support';

interface KnownViolation {
  rule: string;
  /** Why it happens and where the fix goes. */
  reason: string;
  matches(node: AxeViolation['nodes'][number]): boolean;
}

/** Foreground/background pairs below 4.5:1, with the token each one comes from. */
const LOW_CONTRAST_PAIRS: ReadonlyArray<readonly [string, string, string]> = [
  ['#8f8e8a', '#ffffff', '--tess-fg-subtle (light) on the page background'],
  ['#8f8e8a', '#f7f7f5', '--tess-fg-subtle (light) on --tess-bg-subtle (sidebar)'],
  ['#858481', '#202020', '--tess-fg-subtle (dark) on --tess-bg-subtle (sidebar)'],
  ['#858481', '#252525', '--tess-fg-subtle (dark) on --tess-surface'],
  ['#ffffff', '#dc3e42', 'white on --tess-danger (light): danger buttons'],
  ['#ffffff', '#e5484d', 'white on --tess-danger (dark): danger buttons'],
  ['#ffffff', '#f76b15', 'Avatar: white text on an orange user color (feedback.tsx)'],
  ['#ffffff', '#46a758', 'Avatar: white text on a green user color (feedback.tsx)'],
  ['#ffffff', '#ffc53d', 'Avatar: white text on a yellow user color (feedback.tsx)'],
  ['#2f7a4e', '#dbeddb', '--tess-tag-green-fg on its background'],
  ['#0d74ce', '#e6f4fe', '--tess-info-text on the info background'],
  ['#6b6a66', '#e3e2e0', '--tess-tag-gray-fg on its background'],
  ['#b3437a', '#f5e0e9', '--tess-tag-pink-fg on its background'],
  ['#c4403a', '#ffe2dd', '--tess-tag-red-fg on its background'],
  ['#2b6fa8', '#d3e5ef', '--tess-tag-blue-fg on its background'],
  ['#b35c1c', '#fadec9', '--tess-tag-orange-fg on its background'],
];

export const KNOWN_VIOLATIONS: readonly KnownViolation[] = [
  {
    rule: 'color-contrast',
    reason:
      'Design tokens in packages/ui/src/styles/tokens.css below WCAG AA (HANDOFF/ci.md lists compliant values).',
    matches: (node) =>
      LOW_CONTRAST_PAIRS.some(([fg, bg]) =>
        node.failureSummary.includes(`foreground color: ${fg}, background color: ${bg}`),
      ),
  },
  {
    rule: 'scrollable-region-focusable',
    reason:
      'The /dev/ui gallery has a ScrollArea viewport without focusable content (packages/ui ScrollArea needs tabIndex={0} on its viewport).',
    matches: (node) => node.target.join(' ') === '.size-full',
  },
];

/** Splits violations into new ones and known ones (per offending element). */
export function partitionViolations(violations: readonly AxeViolation[]): {
  fresh: AxeViolation[];
  known: AxeViolation[];
} {
  const fresh: AxeViolation[] = [];
  const known: AxeViolation[] = [];
  for (const violation of violations) {
    const rules = KNOWN_VIOLATIONS.filter((entry) => entry.rule === violation.id);
    const isKnown = (node: AxeViolation['nodes'][number]) =>
      rules.some((entry) => entry.matches(node));
    const freshNodes = violation.nodes.filter((node) => !isKnown(node));
    const knownNodes = violation.nodes.filter(isKnown);
    if (freshNodes.length) fresh.push({ ...violation, nodes: freshNodes });
    if (knownNodes.length) known.push({ ...violation, nodes: knownNodes });
  }
  return { fresh, known };
}
