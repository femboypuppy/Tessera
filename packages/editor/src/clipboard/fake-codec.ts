import {
  normalizeDocJSON,
  type AnyNodeJSON,
  type DocJSON,
  type MarkdownCodec,
  type MarkdownParseOptions,
  type MarkdownSerializeOptions,
} from '@tessera/core';

/**
 * A small but richer markdown codec for tests: headings, paragraphs, bold, italic, code, links,
 * `[[wikilinks]]`, bullet, numbered and task lists, quotes and fenced code. It stands in for the
 * remark codec (Agent 08) to prove that paste and copy go through the `MarkdownCodec` contract.
 * Test-only: the app uses whatever codec the workspace resolves.
 */
export class FakeRichCodec implements MarkdownCodec {
  parse(markdown: string, options: MarkdownParseOptions = {}) {
    const content: AnyNodeJSON[] = [];
    const lines = markdown.replace(/\r\n/g, '\n').split('\n');
    let list: AnyNodeJSON | null = null;
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index] ?? '';
      if (line.startsWith('```')) {
        const language = line.slice(3).trim() || null;
        const code: string[] = [];
        index += 1;
        while (index < lines.length && !(lines[index] ?? '').startsWith('```')) {
          code.push(lines[index] ?? '');
          index += 1;
        }
        list = null;
        content.push({
          type: 'codeBlock',
          attrs: { language },
          content: code.length ? [{ type: 'text', text: code.join('\n') }] : [],
        });
        continue;
      }
      const task = /^[-*] \[( |x)\] (.*)$/.exec(line);
      const bullet = /^[-*] (.*)$/.exec(line);
      const ordered = /^\d+\. (.*)$/.exec(line);
      const heading = /^(#{1,3}) (.*)$/.exec(line);
      const quote = /^> ?(.*)$/.exec(line);
      const item = (type: string, text: string, attrs?: Record<string, unknown>) => {
        const listType =
          type === 'taskItem' ? 'taskList' : type === 'orderedItem' ? 'orderedList' : 'bulletList';
        const node: AnyNodeJSON = {
          type: type === 'taskItem' ? 'taskItem' : 'listItem',
          ...(attrs ? { attrs } : {}),
          content: [{ type: 'paragraph', content: this.inline(text, options) }],
        };
        if (list?.type !== listType) {
          list = { type: listType, content: [] };
          content.push(list);
        }
        list.content?.push(node);
      };
      if (task) item('taskItem', task[2] ?? '', { checked: task[1] === 'x' });
      else if (bullet) item('listItem', bullet[1] ?? '');
      else if (ordered) item('orderedItem', ordered[1] ?? '');
      else {
        list = null;
        if (!line.trim()) continue;
        if (heading)
          content.push({
            type: 'heading',
            attrs: { level: heading[1]?.length ?? 1 },
            content: this.inline(heading[2] ?? '', options),
          });
        else if (quote)
          content.push({
            type: 'blockquote',
            content: [{ type: 'paragraph', content: this.inline(quote[1] ?? '', options) }],
          });
        else content.push({ type: 'paragraph', content: this.inline(line, options) });
      }
    }
    return { doc: normalizeDocJSON({ type: 'doc', content }), frontmatter: {}, warnings: [] };
  }

  private inline(text: string, options: MarkdownParseOptions): AnyNodeJSON[] {
    const nodes: AnyNodeJSON[] = [];
    const pattern =
      /\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`|\[\[([^\]]+)\]\]|\[([^\]]+)\]\(([^)]+)\)/g;
    let last = 0;
    for (const match of text.matchAll(pattern)) {
      if (match.index > last) nodes.push({ type: 'text', text: text.slice(last, match.index) });
      if (match[1]) nodes.push({ type: 'text', text: match[1], marks: [{ type: 'bold' }] });
      else if (match[2]) nodes.push({ type: 'text', text: match[2], marks: [{ type: 'italic' }] });
      else if (match[3]) nodes.push({ type: 'text', text: match[3], marks: [{ type: 'code' }] });
      else if (match[4]) {
        const pageId = options.resolvePageLink?.(match[4]);
        nodes.push(
          pageId ? { type: 'pageLink', attrs: { pageId } } : { type: 'text', text: match[0] },
        );
      } else if (match[5] && match[6])
        nodes.push({
          type: 'text',
          text: match[5],
          marks: [{ type: 'link', attrs: { href: match[6] } }],
        });
      last = match.index + match[0].length;
    }
    if (last < text.length) nodes.push({ type: 'text', text: text.slice(last) });
    return nodes;
  }

  serialize(doc: DocJSON, options: MarkdownSerializeOptions = {}): string {
    const inline = (nodes: AnyNodeJSON[] = []): string =>
      nodes
        .map((node) => {
          if (node.type === 'pageLink') {
            const title = options.resolvePage?.(String(node.attrs?.pageId))?.title ?? '';
            return `[[${title}]]`;
          }
          if (node.type === 'tag') return `#${String(node.attrs?.name)}`;
          let text = node.text ?? '';
          for (const mark of node.marks ?? []) {
            if (mark.type === 'bold') text = `**${text}**`;
            if (mark.type === 'italic') text = `*${text}*`;
            if (mark.type === 'code') text = `\`${text}\``;
          }
          return text;
        })
        .join('');
    const block = (node: AnyNodeJSON): string => {
      switch (node.type) {
        case 'heading':
          return `${'#'.repeat(Number(node.attrs?.level ?? 1))} ${inline(node.content)}`;
        case 'bulletList':
        case 'orderedList':
        case 'taskList':
          return (node.content ?? [])
            .map((item, index) => {
              const marker =
                node.type === 'orderedList'
                  ? `${index + 1}.`
                  : node.type === 'taskList'
                    ? `- [${item.attrs?.checked ? 'x' : ' '}]`
                    : '-';
              return `${marker} ${inline(item.content?.[0]?.content)}`;
            })
            .join('\n');
        case 'codeBlock':
          return `\`\`\`${String(node.attrs?.language ?? '')}\n${inline(node.content)}\n\`\`\``;
        case 'blockquote':
          return (node.content ?? []).map((child) => `> ${block(child)}`).join('\n');
        default:
          return inline(node.content);
      }
    };
    return `${doc.content.map((node) => block(node as AnyNodeJSON)).join('\n\n')}\n`;
  }

  parseHTML(html: string): DocJSON {
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    const inline = (element: Element): AnyNodeJSON[] => {
      const nodes: AnyNodeJSON[] = [];
      const visit = (
        node: Node,
        marks: Array<{ type: string; attrs?: Record<string, unknown> }>,
      ) => {
        if (node.nodeType === Node.TEXT_NODE) {
          if (node.textContent) nodes.push({ type: 'text', text: node.textContent, marks });
          return;
        }
        if (!(node instanceof Element)) return;
        const next = [...marks];
        if (/^(B|STRONG)$/.test(node.tagName)) next.push({ type: 'bold' });
        if (/^(I|EM)$/.test(node.tagName)) next.push({ type: 'italic' });
        if (node.tagName === 'A' && node.getAttribute('href'))
          next.push({ type: 'link', attrs: { href: node.getAttribute('href') } });
        node.childNodes.forEach((child) => visit(child, next));
      };
      element.childNodes.forEach((child) => visit(child, []));
      return nodes;
    };
    const content: AnyNodeJSON[] = [];
    parsed.body.querySelectorAll(':scope > *').forEach((element) => {
      const tag = element.tagName;
      if (/^H[1-6]$/.test(tag))
        content.push({
          type: 'heading',
          attrs: { level: Math.min(3, Number(tag[1])) },
          content: inline(element),
        });
      else if (tag === 'UL' || tag === 'OL')
        content.push({
          type: tag === 'UL' ? 'bulletList' : 'orderedList',
          content: [...element.querySelectorAll(':scope > li')].map((li) => ({
            type: 'listItem',
            content: [{ type: 'paragraph', content: inline(li) }],
          })),
        });
      else if (tag === 'BLOCKQUOTE')
        content.push({
          type: 'blockquote',
          content: [{ type: 'paragraph', content: inline(element) }],
        });
      else if (tag === 'PRE')
        content.push({
          type: 'codeBlock',
          content: [{ type: 'text', text: element.textContent ?? '' }],
        });
      else content.push({ type: 'paragraph', content: inline(element) });
    });
    return normalizeDocJSON({ type: 'doc', content });
  }
}
