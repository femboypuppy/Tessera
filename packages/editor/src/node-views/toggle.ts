import type { NodeViewRenderer } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { TextSelection } from '@tiptap/pm/state';
import { t } from '../i18n';
import { h, icon } from './dom';

/**
 * Toggle: a chevron button and the content (summary first, hidden blocks after). The open state is
 * stored in the document (so it's remembered), except on read-only pages, where it only changes
 * locally. An open toggle with nothing inside offers a click target to add the first block.
 */
export function toggleView(): NodeViewRenderer {
  return ({ node: initial, getPos, editor }) => {
    let node: PMNode = initial;
    let localOpen: boolean | null = null;
    const button = h('button', {
      type: 'button',
      className: 'tess-toggle-button',
      contenteditable: 'false',
    });
    button.append(icon('chevronRight', 12));
    const content = h('div', { className: 'tess-toggle-content' });
    const empty = h(
      'div',
      { className: 'tess-toggle-empty', contenteditable: 'false', role: 'button', tabindex: -1 },
      t('toggleEmpty'),
    );
    const dom = h(
      'div',
      { className: 'tess-toggle', 'data-type': 'toggle' },
      button,
      content,
      empty,
    );

    const isOpen = () => localOpen ?? node.attrs.open === true;
    const render = () => {
      const open = isOpen();
      dom.dataset.open = String(open);
      dom.dataset.empty = String(node.childCount <= 1);
      button.setAttribute('aria-expanded', String(open));
      button.setAttribute('aria-label', open ? t('toggleClose') : t('toggleOpen'));
      if (typeof node.attrs.color === 'string') dom.dataset.color = node.attrs.color;
      else delete dom.dataset.color;
      if (typeof node.attrs.blockId === 'string') dom.dataset.blockId = node.attrs.blockId;
      else delete dom.dataset.blockId;
    };
    render();

    const position = () => (typeof getPos === 'function' ? getPos() : undefined);

    button.addEventListener('mousedown', (event) => event.preventDefault());
    button.addEventListener('click', () => {
      const pos = position();
      const next = !isOpen();
      if (pos !== undefined && editor.isEditable) {
        localOpen = null;
        editor.commands.setToggleOpen(pos, next);
      } else {
        localOpen = next;
        render();
      }
    });

    empty.addEventListener('mousedown', (event) => {
      event.preventDefault();
      const pos = position();
      if (pos === undefined || !editor.isEditable) return;
      const summary = node.firstChild;
      if (!summary) return;
      const insertAt = pos + 1 + summary.nodeSize;
      const paragraph = editor.schema.nodes.paragraph?.create();
      if (!paragraph) return;
      const tr = editor.state.tr.insert(insertAt, paragraph);
      tr.setSelection(TextSelection.create(tr.doc, insertAt + 1));
      editor.view.dispatch(tr.scrollIntoView());
      editor.view.focus();
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
      stopEvent: (event) =>
        event.target instanceof Node &&
        (button.contains(event.target) || empty.contains(event.target)),
      ignoreMutation: (mutation) =>
        mutation.type === 'selection' ? false : !content.contains(mutation.target),
    };
  };
}
