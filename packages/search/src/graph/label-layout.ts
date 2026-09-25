/** A label's rectangle on screen, in pixels. */
export interface LabelBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface LabelCandidate {
  box: LabelBox;
  /** The node's size on screen: bigger nodes keep their labels. */
  size: number;
  /** Labels the view asked for (a highlighted page's neighbors) go before the rest. */
  forced: boolean;
}

/** Room kept between two labels, in pixels. */
const GAP = 2;

function overlaps(a: LabelBox, b: LabelBox): boolean {
  return (
    a.left < b.right + GAP &&
    b.left < a.right + GAP &&
    a.top < b.bottom + GAP &&
    b.top < a.bottom + GAP
  );
}

/**
 * The labels to draw, so that none runs into another: forced labels first, then from the biggest
 * node down, each one kept only if it clears every label kept before it. Sigma's label grid picks
 * at most one label per cell, but a label reaches into the next cell, where a neighbor's label can
 * start at the same height.
 */
export function placeLabels<T extends LabelCandidate>(candidates: readonly T[]): T[] {
  const ordered = [...candidates].sort(
    (a, b) => Number(b.forced) - Number(a.forced) || b.size - a.size,
  );
  const placed: T[] = [];
  for (const candidate of ordered) {
    if (placed.some((other) => overlaps(other.box, candidate.box))) continue;
    placed.push(candidate);
  }
  return placed;
}
