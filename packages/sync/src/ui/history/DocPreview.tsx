import { isSafeHref, isSafeImageSrc, type AnyNodeJSON, type DocJSON } from '@tessera/core';
import { useAppContext, usePages } from '@tessera/core/react';
import { cn } from '@tessera/ui';
import { useEffect, useState, type ReactNode } from 'react';
import { t } from '../../i18n';

/**
 * A read-only rendering of a page version (every node and mark of the canonical schema, as plain
 * React elements: no HTML strings, links only when `isSafeHref` accepts them). The editor's
 * read-only view can replace it at merge time.
 */
export function DocPreview({ doc }: { doc: DocJSON }) {
  const nodes = (doc.content as unknown as AnyNodeJSON[]) ?? [];
  const empty = nodes.every((node) => node.type === 'paragraph' && !node.content?.length);
  if (empty) return <p className="text-ui text-fg-subtle italic">{t('emptyPage')}</p>;
  return (
    <div className="flex flex-col gap-2 text-sm leading-relaxed [overflow-wrap:anywhere] text-fg">
      {nodes.map((node, index) => (
        <Block key={index} node={node} />
      ))}
    </div>
  );
}

function attr<T>(node: AnyNodeJSON, key: string, guard: (value: unknown) => value is T): T | null {
  const value = node.attrs?.[key];
  return guard(value) ? value : null;
}
const isString = (value: unknown): value is string => typeof value === 'string';
const isNumber = (value: unknown): value is number => typeof value === 'number';

function children(node: AnyNodeJSON): ReactNode {
  return (node.content ?? []).map((child, index) => <Block key={index} node={child} />);
}

function inline(node: AnyNodeJSON): ReactNode {
  return (node.content ?? []).map((child, index) => <Inline key={index} node={child} />);
}

function Block({ node }: { node: AnyNodeJSON }): ReactNode {
  switch (node.type) {
    case 'paragraph':
      return <p className="min-h-[1.5em]">{inline(node)}</p>;
    case 'heading': {
      const level = attr(node, 'level', isNumber) ?? 1;
      const className = cn(
        'font-semibold tracking-tight text-fg',
        level === 1 ? 'mt-2 text-lg' : level === 2 ? 'mt-1.5 text-base' : 'text-sm',
      );
      return level === 1 ? (
        <h3 className={className}>{inline(node)}</h3>
      ) : level === 2 ? (
        <h4 className={className}>{inline(node)}</h4>
      ) : (
        <h5 className={className}>{inline(node)}</h5>
      );
    }
    case 'blockquote':
      return (
        <blockquote className="flex flex-col gap-2 border-l-2 border-border-strong pl-3 text-fg-muted">
          {children(node)}
        </blockquote>
      );
    case 'callout':
      return (
        <div className="flex gap-2 rounded-md bg-bg-subtle px-3 py-2">
          <span aria-hidden="true">{attr(node, 'emoji', isString) ?? '💡'}</span>
          <div className="flex min-w-0 flex-col gap-2">{children(node)}</div>
        </div>
      );
    case 'codeBlock':
      return (
        <pre className="overflow-x-auto rounded-md bg-bg-subtle px-3 py-2 font-mono text-xs">
          <code>{(node.content ?? []).map((child) => child.text ?? '').join('')}</code>
        </pre>
      );
    case 'horizontalRule':
      return <hr className="border-border" />;
    case 'image':
      return <PreviewImage node={node} />;
    case 'bulletList':
      return <ul className="flex list-disc flex-col gap-1 pl-5">{children(node)}</ul>;
    case 'orderedList':
      return (
        <ol
          start={attr(node, 'start', isNumber) ?? 1}
          className="flex list-decimal flex-col gap-1 pl-5"
        >
          {children(node)}
        </ol>
      );
    case 'taskList':
      return <ul className="flex flex-col gap-1">{children(node)}</ul>;
    case 'listItem':
      return <li className="[&>p]:min-h-0">{children(node)}</li>;
    case 'taskItem': {
      const checked = node.attrs?.checked === true;
      return (
        <li className="flex items-start gap-2">
          <input
            type="checkbox"
            checked={checked}
            readOnly
            disabled
            aria-label={checked ? '✓' : '○'}
            className="mt-1"
          />
          <div className={cn('min-w-0 flex-1', checked && 'text-fg-muted line-through')}>
            {children(node)}
          </div>
        </li>
      );
    }
    case 'table':
      return (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-ui">
            <tbody>{children(node)}</tbody>
          </table>
        </div>
      );
    case 'tableRow':
      return <tr>{children(node)}</tr>;
    case 'tableHeader':
      return (
        <th className="border border-border bg-bg-subtle px-2 py-1 text-left font-medium">
          {children(node)}
        </th>
      );
    case 'tableCell':
      return <td className="border border-border px-2 py-1 align-top">{children(node)}</td>;
    case 'toggle': {
      const [summary, ...rest] = node.content ?? [];
      return (
        <details open={node.attrs?.open === true} className="group">
          <summary className="cursor-pointer">{summary ? inline(summary) : null}</summary>
          <div className="mt-1 flex flex-col gap-2 pl-5">
            {rest.map((child, index) => (
              <Block key={index} node={child} />
            ))}
          </div>
        </details>
      );
    }
    case 'embed':
      return (
        <div className="rounded-md border border-dashed border-border px-3 py-2 text-ui text-fg-muted">
          {attr(node, 'kind', isString) ?? 'embed'}
          {attr(node, 'ref', isString) ? ` · ${attr(node, 'ref', isString) ?? ''}` : ''}
        </div>
      );
    default:
      return node.content ? <div>{children(node)}</div> : null;
  }
}

function PreviewImage({ node }: { node: AnyNodeJSON }) {
  const ctx = useAppContext();
  const assetId = attr(node, 'assetId', isString);
  const src = attr(node, 'src', isString);
  const alt = attr(node, 'alt', isString) ?? '';
  const [url, setUrl] = useState<string | null>(src && isSafeImageSrc(src) ? src : null);
  useEffect(() => {
    if (!assetId) return undefined;
    let active = true;
    void ctx.services.assetStore
      .getUrl(assetId)
      .then((value) => {
        if (active && value) setUrl(value);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [ctx, assetId]);
  if (!url) return <div className="h-24 rounded-md bg-bg-subtle" role="img" aria-label={alt} />;
  return <img src={url} alt={alt} className="max-h-64 max-w-full rounded-md object-contain" />;
}

function PageLinkChip({ node }: { node: AnyNodeJSON }) {
  const pages = usePages();
  const pageId = attr(node, 'pageId', isString);
  const page = pageId ? pages.get(pageId) : undefined;
  const label = attr(node, 'label', isString) ?? (page ? page.title || t('untitled') : null);
  return (
    <span
      className={cn(
        'rounded-sm px-0.5 underline decoration-border-strong underline-offset-2',
        !page && 'text-fg-subtle line-through',
      )}
    >
      {page?.icon ? `${page.icon} ` : ''}
      {label ?? t('untitled')}
    </span>
  );
}

function Inline({ node }: { node: AnyNodeJSON }): ReactNode {
  if (node.type === 'hardBreak') return <br />;
  if (node.type === 'tag')
    return <span className="text-accent-text">#{attr(node, 'name', isString) ?? ''}</span>;
  if (node.type === 'pageLink') return <PageLinkChip node={node} />;
  if (node.type !== 'text') return null;
  let content: ReactNode = node.text ?? '';
  for (const mark of node.marks ?? []) {
    switch (mark.type) {
      case 'bold':
        content = <strong className="font-semibold">{content}</strong>;
        break;
      case 'italic':
        content = <em>{content}</em>;
        break;
      case 'underline':
        content = <u>{content}</u>;
        break;
      case 'strike':
        content = <s>{content}</s>;
        break;
      case 'code':
        content = (
          <code className="rounded-sm bg-bg-subtle px-1 font-mono text-[0.9em]">{content}</code>
        );
        break;
      case 'highlight':
        content = <mark className="rounded-sm bg-tag-yellow-bg text-fg">{content}</mark>;
        break;
      case 'link': {
        const href = mark.attrs?.href;
        content = isSafeHref(href) ? (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent-text underline underline-offset-2"
          >
            {content}
          </a>
        ) : (
          content
        );
        break;
      }
      default:
        break;
    }
  }
  return content;
}
