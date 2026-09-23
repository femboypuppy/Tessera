import { EMPTY_GROUP_KEY } from '@tessera/core';
import { describe, expect, it } from 'vitest';
import { options, property } from '../../test/fixtures';
import { cardId, columnId, moveGroupKey, parseDragId, valueForGroupMove } from './board-logic';

const stage = property('stage', 'select', { options: options(['todo'], ['doing'], ['done']) });
const tags = property('tags', 'multiSelect', { options: options(['ui'], ['api'], ['docs']) });
const done = property('done', 'checkbox');
const note = property('note', 'text');

describe('drag IDs', () => {
  it('round-trips card and column IDs', () => {
    expect(parseDragId(cardId('todo', 'row-1'))).toEqual({ groupKey: 'todo', rowId: 'row-1' });
    expect(parseDragId(columnId('todo'))).toEqual({ groupKey: 'todo', rowId: null });
    // Group keys may contain the separator (dates, numbers never do; be safe anyway).
    expect(parseDragId(cardId('a|b', 'row-1'))).toEqual({ groupKey: 'a|b', rowId: 'row-1' });
    expect(parseDragId('plain')).toEqual({ groupKey: 'plain', rowId: null });
  });
});

describe('valueForGroupMove', () => {
  it('sets the target option of a select, or clears it for "No value"', () => {
    expect(valueForGroupMove(stage, 'todo', 'todo', 'done')).toBe('done');
    expect(valueForGroupMove(stage, 'todo', 'todo', EMPTY_GROUP_KEY)).toBeNull();
    expect(valueForGroupMove(stage, 'todo', 'todo', 'deleted')).toBeUndefined();
    expect(valueForGroupMove(stage, 'todo', 'todo', 'todo')).toBeUndefined();
  });

  it('swaps the source option for the target in a multi-select', () => {
    expect(valueForGroupMove(tags, ['ui', 'api'], 'ui', 'docs')).toEqual(['api', 'docs']);
    expect(valueForGroupMove(tags, ['ui', 'api'], 'ui', 'api')).toEqual(['api']);
    expect(valueForGroupMove(tags, ['ui'], 'ui', EMPTY_GROUP_KEY)).toBeNull();
    expect(valueForGroupMove(tags, undefined, EMPTY_GROUP_KEY, 'ui')).toEqual(['ui']);
    expect(valueForGroupMove(tags, ['ui', 'gone'], 'ui', 'docs')).toEqual(['docs']);
    expect(valueForGroupMove(tags, ['ui'], 'ui', 'deleted')).toBeUndefined();
  });

  it('checks or unchecks a checkbox, and leaves other types alone', () => {
    expect(valueForGroupMove(done, null as never, 'false', 'true')).toBe(true);
    expect(valueForGroupMove(done, true, 'true', 'false')).toBeNull();
    expect(valueForGroupMove(note, 'x', 'x', 'y')).toBeUndefined();
  });
});

describe('moveGroupKey', () => {
  it('moves a group within the order, clamped to the ends', () => {
    expect(moveGroupKey(['a', 'b', 'c'], 'a', 1)).toEqual(['b', 'a', 'c']);
    expect(moveGroupKey(['a', 'b', 'c'], 'c', -5)).toEqual(['c', 'a', 'b']);
    expect(moveGroupKey(['a', 'b', 'c'], 'c', 1)).toEqual(['a', 'b', 'c']);
    expect(moveGroupKey(['a', 'b'], 'missing', 1)).toEqual(['a', 'b']);
  });
});
