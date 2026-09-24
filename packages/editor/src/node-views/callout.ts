import type { NodeViewRenderer } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { t } from '../i18n';
import type { EditorController } from '../react/controller';
import { DEFAULT_CALLOUT_EMOJI, parseCalloutTone } from '../schema/nodes/callout';
import { h } from './dom';

/**
 * Callout: an emoji button (opens the emoji picker and tone menu) next to the editable content.
 * Plain DOM, so a page with many callouts stays fast.
 */
export function calloutView(controller: EditorController): NodeViewRenderer {
  return ({ node: initial, getPos }) => {
    let node: PMNode = initial;
    const emoji = h('button', {
      type: 'button',
      className: 'tess-callout-emoji',
      contenteditable: 'false',
      'aria-label': t('calloutIcon'),
      'aria-haspopup': 'dialog',
    });
    const content = h('div', { className: 'tess-callout-content' });
    const dom = h('aside', { className: 'tess-callout', 'data-type': 'callout' }, emoji, content);

    const render = () => {
      emoji.textContent = String(node.attrs.emoji || DEFAULT_CALLOUT_EMOJI);
      dom.dataset.tone = parseCalloutTone(node.attrs.tone);
      if (typeof node.attrs.blockId === 'string') dom.dataset.blockId = node.attrs.blockId;
      else delete dom.dataset.blockId;
    };
    render();

    emoji.addEventListener('mousedown', (event) => event.preventDefault());
    emoji.addEventListener('click', () => {
      const pos = typeof getPos === 'function' ? getPos() : undefined;
      if (pos === undefined || !controller.isEditable()) return;
      controller.openPopover({
        request: { kind: 'callout', pos },
        anchor: emoji,
        returnFocus: emoji,
      });
    });

    return {
      dom,
      contentDOM: content,
      update(next) {
        if (next.type !== node.type) return false;
        node = next;
        render();
        return true;
      },
      stopEvent: (event) => event.target instanceof Node && emoji.contains(event.target),
      ignoreMutation: (mutation) =>
        mutation.type === 'selection' ? false : !content.contains(mutation.target),
    };
  };
}
