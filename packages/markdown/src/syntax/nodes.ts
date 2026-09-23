import type { BlockContent, Literal, Parent, PhrasingContent } from 'mdast';

/**
 * Custom mdast nodes produced by the Tessera syntax extensions (and consumed by the serializer).
 */

/** `[[target#heading|alias]]` or, with `embed`, `![[target]]`. `value` is the raw text between the brackets. */
export interface WikiLink extends Literal {
  type: 'wikiLink';
  value: string;
  embed: boolean;
}

/** `#tag` (value without `#`). */
export interface TagNode extends Literal {
  type: 'tag';
  value: string;
}

/** `==highlighted==`. */
export interface Highlight extends Parent {
  type: 'highlight';
  children: PhrasingContent[];
}

/** `^block-id` at the end of a line (Obsidian block reference target). */
export interface BlockIdMarker extends Literal {
  type: 'blockId';
  value: string;
}

/** Serializer-only: the `[!type]` marker at the start of an Obsidian callout. */
export interface CalloutMarker extends Literal {
  type: 'calloutMarker';
  value: string;
}

/** Serializer-only: a toggle, written as `<details><summary>…</summary>…</details>`. */
export interface ToggleNode extends Parent {
  type: 'toggle';
  /** Extra attributes for the `<details>` tag, already escaped (for example ` open`). */
  attributes: string;
  summary: PhrasingContent[];
  children: BlockContent[];
}

declare module 'mdast' {
  interface PhrasingContentMap {
    wikiLink: WikiLink;
    tag: TagNode;
    highlight: Highlight;
    blockId: BlockIdMarker;
    calloutMarker: CalloutMarker;
  }
  interface RootContentMap {
    wikiLink: WikiLink;
    tag: TagNode;
    highlight: Highlight;
    blockId: BlockIdMarker;
    calloutMarker: CalloutMarker;
    toggle: ToggleNode;
  }
  interface BlockContentMap {
    toggle: ToggleNode;
  }
}

declare module 'micromark-util-types' {
  interface TokenTypeMap {
    wikiLink: 'wikiLink';
    wikiLinkEmbedMarker: 'wikiLinkEmbedMarker';
    wikiLinkMarker: 'wikiLinkMarker';
    wikiLinkValue: 'wikiLinkValue';
    tag: 'tag';
    tagMarker: 'tagMarker';
    tagName: 'tagName';
    highlight: 'highlight';
    highlightSequence: 'highlightSequence';
    highlightSequenceTemporary: 'highlightSequenceTemporary';
    highlightText: 'highlightText';
    blockId: 'blockId';
    blockIdMarker: 'blockIdMarker';
    blockIdValue: 'blockIdValue';
    blockIdSpace: 'blockIdSpace';
  }
}

declare module 'mdast-util-to-markdown' {
  interface ConstructNameMap {
    highlight: 'highlight';
    strikethrough: 'strikethrough';
    wikiLink: 'wikiLink';
    toggleSummary: 'toggleSummary';
  }
}
