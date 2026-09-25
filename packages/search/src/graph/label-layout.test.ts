import { describe, expect, it } from 'vitest';
import { placeLabels, type LabelCandidate } from './label-layout';

function label(
  name: string,
  left: number,
  top: number,
  { width = 100, size = 5, forced = false } = {},
): LabelCandidate & { name: string } {
  return { name, box: { left, top, right: left + width, bottom: top + 14 }, size, forced };
}

const names = (placed: ReadonlyArray<{ name: string }>) => placed.map((item) => item.name).sort();

describe('placeLabels', () => {
  it('keeps labels that are apart', () => {
    const placed = placeLabels([label('Apollo 11', 0, 0), label('Saturn V', 0, 40)]);
    expect(names(placed)).toEqual(['Apollo 11', 'Saturn V']);
  });

  it('drops the smaller node of two whose labels run into each other', () => {
    const placed = placeLabels([
      label('Content review', 0, 0, { size: 4 }),
      label('Exhibit kickoff', 60, 8, { size: 9 }),
    ]);
    expect(names(placed)).toEqual(['Exhibit kickoff']);
  });

  it('keeps a small gap between labels on neighboring lines', () => {
    const placed = placeLabels([label('Apollo program', 0, 0), label('Saturn V', 30, 15)]);
    expect(placed).toHaveLength(1);
  });

  it('draws forced labels before bigger nodes', () => {
    const placed = placeLabels([
      label('Space Race', 0, 0, { size: 12 }),
      label('Yuri Gagarin', 20, 4, { size: 3, forced: true }),
    ]);
    expect(names(placed)).toEqual(['Yuri Gagarin']);
  });

  it('checks each label against every label kept before it', () => {
    const placed = placeLabels([
      label('Mir', 0, 0, { size: 10 }),
      label('Laika', 150, 0, { size: 9 }),
      label('Sputnik 1', 90, 2, { size: 8 }),
    ]);
    expect(names(placed)).toEqual(['Laika', 'Mir']);
  });
});
