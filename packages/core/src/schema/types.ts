import type { TagColor } from '../database/types';
import type { JsonValue } from '../json';

/**
 * Version of the canonical document schema. Additive, backward-compatible changes only: old
 * clients drop unknown node types and attributes when they edit a block (a y-prosemirror
 * behavior), so new block kinds must go through `embed`, never through new node types.
 */
export const DOC_SCHEMA_VERSION = 1;

/** Colors usable as text colors (the `TagColor` palette without `default`). */
export type TextColor = Exclude<TagColor, 'default'>;

/** Every text color, in palette order. */
export const TEXT_COLORS = [
  'gray',
  'brown',
  'orange',
  'yellow',
  'green',
  'blue',
  'purple',
  'pink',
  'red',
] as const satisfies readonly TextColor[];

/**
 * Block color (the block menu's "Color"): a text color (`'blue'`) or a background color
 * (`'blue-background'`). Null means default. Renderers map names to theme tokens.
 */
export type BlockColor = TextColor | `${TextColor}-background`;

/** Every block color. */
export const BLOCK_COLORS: readonly BlockColor[] = [
  ...TEXT_COLORS,
  ...TEXT_COLORS.map((color) => `${color}-background` as const),
];

/** Highlight mark colors. Null means the default highlight (yellow). */
export type HighlightColor = TextColor;

/** Callout tones (background and accent of the callout). */
export const CALLOUT_TONES = ['default', 'info', 'success', 'warning', 'danger'] as const;
export type CalloutTone = (typeof CALLOUT_TONES)[number];

/** Heading levels. */
export type HeadingLevel = 1 | 2 | 3;

// ---------------------------------------------------------------------------------------------
// Marks
// ---------------------------------------------------------------------------------------------

export interface BoldMarkJSON {
  type: 'bold';
}
export interface ItalicMarkJSON {
  type: 'italic';
}
export interface UnderlineMarkJSON {
  type: 'underline';
}
export interface StrikeMarkJSON {
  type: 'strike';
}
/** Inline code. Excludes every other mark. */
export interface CodeMarkJSON {
  type: 'code';
}
/** A hyperlink. `href` must be `http(s):`, `mailto:`, `tel:`, a relative path or a `#fragment`. */
export interface LinkMarkJSON {
  type: 'link';
  attrs: { href: string; title?: string | null };
}
export interface HighlightMarkJSON {
  type: 'highlight';
  attrs?: { color?: HighlightColor | null };
}

export type MarkJSON =
  | BoldMarkJSON
  | ItalicMarkJSON
  | UnderlineMarkJSON
  | StrikeMarkJSON
  | CodeMarkJSON
  | LinkMarkJSON
  | HighlightMarkJSON;

export type MarkName = MarkJSON['type'];

// ---------------------------------------------------------------------------------------------
// Inline nodes
// ---------------------------------------------------------------------------------------------

/** Text. Never empty. */
export interface TextJSON {
  type: 'text';
  text: string;
  marks?: MarkJSON[];
}

/** A line break inside a block (Shift+Enter). */
export interface HardBreakJSON {
  type: 'hardBreak';
}

/**
 * A link to another page (`[[wikilink]]` / `@mention`). Stores only the target ID; renderers show
 * the target's *current* title, so renames propagate. `label` overrides the shown text
 * (`[[Page|label]]`); `heading` and `blockRef` point inside the target (`[[Page#Heading]]`,
 * `[[Page^block-id]]`).
 */
export interface PageLinkJSON {
  type: 'pageLink';
  attrs: {
    pageId: string;
    label?: string | null;
    /** Heading text in the target page (matched case-insensitively). */
    heading?: string | null;
    /** `blockId` of a block in the target page. */
    blockRef?: string | null;
  };
}

/** An inline `#tag`. `name` has no `#`; see `isValidTagName`. */
export interface TagJSON {
  type: 'tag';
  attrs: { name: string };
}

export type InlineJSON = TextJSON | HardBreakJSON | PageLinkJSON | TagJSON;

// ---------------------------------------------------------------------------------------------
// Block nodes
// ---------------------------------------------------------------------------------------------

/**
 * `blockId`: optional stable ID (pattern `BLOCK_ID_PATTERN`), assigned lazily when something
 * references the block (block links, `^block` refs). Never copied: splitting, duplicating or
 * pasting a block must clear it.
 */
export interface BlockIdAttrs {
  blockId?: string | null;
}

export interface ColorAttrs extends BlockIdAttrs {
  color?: BlockColor | null;
}

export interface ParagraphJSON {
  type: 'paragraph';
  attrs?: ColorAttrs;
  content?: InlineJSON[];
}

export interface HeadingJSON {
  type: 'heading';
  attrs?: ColorAttrs & { level?: HeadingLevel };
  content?: InlineJSON[];
}

export interface BlockquoteJSON {
  type: 'blockquote';
  attrs?: ColorAttrs;
  content: BlockJSON[];
}

export interface CalloutJSON {
  type: 'callout';
  attrs?: BlockIdAttrs & { emoji?: string | null; tone?: CalloutTone };
  content: BlockJSON[];
}

/** Code. Content is unmarked text only; line breaks are `\n` inside the text. */
export interface CodeBlockJSON {
  type: 'codeBlock';
  attrs?: BlockIdAttrs & { language?: string | null };
  content?: TextJSON[];
}

export interface HorizontalRuleJSON {
  type: 'horizontalRule';
}

/**
 * An image: `assetId` (from the `AssetStore`, preferred) or `src` (an `https:` URL). `title` is the
 * caption shown under the image (markdown `![alt](src "title")`). `width` is a percentage of the
 * content width (10–100), or null for the natural size.
 */
export interface ImageJSON {
  type: 'image';
  attrs: BlockIdAttrs & {
    assetId?: string | null;
    src?: string | null;
    alt?: string | null;
    title?: string | null;
    width?: number | null;
  };
}

export interface BulletListJSON {
  type: 'bulletList';
  content: ListItemJSON[];
}

export interface OrderedListJSON {
  type: 'orderedList';
  attrs?: { start?: number };
  content: ListItemJSON[];
}

/** A list item. The first child is always a paragraph; nested lists and other blocks follow. */
export interface ListItemJSON {
  type: 'listItem';
  attrs?: ColorAttrs;
  content: BlockJSON[];
}

export interface TaskListJSON {
  type: 'taskList';
  content: TaskItemJSON[];
}

/** A task. The first child is always a paragraph (the task text); subtasks and blocks follow. */
export interface TaskItemJSON {
  type: 'taskItem';
  attrs?: ColorAttrs & { checked?: boolean };
  content: BlockJSON[];
}

/** A table: rows of cells; each cell holds paragraphs only (so tables map to GFM markdown). */
export interface TableJSON {
  type: 'table';
  attrs?: BlockIdAttrs;
  content: TableRowJSON[];
}

export interface TableRowJSON {
  type: 'tableRow';
  content?: TableCellJSON[];
}

/** A body cell or a header cell (a header row is a first row of `tableHeader` cells). */
export interface TableCellJSON {
  type: 'tableCell' | 'tableHeader';
  attrs?: { colspan?: number; rowspan?: number; colwidth?: number[] | null };
  content: ParagraphJSON[];
}

/** A toggle: a summary line, then the blocks it hides. */
export interface ToggleJSON {
  type: 'toggle';
  attrs?: ColorAttrs & { open?: boolean };
  content: Array<ToggleSummaryJSON | BlockJSON>;
}

export interface ToggleSummaryJSON {
  type: 'toggleSummary';
  content?: InlineJSON[];
}

/**
 * The generic extension block. `kind` selects the renderer from the `BlockRendererRegistry`:
 * - `database`: `ref` = database ID, `data` = `{ viewId }` (an inline database or linked view);
 * - `web`: `ref` = URL, `data` = {@link WebEmbedData} (video, design, bookmark card, …);
 * - `file`: `ref` = asset ID, `data` = {@link FileEmbedData};
 * - `plugin:<pluginId>/<blockType>`: `data` = the plugin's JSON.
 * Unknown kinds render a "needs a plugin" placeholder and are preserved.
 */
export interface EmbedJSON {
  type: 'embed';
  attrs: BlockIdAttrs & { kind: string; ref?: string | null; data?: JsonValue | null };
}

export type BlockJSON =
  | ParagraphJSON
  | HeadingJSON
  | BlockquoteJSON
  | CalloutJSON
  | CodeBlockJSON
  | HorizontalRuleJSON
  | ImageJSON
  | BulletListJSON
  | OrderedListJSON
  | TaskListJSON
  | TableJSON
  | ToggleJSON
  | EmbedJSON;

/**
 * ProseMirror JSON for the canonical schema. Produced by `readDocJSON` (normalized: every
 * attribute present), `normalizeDocJSON`, the markdown codec and the editor's `getJSON()`.
 * Never depend on the order of marks or attribute keys; compare with `docJSONEqual`.
 */
export interface DocJSON {
  type: 'doc';
  content: BlockJSON[];
}

/** Every node JSON type. */
export type NodeJSON =
  | DocJSON
  | BlockJSON
  | InlineJSON
  | ListItemJSON
  | TaskItemJSON
  | TableRowJSON
  | TableCellJSON
  | ToggleSummaryJSON;

export type NodeName = NodeJSON['type'];

/** Loose node shape for generic traversal and for untrusted input. */
export interface AnyNodeJSON {
  type: string;
  attrs?: Record<string, unknown>;
  content?: AnyNodeJSON[];
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
  text?: string;
}

// ---------------------------------------------------------------------------------------------
// Embed data
// ---------------------------------------------------------------------------------------------

/** Data of an `embed` with `kind: 'database'`. */
export interface DatabaseEmbedData {
  /** View to show; null shows the database's first view. */
  viewId: string | null;
  [key: string]: JsonValue;
}

/** Data of an `embed` with `kind: 'web'`. */
export interface WebEmbedData {
  /** `embed` renders the page (YouTube, Figma, …) in a sandboxed iframe; `bookmark` renders a link card. */
  display: 'embed' | 'bookmark';
  title?: string;
  description?: string;
  /** Preview image URL (bookmark cards). */
  image?: string;
  siteName?: string;
  /** Iframe height in CSS pixels. */
  height?: number;
  [key: string]: JsonValue | undefined;
}

/** Data of an `embed` with `kind: 'file'` (an attachment). */
export interface FileEmbedData {
  name: string;
  size?: number;
  mimeType?: string;
  [key: string]: JsonValue | undefined;
}
