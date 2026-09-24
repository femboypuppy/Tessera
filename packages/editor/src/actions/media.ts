import { isHttpUrl, isSafeImageSrc, type WebEmbedData } from '@tessera/core';
import type { Editor } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { TextSelection } from '@tiptap/pm/state';
import { createTable } from '@tiptap/extension-table';
import { resolveEmbed } from '../embeds/providers';
import { t } from '../i18n';
import type { EditorController } from '../react/controller';
import { insertBlocks } from './blocks';

/**
 * Image types the editor accepts from uploads, pastes and drops. SVG is left out on purpose: an
 * SVG served from the app's own origin (an object URL) can run scripts if opened directly.
 */
export const IMAGE_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/avif',
] as const;

/** True for files the editor turns into image blocks. */
export function isImageFile(file: Blob): boolean {
  return (IMAGE_MIME_TYPES as readonly string[]).includes(file.type);
}

function clampPos(editor: Editor, pos: number): number {
  return Math.max(0, Math.min(pos, editor.state.doc.content.size));
}

/**
 * Stores image files in the `AssetStore` and inserts one image block per file at `at` (documents
 * reference the asset ID, never a URL, so images work offline and on every device).
 */
export async function insertImageFiles(
  controller: EditorController,
  files: readonly File[],
  at: number,
): Promise<boolean> {
  const images = files.filter(isImageFile);
  if (images.length === 0) {
    if (files.length) controller.toast({ title: t('imageNotAnImage'), variant: 'warning' });
    return false;
  }
  const editor = controller.editor;
  if (!editor) return false;
  try {
    const stored = await Promise.all(
      images.map((file) => controller.ctx.services.assetStore.put(file, { name: file.name })),
    );
    if (editor.isDestroyed) return false;
    const nodes = stored
      .map(({ assetId }, index) =>
        editor.schema.nodes.image?.create({
          assetId,
          alt: images[index]?.name.replace(/\.[a-z0-9]+$/i, '') || null,
        }),
      )
      .filter((node): node is PMNode => !!node);
    return insertBlocks(editor, clampPos(editor, at), nodes);
  } catch (error) {
    console.error('[editor] Image upload failed', error);
    controller.toast({ title: t('imageUploadFailed'), variant: 'error' });
    return false;
  }
}

/** Inserts an image from an http(s) URL. Returns false for unsafe or invalid URLs. */
export function insertImageUrl(editor: Editor, url: string, at: number): boolean {
  if (!isHttpUrl(url) || !isSafeImageSrc(url)) return false;
  const node = editor.schema.nodes.image?.create({ src: url });
  return node ? insertBlocks(editor, clampPos(editor, at), [node]) : false;
}

/**
 * Inserts a `web` embed for a URL: a player for allowlisted providers when `display` is `embed`,
 * otherwise a bookmark card. Returns what was inserted.
 */
export function insertWebEmbed(
  editor: Editor,
  url: string,
  display: 'embed' | 'bookmark',
  at: number,
): 'embed' | 'bookmark' | null {
  if (!isHttpUrl(url)) return null;
  const embeddable = display === 'embed' && resolveEmbed(url) !== null;
  const data: WebEmbedData = { display: embeddable ? 'embed' : 'bookmark' };
  const node = editor.schema.nodes.embed?.create({ kind: 'web', ref: url, data });
  if (!node || !insertBlocks(editor, clampPos(editor, at), [node])) return null;
  return data.display;
}

/** Inserts a table (with a header row) and puts the caret in its first cell. */
export function insertTable(editor: Editor, rows: number, columns: number, at: number): boolean {
  const table = createTable(editor.schema, rows, columns, true);
  const start = clampPos(editor, at);
  if (!insertBlocks(editor, start, [table])) return false;
  // Find the table that was just inserted and move into its first cell.
  let tablePos: number | null = null;
  editor.state.doc.nodesBetween(
    Math.max(0, start - 2),
    Math.min(editor.state.doc.content.size, start + table.nodeSize + 2),
    (node, pos) => {
      if (tablePos === null && node.type.name === 'table') tablePos = pos;
      return tablePos === null;
    },
  );
  if (tablePos !== null) {
    const firstText = TextSelection.near(editor.state.doc.resolve((tablePos as number) + 3));
    editor.view.dispatch(editor.state.tr.setSelection(firstText));
  }
  editor.view.focus();
  return true;
}
