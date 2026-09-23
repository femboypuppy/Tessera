import { describe, expect, it } from 'vitest';
import { isValidEmbedKind, parseEmbedKind, pluginBlockKind } from './embeds';
import { isValidTagName, normalizeTagName, tagHierarchy, tagKey } from './tags';

describe('tags', () => {
  it.each([
    ['project', true],
    ['project/alpha', true],
    ['y1984', true],
    ['to-do_list', true],
    ['日本', true],
    ['café', true],
    ['1984', false],
    ['12/34', false],
    ['/leading', false],
    ['trailing/', false],
    ['double//slash', false],
    ['has space', false],
    ['emoji🚀', false],
    ['', false],
    ['x'.repeat(101), false],
  ])('isValidTagName(%j) is %s', (name, valid) => {
    expect(isValidTagName(name)).toBe(valid);
  });

  it('normalizes input, compares case-insensitively and expands nesting', () => {
    expect(normalizeTagName('  #Project/Alpha ')).toBe('Project/Alpha');
    expect(normalizeTagName('#1984')).toBeNull();
    expect(normalizeTagName('café')).toBe('café');
    expect(tagKey('Project/Alpha')).toBe(tagKey('project/ALPHA'));
    expect(tagHierarchy('area/work/q3')).toEqual(['area', 'area/work', 'area/work/q3']);
  });
});

describe('embed kinds', () => {
  it('builds and parses plugin kinds', () => {
    expect(pluginBlockKind('mermaid', 'diagram')).toBe('plugin:mermaid/diagram');
    expect(pluginBlockKind('com.example.charts', 'bar-chart')).toBe(
      'plugin:com.example.charts/bar-chart',
    );
    expect(() => pluginBlockKind('Bad Id', 'x')).toThrow(TypeError);
    expect(() => pluginBlockKind('ok', 'Bad/Type')).toThrow(TypeError);
    expect(parseEmbedKind('plugin:com.example.charts/bar-chart')).toEqual({
      type: 'plugin',
      pluginId: 'com.example.charts',
      blockType: 'bar-chart',
    });
    expect(parseEmbedKind('database')).toEqual({ type: 'database' });
    expect(parseEmbedKind('web')).toEqual({ type: 'web' });
    expect(parseEmbedKind('file')).toEqual({ type: 'file' });
    expect(parseEmbedKind('plugin:broken')).toEqual({ type: 'unknown', kind: 'plugin:broken' });
    expect(parseEmbedKind('math')).toEqual({ type: 'unknown', kind: 'math' });
  });

  it('validates kinds', () => {
    for (const kind of ['database', 'web', 'file', 'math', 'plugin:mermaid/diagram'])
      expect(isValidEmbedKind(kind)).toBe(true);
    for (const kind of ['', 'Database', 'with space', ':x', 'x:', 42, 'a'.repeat(129)])
      expect(isValidEmbedKind(kind)).toBe(false);
  });
});
