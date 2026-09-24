import { extractPlainText, normalizeDocJSON, type AppContext, type DocJSON } from '@tessera/core';
import { Extension, type AnyExtension } from '@tiptap/core';
import { Slice, type Schema } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import DOMPurify from 'dompurify';
import { foldText } from '../menus/fuzzy';
import type { EditorController } from '../react/controller';
import { nodesToDocJSON, toMarkdown } from './markdown';

export const clipboardKey = new PluginKey('tesseraClipboard');
export const clipboardCopyKey = new PluginKey('tesseraClipboardCopy');

/** Removes scripts, event handlers and dangerous URLs from pasted HTML (defense in depth). */
export function sanitizeHTML(html: string): string {
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['style', 'script', 'iframe', 'object', 'embed', 'form', 'input', 'button'],
    FORBID_ATTR: ['style'],
  });
}

/** True for HTML copied from a ProseMirror editor (Tessera itself): it round-trips losslessly. */
export function isEditorHTML(html: string): boolean {
  return /data-pm-slice=/.test(html);
}

/** Resolves `[[Title]]` in pasted markdown to pages of this workspace (exact title, any case). */
function pageResolver(ctx: AppContext): (target: string) => string | null {
  const snapshot = ctx.workspace.pages.getSnapshot();
  return (target) => {
    const wanted = foldText(target.trim());
    const page = snapshot
      .all()
      .find(
        (candidate) => foldText(candidate.title) === wanted && !snapshot.isTrashed(candidate.id),
      );
    return page?.id ?? null;
  };
}

/**
 * Turns a parsed document into a slice for pasting: open on both ends, so a single pasted line
 * joins the paragraph with the caret instead of becoming its own block.
 */
export function docToSlice(schema: Schema, doc: DocJSON): Slice {
  const node = schema.nodeFromJSON(normalizeDocJSON(doc));
  return Slice.maxOpen(node.content);
}

/** Parses clipboard text (markdown or plain text) through the workspace's codec. */
export function parseClipboardText(ctx: AppContext, text: string): DocJSON {
  return ctx.services.markdownCodec.parse(text, { resolvePageLink: pageResolver(ctx) }).doc;
}

/** Parses external clipboard HTML through the workspace's codec (sanitized first). */
export function parseClipboardHTML(ctx: AppContext, html: string): DocJSON {
  return ctx.services.markdownCodec.parseHTML(sanitizeHTML(html));
}

function letters(text: string): number {
  return text.replace(/\s+/g, '').length;
}

/**
 * True when a parsed document accounts for the text of the HTML it came from (within 15%). A
 * codec that drops or duplicates text fails this, and paste falls back to the plain-text flavor,
 * so pasting never silently loses words.
 */
export function accountsForText(doc: DocJSON, html: string): boolean {
  if (typeof DOMParser === 'undefined') return true;
  const expected = letters(
    new DOMParser().parseFromString(sanitizeHTML(html), 'text/html').body.textContent ?? '',
  );
  if (expected === 0) return true;
  const ratio = letters(extractPlainText(doc)) / expected;
  return ratio > 0.85 && ratio < 1.15;
}

/** The document to paste for clipboard data, through the codec (null when there is nothing). */
export function clipboardDoc(ctx: AppContext, html: string, text: string): DocJSON | null {
  if (html) {
    const fromHtml = parseClipboardHTML(ctx, html);
    return text && !accountsForText(fromHtml, html) ? parseClipboardText(ctx, text) : fromHtml;
  }
  return text ? parseClipboardText(ctx, text) : null;
}

/**
 * Copy and paste. Copying puts HTML (for rich targets) and markdown (the plain-text flavor,
 * through the `MarkdownCodec`) on the clipboard. Pasting HTML from another Tessera editor keeps
 * every block exactly; other HTML (Notion, Google Docs, web pages) goes through the codec's
 * sanitizing `parseHTML`; markdown and plain text through `parse`. Nothing ever lands as raw HTML.
 */
export function clipboard(controller: EditorController): AnyExtension[] {
  const copy = Extension.create({
    name: 'tesseraClipboardCopy',
    // Ahead of TipTap's own plain-text serializer.
    priority: 1000,
    addProseMirrorPlugins() {
      return [
        new Plugin({
          key: clipboardCopyKey,
          props: {
            clipboardTextSerializer(slice) {
              // Clipboard slices start at the document root, so list items come with their list.
              const doc = nodesToDocJSON(slice.content);
              const markdown = toMarkdown(controller.ctx, doc);
              // A copied line of text shouldn't bring a trailing line break with it.
              return slice.content.childCount === 1 && slice.content.firstChild?.isTextblock
                ? markdown.replace(/\n+$/, '')
                : markdown;
            },
          },
        }),
      ];
    },
  });

  const paste = Extension.create({
    name: 'tesseraClipboardPaste',
    // After links (URL paste) and media (image files), which handle their own cases first.
    priority: 50,
    addProseMirrorPlugins() {
      return [
        new Plugin({
          key: clipboardKey,
          props: {
            transformPastedHTML(html) {
              return sanitizeHTML(html);
            },
            handlePaste(view, event) {
              if (!controller.isEditable()) return false;
              const data = event.clipboardData;
              if (!data) return false;
              const { $from } = view.state.selection;
              // Code blocks take the text as it is.
              if ($from.parent.type.spec.code) return false;
              const html = data.getData('text/html');
              // From Tessera (or another ProseMirror editor): let ProseMirror keep the structure.
              if (html && isEditorHTML(html)) return false;
              try {
                const doc = clipboardDoc(controller.ctx, html, data.getData('text/plain'));
                if (!doc) return false;
                const slice = docToSlice(view.state.schema, doc);
                if (slice.size === 0) return true;
                event.preventDefault();
                const tr = view.state.tr.replaceSelection(slice);
                tr.setMeta('paste', true).setMeta('uiEvent', 'paste');
                view.dispatch(tr.scrollIntoView());
                return true;
              } catch (error) {
                console.warn('[editor] Paste through the markdown codec failed', error);
                return false;
              }
            },
          },
        }),
      ];
    },
  });

  return [copy, paste];
}
