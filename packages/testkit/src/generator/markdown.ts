/**
 * Exports a generated workspace as a markdown folder, the way an Obsidian vault looks: one `.md`
 * file per page (children in a folder named after their parent), YAML frontmatter with `tags` and
 * `aliases`, `[[wikilinks]]`, `#tags`, tasks, pipe tables, callouts, and one CSV file per
 * database. Trashed pages are left out. The importers (Agent 08) and the import benchmark read it.
 */
import type {
  BlockJSON,
  DocJSON,
  InlineJSON,
  JsonValue,
  ListItemJSON,
  MarkJSON,
  PropertyType,
  TaskItemJSON,
} from '@tessera/core';
import type { WorkspacePlan } from './plan';
import type { DatabasePlan, GeneratedFile, PagePlan, PropertyPlan } from './types';

/** Serializes DocJSON to markdown. `titleOf` resolves page links to page titles. */
export function docToMarkdown(
  doc: DocJSON,
  titleOf: (pageId: string) => string | undefined,
): string {
  return `${blocksToMarkdown(doc.content ?? [], titleOf).join('\n\n')}\n`;
}

function applyMarks(text: string, marks: readonly MarkJSON[] | undefined): string {
  let result = text;
  for (const mark of marks ?? []) {
    switch (mark.type) {
      case 'bold':
        result = `**${result}**`;
        break;
      case 'italic':
        result = `*${result}*`;
        break;
      case 'code':
        result = `\`${result}\``;
        break;
      case 'strike':
        result = `~~${result}~~`;
        break;
      case 'underline':
        result = `<u>${result}</u>`;
        break;
      case 'highlight':
        result = `==${result}==`;
        break;
      case 'link':
        result = `[${result}](${String(mark.attrs?.href ?? '')})`;
        break;
    }
  }
  return result;
}

function inlineToMarkdown(
  nodes: readonly InlineJSON[] | undefined,
  titleOf: (id: string) => string | undefined,
): string {
  return (nodes ?? [])
    .map((node) => {
      switch (node.type) {
        case 'text':
          return applyMarks(node.text, node.marks);
        case 'pageLink': {
          const title = titleOf(node.attrs.pageId) ?? 'Untitled';
          return node.attrs.label ? `[[${title}|${node.attrs.label}]]` : `[[${title}]]`;
        }
        case 'tag':
          return `#${node.attrs.name ?? ''}`;
        case 'hardBreak':
          return '  \n';
        default:
          return '';
      }
    })
    .join('');
}

function indent(text: string, prefix: string): string {
  return text
    .split('\n')
    .map((line) => (line ? `${prefix}${line}` : prefix.trimEnd()))
    .join('\n');
}

function listItems(
  items: ReadonlyArray<ListItemJSON | TaskItemJSON>,
  marker: (index: number, item: ListItemJSON | TaskItemJSON) => string,
  titleOf: (id: string) => string | undefined,
): string {
  return items
    .map((item, index) => {
      const [first, ...rest] = blocksToMarkdown(item.content, titleOf);
      const head = `${marker(index, item)}${first ?? ''}`;
      return rest.length ? `${head}\n${indent(rest.join('\n'), '    ')}` : head;
    })
    .join('\n');
}

function blocksToMarkdown(
  blocks: readonly BlockJSON[],
  titleOf: (id: string) => string | undefined,
): string[] {
  return blocks.map((block): string => {
    switch (block.type) {
      case 'paragraph':
        return inlineToMarkdown(block.content, titleOf);
      case 'heading':
        return `${'#'.repeat(block.attrs?.level ?? 1)} ${inlineToMarkdown(block.content, titleOf)}`;
      case 'blockquote':
        return indent(blocksToMarkdown(block.content, titleOf).join('\n\n'), '> ');
      case 'callout': {
        const tone =
          block.attrs?.tone && block.attrs.tone !== 'default' ? block.attrs.tone : 'note';
        const body = blocksToMarkdown(block.content, titleOf).join('\n\n');
        return indent(`[!${tone}] ${block.attrs?.emoji ?? ''}\n${body}`.trim(), '> ');
      }
      case 'toggle': {
        const [summary, ...body] = block.content;
        const title =
          summary?.type === 'toggleSummary' ? inlineToMarkdown(summary.content, titleOf) : '';
        const inner = blocksToMarkdown(body as BlockJSON[], titleOf).join('\n\n');
        return indent(`[!note]- ${title}${inner ? `\n${inner}` : ''}`, '> ');
      }
      case 'codeBlock':
        return `\`\`\`${block.attrs?.language ?? ''}\n${inlineToMarkdown(block.content, titleOf)}\n\`\`\``;
      case 'horizontalRule':
        return '---';
      case 'bulletList':
        return listItems(block.content, () => '- ', titleOf);
      case 'orderedList': {
        const start = block.attrs?.start ?? 1;
        return listItems(block.content, (index) => `${start + index}. `, titleOf);
      }
      case 'taskList':
        return listItems(
          block.content,
          (_, item) => `- [${item.type === 'taskItem' && item.attrs?.checked ? 'x' : ' '}] `,
          titleOf,
        );
      case 'table': {
        const rows = block.content.map((row) =>
          (row.content ?? []).map((cell) =>
            blocksToMarkdown(cell.content, titleOf)
              .join(' ')
              .replace(/\|/g, '\\|')
              .replace(/\n/g, ' '),
          ),
        );
        const width = Math.max(...rows.map((row) => row.length));
        const line = (cells: string[]) =>
          `| ${Array.from({ length: width }, (_, i) => cells[i] ?? '').join(' | ')} |`;
        const [header = [], ...body] = rows;
        return [
          line(header),
          `| ${Array.from({ length: width }, () => '---').join(' | ')} |`,
          ...body.map(line),
        ].join('\n');
      }
      case 'embed':
        if (block.attrs.kind === 'database' && block.attrs.ref) {
          const title = titleOf(block.attrs.ref);
          return title ? `![[${title}.csv]]` : '';
        }
        return block.attrs.ref ? `<${block.attrs.ref}>` : '';
      case 'image':
        return block.attrs?.src ? `![${block.attrs.alt ?? ''}](${block.attrs.src})` : '';
      default:
        return '';
    }
  });
}

/** Quotes a string for YAML when needed (JSON strings are valid YAML). */
function yamlString(value: string): string {
  return /^[\w][\w /.-]*$/.test(value) && !/^(?:true|false|null|yes|no)$/i.test(value)
    ? value
    : JSON.stringify(value);
}

/** YAML frontmatter with the page's tags and aliases (empty when it has neither). */
export function frontmatter(page: PagePlan): string {
  const lines: string[] = [];
  if (page.tags.length) lines.push(`tags: [${page.tags.map(yamlString).join(', ')}]`);
  if (page.aliases.length) lines.push(`aliases: [${page.aliases.map(yamlString).join(', ')}]`);
  return lines.length ? `---\n${lines.join('\n')}\n---\n\n` : '';
}

/** A CSV field (RFC 4180). */
function csvField(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function formatValue(
  property: PropertyPlan,
  value: JsonValue | undefined,
  row: PagePlan | undefined,
  titleOf: (id: string) => string | undefined,
): string {
  const type: PropertyType = property.type;
  if (type === 'title') return row?.title ?? '';
  if (type === 'createdTime') return row ? new Date(row.createdAt).toISOString() : '';
  if (type === 'updatedTime') return row ? new Date(row.updatedAt).toISOString() : '';
  if (value === undefined || value === null) return '';
  const optionName = (id: unknown) =>
    property.options?.find((option) => option.id === id)?.name ?? '';
  switch (type) {
    case 'select':
      return optionName(value);
    case 'multiSelect':
      return Array.isArray(value) ? value.map(optionName).join(', ') : '';
    case 'relation':
      return Array.isArray(value) ? value.map((id) => titleOf(String(id)) ?? '').join(', ') : '';
    case 'checkbox':
      return value === true ? 'Yes' : 'No';
    case 'number':
      return property.number?.format === 'percent' && typeof value === 'number'
        ? `${Math.round(value * 100)}%`
        : String(value);
    case 'date': {
      if (typeof value !== 'object' || Array.isArray(value)) return '';
      const start = String(value.start ?? '');
      return value.end ? `${start}/${String(value.end)}` : start;
    }
    default:
      return typeof value === 'string' ? value : JSON.stringify(value);
  }
}

/** The CSV of a database: a header of property names, then one line per row. */
export function databaseToCsv(
  database: DatabasePlan,
  rowPages: ReadonlyMap<string, PagePlan>,
  titleOf: (id: string) => string | undefined,
): string {
  const header = database.properties.map((property) => csvField(property.name)).join(',');
  const lines = database.rows.map((row) =>
    database.properties
      .map((property) =>
        csvField(formatValue(property, row.values[property.id], rowPages.get(row.id), titleOf)),
      )
      .join(','),
  );
  return `${[header, ...lines].join('\n')}\n`;
}

/** Every file of the markdown export, sorted by path. */
export function workspaceToMarkdown(
  plan: WorkspacePlan,
  contentOf: (page: PagePlan) => DocJSON | null,
): GeneratedFile[] {
  const titleOf = (id: string) => plan.byId.get(id)?.title;
  const folderOf = new Map<string, string>();
  const prefix = plan.options.folder ? `${plan.options.folder}/` : '';
  const files: GeneratedFile[] = [];
  for (const page of plan.pages) {
    if (page.role === 'row' || plan.trashedIds.has(page.id)) continue;
    const parentFolder = page.parentId ? (folderOf.get(page.parentId) ?? '') : prefix;
    folderOf.set(page.id, `${parentFolder}${page.title}/`);
    if (page.role === 'database') {
      const database = plan.databases.find((candidate) => candidate.id === page.id);
      if (database) {
        files.push({
          path: `${parentFolder}${page.title}.csv`,
          content: databaseToCsv(database, plan.byId, titleOf),
        });
      }
      continue;
    }
    const content = contentOf(page);
    files.push({
      path: `${parentFolder}${page.title}.md`,
      content: `${frontmatter(page)}${content ? docToMarkdown(content, titleOf) : ''}`,
    });
  }
  return files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}
