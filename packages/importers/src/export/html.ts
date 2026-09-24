import {
  getCellValue,
  isSafeHref,
  isSafeImageSrc,
  listProperties,
  listRows,
  readDocJSON,
  resolveRows,
  type AnyNodeJSON,
  type DocJSON,
  type ExportContext,
  type ExportResult,
  type ExportScope,
  type ExportSink,
  type PageMeta,
  type TransferIssue,
} from '@tessera/core';
import { toBase64 } from './backup';
import { formatCell } from './csv-values';
import { fileNameFor } from './names';

/** Strings the HTML shows (translated by the caller). */
export interface HtmlLabels {
  untitled: string;
  needsPlugin: string;
  database: string;
}

export interface HtmlRenderOptions {
  title: string;
  icon?: string;
  labels: HtmlLabels;
  /** Title of a linked page (null when it does not exist). */
  pageTitle(pageId: string): string | null;
  /** Where a page link points (`#`-less URL), or null to render it as text. */
  pageHref(pageId: string): string | null;
  /** URL of an attachment (a data URL in exports, an object URL in the print view). */
  assetUrl(assetId: string): string | null;
  /** Pre-rendered tables for database embeds, by database ID. */
  databases?: ReadonlyMap<string, string>;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

type Mark = { type: string; attrs?: Record<string, unknown> };

function str(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function colorClass(attrs: Record<string, unknown> | undefined): string {
  const color = str(attrs?.color);
  return color ? ` class="color-${escapeHtml(color)}"` : '';
}

function renderMarks(text: string, marks: readonly Mark[]): string {
  let html = escapeHtml(text);
  const ordered = [...marks].sort(
    (a, b) => (a.type === 'link' ? 1 : 0) - (b.type === 'link' ? 1 : 0),
  );
  for (const mark of ordered) {
    switch (mark.type) {
      case 'bold':
        html = `<strong>${html}</strong>`;
        break;
      case 'italic':
        html = `<em>${html}</em>`;
        break;
      case 'underline':
        html = `<u>${html}</u>`;
        break;
      case 'strike':
        html = `<s>${html}</s>`;
        break;
      case 'code':
        html = `<code>${html}</code>`;
        break;
      case 'highlight': {
        const color = str(mark.attrs?.color);
        html = `<mark${color ? ` class="highlight-${escapeHtml(color)}"` : ''}>${html}</mark>`;
        break;
      }
      case 'link': {
        const href = mark.attrs?.href;
        if (isSafeHref(href)) {
          const title = str(mark.attrs?.title);
          html = `<a href="${escapeHtml(href)}" rel="noopener noreferrer"${title ? ` title="${escapeHtml(title)}"` : ''}>${html}</a>`;
        }
        break;
      }
      default:
    }
  }
  return html;
}

function renderInline(
  nodes: readonly AnyNodeJSON[] | undefined,
  options: HtmlRenderOptions,
): string {
  return (nodes ?? [])
    .map((node) => {
      switch (node.type) {
        case 'text':
          return renderMarks(node.text ?? '', node.marks ?? []);
        case 'hardBreak':
          return '<br>';
        case 'tag':
          return `<span class="tag">#${escapeHtml(String(node.attrs?.name ?? ''))}</span>`;
        case 'pageLink': {
          const pageId = String(node.attrs?.pageId ?? '');
          const title =
            str(node.attrs?.label) ?? options.pageTitle(pageId) ?? options.labels.untitled;
          const href = options.pageHref(pageId);
          const text = escapeHtml(title || options.labels.untitled);
          return href
            ? `<a class="page-link" href="${escapeHtml(href)}" data-page-id="${escapeHtml(pageId)}">${text}</a>`
            : `<span class="page-link">${text}</span>`;
        }
        default:
          return '';
      }
    })
    .join('');
}

function formatSize(size: unknown): string {
  if (typeof size !== 'number' || size < 0) return '';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function renderBlocks(
  nodes: readonly AnyNodeJSON[] | undefined,
  options: HtmlRenderOptions,
): string {
  return (nodes ?? []).map((node) => renderBlock(node, options)).join('\n');
}

function renderListItem(node: AnyNodeJSON, options: HtmlRenderOptions, task: boolean): string {
  const [first, ...rest] = node.content ?? [];
  const checked = node.attrs?.checked === true;
  const body = `${first?.type === 'paragraph' ? renderInline(first.content, options) : renderBlock(first ?? { type: 'paragraph' }, options)}${rest.length ? `\n${renderBlocks(rest, options)}` : ''}`;
  if (!task) return `<li${colorClass(node.attrs)}>${body}</li>`;
  return `<li class="task${checked ? ' checked' : ''}"><span class="checkbox" aria-hidden="true">${checked ? '✓' : ''}</span><div>${body}</div></li>`;
}

function renderBlock(node: AnyNodeJSON, options: HtmlRenderOptions): string {
  const attrs = node.attrs ?? {};
  switch (node.type) {
    case 'paragraph':
      return `<p${colorClass(attrs)}>${renderInline(node.content, options) || '<br>'}</p>`;
    case 'heading': {
      const level = Math.min(
        4,
        Math.max(2, (typeof attrs.level === 'number' ? attrs.level : 1) + 1),
      );
      return `<h${level}${colorClass(attrs)}>${renderInline(node.content, options)}</h${level}>`;
    }
    case 'blockquote':
      return `<blockquote${colorClass(attrs)}>${renderBlocks(node.content, options)}</blockquote>`;
    case 'callout': {
      const tone = escapeHtml(str(attrs.tone) ?? 'default');
      const emoji = str(attrs.emoji);
      return `<aside class="callout tone-${tone}">${emoji ? `<span class="callout-icon" aria-hidden="true">${escapeHtml(emoji)}</span>` : ''}<div class="callout-body">${renderBlocks(node.content, options)}</div></aside>`;
    }
    case 'codeBlock': {
      const language = str(attrs.language);
      const code = (node.content ?? []).map((child) => child.text ?? '').join('');
      return `<pre${language ? ` data-language="${escapeHtml(language)}"` : ''}><code>${escapeHtml(code)}</code></pre>`;
    }
    case 'horizontalRule':
      return '<hr>';
    case 'image': {
      const assetId = str(attrs.assetId);
      // Asset URLs come from the renderer's caller (data or object URLs); sources from documents
      // must be safe.
      const documentSrc = str(attrs.src);
      const src = assetId
        ? options.assetUrl(assetId)
        : isSafeImageSrc(documentSrc)
          ? documentSrc
          : null;
      const alt = escapeHtml(str(attrs.alt) ?? '');
      const title = str(attrs.title);
      const width = typeof attrs.width === 'number' ? ` style="width:${attrs.width}%"` : '';
      if (!src) return alt ? `<p class="missing">${alt}</p>` : '';
      return `<figure><img src="${escapeHtml(src)}" alt="${alt}"${width}>${title ? `<figcaption>${escapeHtml(title)}</figcaption>` : ''}</figure>`;
    }
    case 'bulletList':
      return `<ul>${(node.content ?? []).map((item) => renderListItem(item, options, false)).join('')}</ul>`;
    case 'orderedList': {
      const start =
        typeof attrs.start === 'number' && attrs.start !== 1 ? ` start="${attrs.start}"` : '';
      return `<ol${start}>${(node.content ?? []).map((item) => renderListItem(item, options, false)).join('')}</ol>`;
    }
    case 'taskList':
      return `<ul class="tasks">${(node.content ?? []).map((item) => renderListItem(item, options, true)).join('')}</ul>`;
    case 'table': {
      const rows = (node.content ?? []).map((row) => {
        const cells = (row.content ?? []).map((cell) => {
          const tag = cell.type === 'tableHeader' ? 'th' : 'td';
          const span =
            typeof cell.attrs?.colspan === 'number' && cell.attrs.colspan > 1
              ? ` colspan="${cell.attrs.colspan}"`
              : '';
          const body = (cell.content ?? [])
            .map((paragraph) => renderInline(paragraph.content, options))
            .join('<br>');
          return `<${tag}${span}>${body}</${tag}>`;
        });
        return `<tr>${cells.join('')}</tr>`;
      });
      return `<div class="table"><table>${rows.join('')}</table></div>`;
    }
    case 'toggle': {
      const [summary, ...rest] = node.content ?? [];
      return `<details${attrs.open === true ? ' open' : ''}${colorClass(attrs)}><summary>${renderInline(summary?.content, options)}</summary>${renderBlocks(rest, options)}</details>`;
    }
    case 'embed': {
      const kind = str(attrs.kind) ?? '';
      const ref = str(attrs.ref);
      const data = (attrs.data && typeof attrs.data === 'object' ? attrs.data : {}) as Record<
        string,
        unknown
      >;
      if (kind === 'web' && ref && isSafeHref(ref)) {
        const title = str(data.title) ?? ref;
        return `<p class="bookmark"><a href="${escapeHtml(ref)}" rel="noopener noreferrer">${escapeHtml(title)}</a></p>`;
      }
      if (kind === 'file') {
        const name = str(data.name) ?? options.labels.untitled;
        const url = ref ? options.assetUrl(ref) : null;
        const label = `${escapeHtml(name)}${formatSize(data.size) ? ` <span class="size">${formatSize(data.size)}</span>` : ''}`;
        return url
          ? `<p class="file"><a href="${escapeHtml(url)}" download="${escapeHtml(name)}">📎 ${label}</a></p>`
          : `<p class="file">📎 ${label}</p>`;
      }
      if (kind === 'database' && ref) {
        const table = options.databases?.get(ref);
        if (table) return table;
        return `<p class="embed">${escapeHtml(options.labels.database)}: ${escapeHtml(options.pageTitle(ref) ?? options.labels.untitled)}</p>`;
      }
      return `<p class="embed">${escapeHtml(options.labels.needsPlugin)}</p>`;
    }
    default:
      return '';
  }
}

/** The stylesheet of exported and printed pages: calm, readable, light and dark, print-ready. */
export const PAGE_STYLES = `
:root{color-scheme:light dark;--bg:#fff;--fg:#1f2328;--muted:#656d76;--border:#e5e7eb;--subtle:#f6f8fa;--accent:#4f46e5;--mark:#fff3a3}
@media (prefers-color-scheme:dark){:root{--bg:#16171b;--fg:#e6e7ea;--muted:#9aa0aa;--border:#2c2e35;--subtle:#1f2127;--accent:#a5b4fc;--mark:#5c4d10}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.65 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;-webkit-font-smoothing:antialiased}
.page{max-width:720px;margin:0 auto;padding:64px 24px 96px}
.page-icon{font-size:48px;line-height:1}
.page-title{font-size:2.25rem;line-height:1.2;margin:.4em 0 .8em;font-weight:700;letter-spacing:-.01em}
h2{font-size:1.6rem;margin:1.6em 0 .4em;line-height:1.3}h3{font-size:1.3rem;margin:1.4em 0 .3em}h4{font-size:1.1rem;margin:1.2em 0 .2em}
p{margin:.35em 0}a{color:var(--accent)}
.page-link{color:var(--fg);text-decoration:underline;text-decoration-color:var(--border);text-underline-offset:3px;font-weight:500}
.tag{color:var(--accent);font-size:.92em}
code{font:.88em/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;background:var(--subtle);border:1px solid var(--border);border-radius:4px;padding:.1em .3em}
pre{background:var(--subtle);border:1px solid var(--border);border-radius:8px;padding:14px 16px;overflow:auto}pre code{background:none;border:0;padding:0}
blockquote{margin:.6em 0;padding:.1em 0 .1em 1em;border-left:3px solid var(--border);color:var(--muted)}
.callout{display:flex;gap:12px;margin:.8em 0;padding:14px 16px;border-radius:8px;background:var(--subtle);border:1px solid var(--border)}
.callout-icon{font-size:1.2em;line-height:1.4}.callout-body>:first-child{margin-top:0}.callout-body>:last-child{margin-bottom:0}
.tone-info{border-color:#93c5fd}.tone-success{border-color:#86efac}.tone-warning{border-color:#fcd34d}.tone-danger{border-color:#fca5a5}
mark{background:var(--mark);color:inherit;border-radius:2px;padding:0 .1em}
ul,ol{padding-left:1.6em;margin:.3em 0}ul.tasks{list-style:none;padding-left:.2em}
li.task{display:flex;gap:.6em;align-items:flex-start}li.task.checked>div{color:var(--muted);text-decoration:line-through}
.checkbox{flex:none;width:1.05em;height:1.05em;margin-top:.3em;border:1.5px solid var(--muted);border-radius:4px;font-size:.8em;line-height:1;text-align:center;color:var(--bg);background:var(--bg)}
li.checked .checkbox{background:var(--accent);border-color:var(--accent)}
figure{margin:1em 0}img{max-width:100%;height:auto;border-radius:6px}figcaption{color:var(--muted);font-size:.9em;margin-top:.3em;text-align:center}
.table{overflow-x:auto;margin:.8em 0}table{border-collapse:collapse;width:100%;font-size:.95em}th,td{border:1px solid var(--border);padding:6px 10px;text-align:left;vertical-align:top}th{background:var(--subtle);font-weight:600}
details{margin:.4em 0}summary{cursor:pointer;font-weight:500}details>:not(summary){margin-left:1.2em}
hr{border:0;border-top:1px solid var(--border);margin:1.6em 0}
.bookmark a,.file a{display:inline-block;padding:8px 12px;border:1px solid var(--border);border-radius:8px;text-decoration:none;color:var(--fg)}
.size,.embed,.missing{color:var(--muted)}
.color-gray{color:#6b7280}.color-brown{color:#92400e}.color-orange{color:#c2410c}.color-yellow{color:#a16207}.color-green{color:#15803d}.color-blue{color:#1d4ed8}.color-purple{color:#7e22ce}.color-pink{color:#be185d}.color-red{color:#b91c1c}
[class$="-background"]{border-radius:4px;padding:0 .2em}
.color-gray-background{background:#f3f4f6}.color-brown-background{background:#f5ede4}.color-orange-background{background:#ffedd5}.color-yellow-background{background:#fef9c3}.color-green-background{background:#dcfce7}.color-blue-background{background:#dbeafe}.color-purple-background{background:#f3e8ff}.color-pink-background{background:#fce7f3}.color-red-background{background:#fee2e2}
.highlight-red{background:#fecaca}.highlight-orange{background:#fed7aa}.highlight-yellow{background:#fef08a}.highlight-green{background:#bbf7d0}.highlight-blue{background:#bfdbfe}.highlight-purple{background:#e9d5ff}.highlight-pink{background:#fbcfe8}.highlight-gray{background:#e5e7eb}.highlight-brown{background:#e7d5c4}
@media (prefers-color-scheme:dark){[class^="highlight-"],[class*="-background"]{color:var(--bg)}}
@media print{:root{--bg:#fff;--fg:#000;--muted:#555;--border:#ccc;--subtle:#f4f4f4;--accent:#1d4ed8}.page{max-width:none;padding:0}a{color:inherit}pre,blockquote,.callout,table,figure,li{break-inside:avoid}h2,h3,h4{break-after:avoid}}
`.trim();

/** Renders a document as HTML (the article body only). Every piece of text is escaped. */
export function renderDocHtml(doc: DocJSON, options: HtmlRenderOptions): string {
  const header = `<header>${options.icon ? `<div class="page-icon" aria-hidden="true">${escapeHtml(options.icon)}</div>` : ''}<h1 class="page-title">${escapeHtml(options.title || options.labels.untitled)}</h1></header>`;
  return `<article class="page">${header}\n${renderBlocks(doc.content as AnyNodeJSON[], options)}\n</article>`;
}

/** A standalone HTML document: inline styles, no scripts, nothing loaded from elsewhere. */
export function renderStandaloneHtml(doc: DocJSON, options: HtmlRenderOptions): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="Tessera">
<title>${escapeHtml(options.title || options.labels.untitled)}</title>
<style>${PAGE_STYLES}</style>
</head>
<body>
${renderDocHtml(doc, options)}
</body>
</html>
`;
}

/** Renders the database embeds of a document as tables (visible rows, every column). */
export async function renderDatabaseTables(
  doc: DocJSON,
  context: Pick<ExportContext, 'loadDatabaseDoc' | 'workspace'>,
  labels: HtmlLabels,
): Promise<Map<string, string>> {
  const tables = new Map<string, string>();
  const snapshot = context.workspace.pages.getSnapshot();
  const ids = new Set<string>();
  const visit = (node: AnyNodeJSON) => {
    if (
      node.type === 'embed' &&
      node.attrs?.kind === 'database' &&
      typeof node.attrs.ref === 'string'
    )
      ids.add(node.attrs.ref);
    node.content?.forEach(visit);
  };
  (doc.content as AnyNodeJSON[]).forEach(visit);
  for (const id of ids) {
    const page = snapshot.get(id);
    if (page?.kind !== 'database') continue;
    const handle = await context.loadDatabaseDoc(id);
    try {
      const properties = listProperties(handle.doc).filter(
        (property) => property.type !== 'formula',
      );
      const rows = resolveRows(listRows(handle.doc), snapshot).filter((row) => !row.trashed);
      const head = properties.map((property) => `<th>${escapeHtml(property.name)}</th>`).join('');
      const body = rows
        .map((row) => {
          const cells = properties.map((property) => {
            const text =
              property.type === 'relation'
                ? ((getCellValue(row, property) as string[] | null) ?? [])
                    .map((pageId) => snapshot.get(pageId)?.title ?? '')
                    .join(', ')
                : formatCell(row, property, () => null);
            return `<td>${escapeHtml(text)}</td>`;
          });
          return `<tr>${cells.join('')}</tr>`;
        })
        .join('');
      tables.set(
        id,
        `<div class="table"><p><strong>${escapeHtml(page.title || labels.untitled)}</strong></p><table><tr>${head}</tr>${body}</table></div>`,
      );
    } finally {
      handle.release();
    }
  }
  return tables;
}

/** Exports one page as a standalone HTML file, with its images and database tables inside. */
export async function exportHtml(
  scope: ExportScope,
  context: ExportContext,
  sink: ExportSink,
  exporterId: string,
  labels: HtmlLabels,
): Promise<ExportResult> {
  const started = Date.now();
  const issues: TransferIssue[] = [];
  if (scope.kind === 'workspace') throw new Error('The HTML export writes one page');
  const page: PageMeta | undefined = context.workspace.getPage(scope.pageId);
  if (!page) throw new Error('This page no longer exists');
  const handle = await context.loadPageDoc(page.id);
  let doc: DocJSON;
  try {
    doc = readDocJSON(handle.doc);
  } finally {
    handle.release();
  }
  const assetUrls = new Map<string, string>();
  const visit = async (node: AnyNodeJSON) => {
    const assetId = node.type === 'image' ? str(node.attrs?.assetId) : null;
    if (assetId && !assetUrls.has(assetId)) {
      const blob = await context.assets.get(assetId);
      if (blob)
        assetUrls.set(
          assetId,
          `data:${blob.type || 'application/octet-stream'};base64,${toBase64(new Uint8Array(await blob.arrayBuffer()))}`,
        );
      else
        issues.push({
          severity: 'warning',
          code: 'missing-attachment',
          message: 'An image is missing from this workspace',
          pageId: page.id,
        });
    }
    for (const child of node.content ?? []) await visit(child);
  };
  for (const block of doc.content as AnyNodeJSON[]) await visit(block);
  const snapshot = context.workspace.pages.getSnapshot();
  const html = renderStandaloneHtml(doc, {
    title: page.title,
    ...(page.icon ? { icon: page.icon } : {}),
    labels,
    pageTitle: (id) => snapshot.get(id)?.title ?? null,
    pageHref: () => null,
    assetUrl: (id) => assetUrls.get(id) ?? null,
    databases: await renderDatabaseTables(doc, context, labels),
  });
  await sink.writeFile(`${fileNameFor(page.title)}.html`, html);
  return { exporterId, files: 1, issues, durationMs: Date.now() - started };
}
