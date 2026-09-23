import { COMMANDS, type PageMeta } from '@tessera/core';
import type { NodeViewRenderer } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { t } from '../i18n';
import type { EditorController } from '../react/controller';
import { h, icon } from './dom';

/** What a page link shows: its text, icon and whether the target is missing or trashed. */
export interface PageLinkDisplay {
  text: string;
  icon: string | null;
  state: 'ok' | 'missing' | 'trashed';
}

/** Computes what a `pageLink` shows from its attributes and the target's current metadata. */
export function pageLinkDisplay(
  attrs: { label?: unknown; heading?: unknown },
  page: PageMeta | undefined,
  trashed: boolean,
): PageLinkDisplay {
  const label = typeof attrs.label === 'string' && attrs.label ? attrs.label : null;
  const heading = typeof attrs.heading === 'string' && attrs.heading ? attrs.heading : null;
  if (!page) return { text: label ?? t('missingPage'), icon: null, state: 'missing' };
  const title = page.title || t('untitled');
  const text = label ?? (heading ? `${title} › ${heading}` : title);
  return { text, icon: page.icon ?? null, state: trashed ? 'trashed' : 'ok' };
}

/** Opens the target of a page link (heading and block references included). */
export function openPageLink(controller: EditorController, node: PMNode): void {
  const pageId = typeof node.attrs.pageId === 'string' ? node.attrs.pageId : null;
  if (!pageId) return;
  const snapshot = controller.ctx.workspace.pages.getSnapshot();
  if (!snapshot.get(pageId)) {
    controller.toast({ title: t('linkPreviewMissing'), variant: 'warning' });
    return;
  }
  controller.releaseLinkPreview({ immediate: true });
  const options: { heading?: string; blockId?: string } = {};
  if (typeof node.attrs.heading === 'string' && node.attrs.heading)
    options.heading = node.attrs.heading;
  if (typeof node.attrs.blockRef === 'string' && node.attrs.blockRef)
    options.blockId = node.attrs.blockRef;
  controller.ctx.navigate(pageId, options);
}

/**
 * Page link: shows the target's *current* title and icon (live, so renames propagate), a broken
 * style for missing or trashed pages, navigates on click and previews on hover. Plain DOM with
 * one subscription to the pages store.
 */
export function pageLinkView(controller: EditorController): NodeViewRenderer {
  return ({ node: initial }) => {
    let node: PMNode = initial;
    const iconSlot = h('span', { className: 'tess-page-link-icon', 'aria-hidden': 'true' });
    const title = h('span', { className: 'tess-page-link-title' });
    const dom = h(
      'a',
      { className: 'tess-page-link', 'data-type': 'page-link', contenteditable: 'false' },
      iconSlot,
      title,
    );
    let lastKey = '';

    const render = () => {
      const pageId = typeof node.attrs.pageId === 'string' ? node.attrs.pageId : '';
      const snapshot = controller.ctx.workspace.pages.getSnapshot();
      const page = snapshot.get(pageId);
      const display = pageLinkDisplay(node.attrs, page, page ? snapshot.isTrashed(pageId) : false);
      const key = `${pageId}|${display.text}|${display.icon ?? ''}|${display.state}`;
      if (key === lastKey) return;
      lastKey = key;
      dom.setAttribute('href', `/p/${encodeURIComponent(pageId)}`);
      dom.dataset.pageId = pageId;
      title.textContent = display.text;
      iconSlot.replaceChildren(
        display.icon ?? icon(display.state === 'missing' ? 'fileX' : 'file', 16),
      );
      if (display.state === 'ok') {
        delete dom.dataset.broken;
        dom.removeAttribute('aria-label');
        dom.removeAttribute('title');
      } else {
        dom.dataset.broken = display.state;
        const description =
          display.state === 'trashed'
            ? t('trashedPage', { title: display.text })
            : t('missingPage');
        dom.setAttribute('aria-label', description);
        dom.setAttribute('title', description);
      }
    };
    render();
    const unsubscribe = controller.ctx.workspace.pages.subscribe(render);

    dom.addEventListener('click', (event) => {
      event.preventDefault();
      if (event.button !== 0) return;
      openPageLink(controller, node);
    });
    dom.addEventListener('mouseenter', () => {
      const pageId = typeof node.attrs.pageId === 'string' ? node.attrs.pageId : null;
      if (pageId) controller.requestLinkPreview(pageId, dom);
    });
    dom.addEventListener('mouseleave', () => controller.releaseLinkPreview());

    return {
      dom,
      update(next) {
        if (next.type !== node.type) return false;
        node = next;
        render();
        return true;
      },
      selectNode() {
        dom.classList.add('ProseMirror-selectednode');
        const pageId = typeof node.attrs.pageId === 'string' ? node.attrs.pageId : null;
        if (pageId) controller.requestLinkPreview(pageId, dom);
      },
      deselectNode() {
        dom.classList.remove('ProseMirror-selectednode');
        controller.releaseLinkPreview();
      },
      stopEvent: (event) => event.type === 'click',
      ignoreMutation: () => true,
      destroy() {
        unsubscribe();
        if (controller.linkPreview.get()?.anchor === dom)
          controller.releaseLinkPreview({ immediate: true });
      },
    };
  };
}

/** Runs a search for a tag through the command system (the search feature owns it). */
export async function searchTag(controller: EditorController, name: string): Promise<void> {
  const ran = await controller.ctx.commands.execute(COMMANDS.search, {
    args: { query: `#${name}` },
    source: 'api',
  });
  if (!ran) controller.toast({ title: t('searchUnavailable') });
}

/** Tag: `#name` as a pill; clicking it searches for the tag. */
export function tagView(controller: EditorController): NodeViewRenderer {
  return ({ node: initial }) => {
    let node: PMNode = initial;
    const dom = h('span', { className: 'tess-tag', 'data-type': 'tag', contenteditable: 'false' });
    const render = () => {
      const name = String(node.attrs.name ?? '');
      dom.textContent = `#${name}`;
      dom.dataset.name = name;
      dom.setAttribute('title', t('tagLabel', { name }));
    };
    render();
    dom.addEventListener('click', (event) => {
      event.preventDefault();
      void searchTag(controller, String(node.attrs.name ?? ''));
    });
    return {
      dom,
      update(next) {
        if (next.type !== node.type) return false;
        node = next;
        render();
        return true;
      },
      stopEvent: (event) => event.type === 'click',
      ignoreMutation: () => true,
    };
  };
}
