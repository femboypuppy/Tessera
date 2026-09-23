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

/**
 * Empty: the contrast tokens, the Avatar text color and the ScrollArea viewport were fixed at the
 * merge (HANDOFF/integration.md). Add an entry only for a violation in code you can't fix yet.
 */
export const KNOWN_VIOLATIONS: readonly KnownViolation[] = [];

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
