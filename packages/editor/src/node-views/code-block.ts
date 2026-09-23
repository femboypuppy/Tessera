import type { NodeViewRenderer } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { languageLabel } from '../code/languages';
import { t } from '../i18n';
import type { EditorController } from '../react/controller';
import { h, icon } from './dom';

/** Writes text to the clipboard; resolves false when the browser refuses. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Code block: a toolbar (language picker, copy button) above the editable `<code>`. Highlighting
 * comes from the lowlight plugin as decorations.
 */
export function codeBlockView(controller: EditorController): NodeViewRenderer {
  return ({ node: initial, getPos }) => {
    let node: PMNode = initial;
    let copiedTimer: ReturnType<typeof setTimeout> | undefined;
    const languageText = h('span');
    const language = h(
      'button',
      {
        type: 'button',
        className: 'tess-code-button tess-code-language',
        'aria-haspopup': 'listbox',
      },
      languageText,
    );
    language.append(icon('chevronDown', 12));
    const copyLabel = h('span', {}, t('copyCode'));
    const copy = h(
      'button',
      { type: 'button', className: 'tess-code-button tess-code-copy', 'aria-label': t('copyCode') },
      icon('copy', 13),
      copyLabel,
    );
    const toolbar = h(
      'div',
      { className: 'tess-code-toolbar', contenteditable: 'false' },
      language,
      copy,
    );
    const code = h('code');
    const dom = h('pre', { className: 'tess-code-block', spellcheck: 'false' }, toolbar, code);

    const render = () => {
      const lang = typeof node.attrs.language === 'string' ? node.attrs.language : null;
      const label = languageLabel(lang) ?? t('plainText');
      languageText.textContent = label;
      language.setAttribute('aria-label', `${t('codeLanguage')}: ${label}`);
      code.className = lang ? `language-${lang}` : '';
      if (lang) dom.dataset.language = lang;
      else delete dom.dataset.language;
      if (typeof node.attrs.blockId === 'string') dom.dataset.blockId = node.attrs.blockId;
      else delete dom.dataset.blockId;
    };
    render();

    for (const button of [language, copy]) {
      button.addEventListener('mousedown', (event) => event.preventDefault());
    }
    language.addEventListener('click', () => {
      const pos = typeof getPos === 'function' ? getPos() : undefined;
      if (pos === undefined || !controller.isEditable()) return;
      controller.openPopover({
        request: { kind: 'codeLanguage', pos },
        anchor: language,
        returnFocus: language,
      });
    });
    copy.addEventListener('click', () => {
      void copyText(node.textContent).then((ok) => {
        if (!ok) {
          controller.toast({ title: t('copyFailed'), variant: 'error' });
          return;
        }
        copy.dataset.copied = '';
        copyLabel.textContent = t('codeCopied');
        copy.replaceChild(icon('check', 13), copy.firstChild ?? copyLabel);
        clearTimeout(copiedTimer);
        copiedTimer = setTimeout(() => {
          delete copy.dataset.copied;
          copyLabel.textContent = t('copyCode');
          copy.replaceChild(icon('copy', 13), copy.firstChild ?? copyLabel);
        }, 1500);
      });
    });

    return {
      dom,
      contentDOM: code,
      update(next) {
        if (next.type !== node.type) return false;
        node = next;
        render();
        return true;
      },
      stopEvent: (event) => event.target instanceof Node && toolbar.contains(event.target),
      ignoreMutation: (mutation) =>
        mutation.type === 'selection' ? false : !code.contains(mutation.target),
      destroy: () => clearTimeout(copiedTimer),
    };
  };
}
