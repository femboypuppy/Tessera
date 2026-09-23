import type { DocJSON } from '@tessera/core';
import { cn } from '@tessera/ui';
import type { ReactNode } from 'react';

/**
 * A plugin's README, rendered from the document tree the markdown codec makes of it. Elements are
 * built one by one (never from an HTML string), so a README can't inject markup or scripts; links
 * only open http(s) and mailto addresses, in a new tab.
 */

/** A document node, read loosely: the README is the plugin author's, so nothing is assumed. */
interface Node {
  type: string;
  attrs?: object;
  content?: readonly Node[];
  marks?: ReadonlyArray<{ type: string; attrs?: object }>;
  text?: string;
}

function attr(value: { attrs?: object }, name: string): unknown {
  return value.attrs ? (value.attrs as Record<string, unknown>)[name] : undefined;
}

const SAFE_HREF = /^(https?:|mailto:)/i;

function textOf(node: Node): string {
  if (node.type === 'text') return typeof node.text === 'string' ? node.text : '';
  return (node.content ?? []).map(textOf).join('');
}

function inline(nodes: readonly Node[] | undefined, key: string): ReactNode[] {
  return (nodes ?? []).map((node, index) => {
    const id = `${key}.${index}`;
    if (node.type === 'hardBreak') return <br key={id} />;
    if (node.type !== 'text') return <span key={id}>{textOf(node)}</span>;
    let element: ReactNode = typeof node.text === 'string' ? node.text : '';
    for (const mark of node.marks ?? []) {
      switch (mark.type) {
        case 'bold':
          element = <strong>{element}</strong>;
          break;
        case 'italic':
          element = <em>{element}</em>;
          break;
        case 'underline':
          element = <u>{element}</u>;
          break;
        case 'strike':
          element = <s>{element}</s>;
          break;
        case 'code':
          element = (
            <code className="rounded-sm bg-bg-subtle px-1 py-px font-mono text-[0.9em]">
              {element}
            </code>
          );
          break;
        case 'link': {
          const href = attr(mark, 'href');
          if (typeof href === 'string' && SAFE_HREF.test(href))
            element = (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent-text underline-offset-2 hover:underline"
              >
                {element}
              </a>
            );
          break;
        }
        default:
          break;
      }
    }
    return <span key={id}>{element}</span>;
  });
}

const HEADING_CLASS = 'mt-5 mb-2 font-semibold text-fg first:mt-0';

function block(node: Node, key: string): ReactNode {
  const children = (nodes: readonly Node[] | undefined) =>
    (nodes ?? []).map((child, index) => block(child, `${key}.${index}`));
  switch (node.type) {
    case 'paragraph':
      return (
        <p key={key} className="my-2 first:mt-0 last:mb-0">
          {inline(node.content, key)}
        </p>
      );
    case 'heading': {
      // The README sits under the plugin's name (h3) and its section title (h4).
      const level = attr(node, 'level');
      const content = inline(node.content, key);
      if (typeof level !== 'number' || level <= 1)
        return (
          <h5 key={key} className={cn(HEADING_CLASS, 'text-base')}>
            {content}
          </h5>
        );
      return (
        <h6 key={key} className={cn(HEADING_CLASS, 'text-ui', level > 2 && 'text-fg-muted')}>
          {content}
        </h6>
      );
    }
    case 'bulletList':
    case 'taskList':
      return (
        <ul key={key} className="my-2 list-disc pl-5">
          {children(node.content)}
        </ul>
      );
    case 'orderedList': {
      const start = attr(node, 'start');
      return (
        <ol
          key={key}
          className="my-2 list-decimal pl-5"
          start={typeof start === 'number' ? start : undefined}
        >
          {children(node.content)}
        </ol>
      );
    }
    case 'listItem':
    case 'taskItem':
      return (
        <li key={key} className="my-0.5">
          {children(node.content)}
        </li>
      );
    case 'blockquote':
    case 'callout':
      return (
        <blockquote key={key} className="my-2 border-l-2 border-border-strong pl-3 text-fg-muted">
          {children(node.content)}
        </blockquote>
      );
    case 'codeBlock':
      return (
        <pre
          key={key}
          className="my-2 overflow-x-auto rounded-md bg-bg-subtle px-3 py-2 font-mono text-xs leading-relaxed"
        >
          <code>{textOf(node)}</code>
        </pre>
      );
    case 'horizontalRule':
      return <hr key={key} className="my-4 border-border" />;
    case 'table':
      return (
        <div key={key} className="my-2 overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <tbody>{children(node.content)}</tbody>
          </table>
        </div>
      );
    case 'tableRow':
      return <tr key={key}>{children(node.content)}</tr>;
    case 'tableHeader':
      return (
        <th key={key} className="border border-border px-2 py-1 font-semibold">
          {children(node.content)}
        </th>
      );
    case 'tableCell':
      return (
        <td key={key} className="border border-border px-2 py-1">
          {children(node.content)}
        </td>
      );
    case 'toggle':
      return (
        <div key={key} className="my-2">
          {children(node.content)}
        </div>
      );
    case 'toggleSummary':
      return (
        <p key={key} className="my-1 font-medium">
          {inline(node.content, key)}
        </p>
      );
    default: {
      // Images (their paths point into the plugin's repository), embeds and anything newer:
      // their text, if any.
      const text = textOf(node);
      return text ? (
        <p key={key} className="my-2">
          {text}
        </p>
      ) : null;
    }
  }
}

/** True for a title that only repeats the plugin's name (maybe with an emoji). */
function repeatsName(node: Node | undefined, pluginName: string): boolean {
  if (node?.type !== 'heading') return false;
  const title = textOf(node).trim().toLowerCase();
  const name = pluginName.trim().toLowerCase();
  return title.startsWith(name) && !/[\p{L}\p{N}]/u.test(title.slice(name.length));
}

/** Renders a README document. A leading title that repeats the plugin's name is left out. */
export function ReadmeView({ doc, pluginName }: { doc: DocJSON; pluginName: string }) {
  const nodes: Node[] = [...doc.content];
  if (repeatsName(nodes[0], pluginName)) nodes.shift();
  if (!nodes.length) return null;
  return (
    <div className="text-ui leading-relaxed text-fg" data-readme="">
      {nodes.map((node, index) => block(node, String(index)))}
    </div>
  );
}
