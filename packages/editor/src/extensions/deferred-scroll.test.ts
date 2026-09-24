import { build as b } from '@tessera/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTestEditor } from '../test-utils';
import { scrollRectIntoView } from './deferred-scroll';

const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
  vi.restoreAllMocks();
});

/** An editor inside a 400 px tall scroller (sizes stubbed: jsdom has no layout). */
function setup() {
  const result = createTestEditor({ content: b.doc(b.paragraph('One'), b.paragraph('Two')) });
  cleanups.push(result.destroy);
  const scroller = document.createElement('div');
  scroller.style.overflowY = 'auto';
  Object.defineProperty(scroller, 'scrollHeight', { value: 5000 });
  Object.defineProperty(scroller, 'clientHeight', { value: 400 });
  scroller.getBoundingClientRect = () => new DOMRect(0, 100, 800, 400);
  result.element.replaceWith(scroller);
  scroller.append(result.element);
  cleanups.push(() => scroller.remove());
  return { ...result, scroller };
}

describe('scrollRectIntoView', () => {
  it('scrolls a scroller just enough to show a rect below or above it', () => {
    const { editor, scroller } = setup();
    scrollRectIntoView(editor.view, { top: 560, bottom: 580, left: 10, right: 12 });
    // The scroller's bottom is at 500; the rect ends 80 px below it, plus the 5 px margin.
    expect(scroller.scrollTop).toBe(85);
    scrollRectIntoView(editor.view, { top: 60, bottom: 80, left: 10, right: 12 });
    expect(scroller.scrollTop).toBe(85 - 45);
  });

  it('leaves visible rects alone', () => {
    const { editor, scroller } = setup();
    scrollRectIntoView(editor.view, { top: 200, bottom: 220, left: 10, right: 12 });
    expect(scroller.scrollTop).toBe(0);
  });
});

describe('DeferredScroll', () => {
  it('measures and scrolls on the next frame, not during the transaction', () => {
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    const { editor, scroller } = setup();
    const measure = vi
      .spyOn(editor.view, 'coordsAtPos')
      .mockReturnValue({ top: 700, bottom: 720, left: 10, right: 12 });
    // ProseMirror scrolls only when the DOM selection is in the editor (as it is while typing).
    const text = editor.view.dom.querySelector('p')?.firstChild;
    if (text) document.getSelection()?.collapse(text, 1);
    editor.view.dispatch(editor.state.tr.insertText('!', 4).scrollIntoView());
    editor.view.dispatch(editor.state.tr.insertText('?', 5).scrollIntoView());
    // Nothing measured yet, and two changes share one frame.
    expect(measure).not.toHaveBeenCalled();
    expect(frames).toHaveLength(1);
    frames[0]?.(performance.now());
    expect(measure).toHaveBeenCalledTimes(1);
    expect(scroller.scrollTop).toBe(225);
  });
});
