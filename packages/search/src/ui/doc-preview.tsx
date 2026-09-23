import { inlineText, type AnyNodeJSON, type DocJSON } from '@tessera/core';
import { cn } from '@tessera/ui';
import { Check, Image as ImageIcon, Table2 } from 'lucide-react';
import { useMemo } from 'react';
import { normalizeTerm, tokenSpans } from '../engine/text';
import { t } from '../i18n';
import { Highlighted } from './common';

/** A block of a read-only preview (derived from DocJSON, never edited). */
export type PreviewBlock =
  | { type: 'heading'; level: 1 | 2 | 3; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'quote'; text: string }
  | { type: 'callout'; emoji: string; text: string }
  | { type: 'item'; marker: 'bullet' | 'number'; index: number; depth: number; text: string }
  | { type: 'task'; checked: boolean; depth: number; text: string }
  | { type: 'code'; text: string }
  | { type: 'table'; rows: number }
  | { type: 'image' }
  | { type: 'divider' };

/** Turns a document into at most `max` preview blocks (links show the target's title). */
export function toPreviewBlocks(
  doc: DocJSON,
  resolveTitle: (pageId: string) => string | undefined,
  max = 16,
): PreviewBlock[] {
  const blocks: PreviewBlock[] = [];
  const text = (node: AnyNodeJSON | undefined) => inlineText(node?.content, { resolveTitle });
  const visit = (node: AnyNodeJSON, depth: number) => {
    if (blocks.length >= max) return;
    switch (node.type) {
      case 'heading': {
        const level = node.attrs?.level;
        blocks.push({
          type: 'heading',
          level: level === 2 || level === 3 ? level : 1,
          text: text(node),
        });
        return;
      }
      case 'paragraph': {
        const value = text(node);
        if (value.trim()) blocks.push({ type: 'paragraph', text: value });
        return;
      }
      case 'blockquote':
        blocks.push({ type: 'quote', text: (node.content ?? []).map(text).join(' ') });
        return;
      case 'callout': {
        const emoji = typeof node.attrs?.emoji === 'string' ? node.attrs.emoji : '💡';
        blocks.push({ type: 'callout', emoji, text: (node.content ?? []).map(text).join(' ') });
        return;
      }
      case 'bulletList':
      case 'orderedList':
        (node.content ?? []).forEach((item, index) => {
          blocks.push({
            type: 'item',
            marker: node.type === 'bulletList' ? 'bullet' : 'number',
            index: index + 1,
            depth,
            text: text(item.content?.[0]),
          });
          for (const child of item.content?.slice(1) ?? []) visit(child, depth + 1);
        });
        return;
      case 'taskList':
        for (const item of node.content ?? []) {
          blocks.push({
            type: 'task',
            checked: item.attrs?.checked === true,
            depth,
            text: text(item.content?.[0]),
          });
          for (const child of item.content?.slice(1) ?? []) visit(child, depth + 1);
        }
        return;
      case 'toggle':
        blocks.push({ type: 'paragraph', text: `▸ ${text(node.content?.[0])}` });
        return;
      case 'codeBlock':
        blocks.push({ type: 'code', text: text(node) });
        return;
      case 'table':
        blocks.push({ type: 'table', rows: node.content?.length ?? 0 });
        return;
      case 'image':
        blocks.push({ type: 'image' });
        return;
      case 'horizontalRule':
        blocks.push({ type: 'divider' });
        return;
      default:
        return;
    }
  };
  for (const node of doc.content as AnyNodeJSON[]) visit(node, 0);
  return blocks;
}

/** Ranges of words starting with one of the query's terms (preview highlighting). */
export function prefixHighlights(text: string, terms: readonly string[]) {
  if (terms.length === 0) return [];
  return tokenSpans(text)
    .filter((span) => {
      const term = normalizeTerm(span.token);
      return terms.some((wanted) => term.startsWith(wanted));
    })
    .map((span) => ({ start: span.start, end: span.end }));
}

/** Search terms of a query (two characters or more), folded like the index folds them. */
export function queryTerms(text: string): string[] {
  return tokenSpans(text)
    .map((span) => normalizeTerm(span.token))
    .filter((term) => term.length >= 2);
}

/** Renders preview blocks, highlighting words that start with `terms`. */
export function DocPreview({
  blocks,
  terms,
  className,
}: {
  blocks: readonly PreviewBlock[];
  terms: readonly string[];
  className?: string;
}) {
  const content = useMemo(
    () =>
      blocks.map((block, index) => {
        const mark = (value: string) => (
          <Highlighted text={value} ranges={prefixHighlights(value, terms)} />
        );
        switch (block.type) {
          case 'heading':
            return (
              <p
                key={index}
                className={cn(
                  'font-semibold text-fg',
                  block.level === 1 ? 'mt-2 text-base' : 'mt-1.5 text-sm',
                )}
              >
                {mark(block.text)}
              </p>
            );
          case 'paragraph':
            return (
              <p key={index} className="text-ui text-fg-muted">
                {mark(block.text)}
              </p>
            );
          case 'quote':
            return (
              <p key={index} className="border-l-2 border-border-strong pl-2 text-ui text-fg-muted">
                {mark(block.text)}
              </p>
            );
          case 'callout':
            return (
              <p
                key={index}
                className="flex gap-2 rounded-md bg-bg-subtle px-2 py-1.5 text-ui text-fg-muted"
              >
                <span aria-hidden="true">{block.emoji}</span>
                <span>{mark(block.text)}</span>
              </p>
            );
          case 'item':
            return (
              <p
                key={index}
                className="flex gap-2 text-ui text-fg-muted"
                style={{ paddingLeft: `${block.depth * 16}px` }}
              >
                <span aria-hidden="true" className="w-3 shrink-0 text-fg-subtle">
                  {block.marker === 'bullet' ? '•' : `${block.index}.`}
                </span>
                <span>{mark(block.text)}</span>
              </p>
            );
          case 'task':
            return (
              <p
                key={index}
                className="flex items-start gap-2 text-ui text-fg-muted"
                style={{ paddingLeft: `${block.depth * 16}px` }}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    'mt-0.5 inline-flex size-3.5 shrink-0 items-center justify-center rounded-[3px] border border-border-strong',
                    block.checked && 'border-accent bg-accent text-accent-fg',
                  )}
                >
                  {block.checked ? <Check className="size-2.5" /> : null}
                </span>
                <span className={cn(block.checked && 'line-through opacity-70')}>
                  {mark(block.text)}
                </span>
              </p>
            );
          case 'code':
            return (
              <pre
                key={index}
                className="overflow-hidden rounded-md bg-bg-subtle px-2 py-1.5 font-mono text-2xs whitespace-pre-wrap text-fg-muted"
              >
                {block.text}
              </pre>
            );
          case 'table':
            return (
              <p key={index} className="flex items-center gap-1.5 text-ui text-fg-subtle">
                <Table2 aria-hidden="true" className="size-3.5" />
                {t('previewTable', { count: block.rows })}
              </p>
            );
          case 'image':
            return (
              <p key={index} className="flex items-center gap-1.5 text-ui text-fg-subtle">
                <ImageIcon aria-hidden="true" className="size-3.5" />
                {t('previewImage')}
              </p>
            );
          case 'divider':
            return <hr key={index} className="border-border" />;
          default:
            return null;
        }
      }),
    [blocks, terms],
  );
  return <div className={cn('flex flex-col gap-1.5', className)}>{content}</div>;
}
