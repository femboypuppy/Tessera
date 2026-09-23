import {
  extractPlainText,
  getPageProp,
  readDocJSON,
  setPageProp,
  type AppContext,
} from '@tessera/core';
import type * as Y from 'yjs';
import { toMarkdown } from './clipboard/markdown';
import { t } from './i18n';
import { copyText } from './node-views/code-block';

/** Word and character counts of a text (words by `Intl.Segmenter` when available). */
export function countText(text: string): { words: number; characters: number } {
  const trimmed = text.trim();
  if (!trimmed) return { words: 0, characters: 0 };
  let words = 0;
  let characters = 0;
  const Segmenter = (Intl as { Segmenter?: typeof Intl.Segmenter }).Segmenter;
  if (Segmenter) {
    for (const segment of new Segmenter(undefined, { granularity: 'word' }).segment(trimmed)) {
      if (segment.isWordLike) words += 1;
    }
    for (const segment of new Segmenter(undefined, { granularity: 'grapheme' }).segment(trimmed)) {
      if (segment.segment !== '\n') characters += 1;
    }
  } else {
    words = trimmed.split(/\s+/).filter(Boolean).length;
    characters = [...trimmed.replace(/\n/g, '')].length;
  }
  return { words, characters };
}

async function withPageDoc<T>(
  ctx: AppContext,
  pageId: string,
  read: (doc: Y.Doc) => T,
): Promise<T> {
  const handle = await ctx.loadPageDoc(pageId);
  try {
    return read(handle.doc);
  } finally {
    handle.release();
  }
}

/** Shows the page's word and character count in a toast. */
export async function showWordCount(ctx: AppContext, pageId: string): Promise<void> {
  const { words, characters } = await withPageDoc(ctx, pageId, (doc) =>
    countText(extractPlainText(readDocJSON(doc))),
  );
  ctx.toast({
    title: t('wordCountResult', {
      words: t('words', { count: words }),
      characters: t('characters', { count: characters }),
    }),
  });
}

/** Copies the whole page as markdown (through the workspace's codec). */
export async function copyPageMarkdown(ctx: AppContext, pageId: string): Promise<void> {
  const markdown = await withPageDoc(ctx, pageId, (doc) => toMarkdown(ctx, readDocJSON(doc)));
  const ok = await copyText(markdown);
  ctx.toast(
    ok
      ? { title: t('pageCopied'), variant: 'success' }
      : { title: t('copyFailed'), variant: 'error' },
  );
}

/** Toggles a boolean display prop of the page (`fullWidth`, `smallText`); the shell applies it. */
export async function togglePageDisplay(
  ctx: AppContext,
  pageId: string,
  key: 'fullWidth' | 'smallText',
): Promise<void> {
  const next = await withPageDoc(ctx, pageId, (doc) => {
    const value = getPageProp(doc, key) !== true;
    setPageProp(doc, key, value);
    return value;
  });
  const title =
    key === 'fullWidth'
      ? next
        ? t('fullWidthOn')
        : t('fullWidthOff')
      : next
        ? t('smallTextOn')
        : t('smallTextOff');
  ctx.toast({ title, durationMs: 2000 });
}
