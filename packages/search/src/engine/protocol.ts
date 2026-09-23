import type { LinkEdge } from '@tessera/core';
import type { ChangeSummary, StaleSet } from './index-core';
import type {
  GraphSnapshot,
  MentionSource,
  PageMetaLite,
  QueryRequest,
  QueryResponse,
  RichMention,
  RichBacklink,
  RichOutgoingLink,
  TagCount,
  TagPair,
} from './types';

/** Content of one page doc, as a Yjs update (null when the doc was never stored). */
export interface ContentItem {
  pageId: string;
  bytes: Uint8Array | null;
  fingerprint: number;
}

/** Content of one database doc (for row values). */
export interface DatabaseItem {
  databaseId: string;
  bytes: Uint8Array | null;
  fingerprint: number;
}

/** Messages the main thread sends to the index worker. Processed strictly in order. */
export type IndexRequest =
  | { type: 'init'; workspaceId: string; persist: boolean }
  | { type: 'meta'; upserts: PageMetaLite[]; removes: string[]; full: boolean }
  | { type: 'content'; items: ContentItem[] }
  | { type: 'database'; items: DatabaseItem[] }
  | { type: 'remove'; pageIds: string[] }
  | { type: 'clear' }
  | { type: 'query'; request: QueryRequest }
  | { type: 'backlinks'; pageId: string }
  | { type: 'outgoing'; pageId: string }
  | { type: 'edges' }
  | { type: 'mentionCandidates'; pageId: string }
  | { type: 'mentions'; pageId: string; sources: MentionSource[] }
  | { type: 'orphans' }
  | { type: 'tags' }
  | { type: 'tagCooccurrence' }
  | { type: 'graph' }
  | { type: 'neighborhood'; pageId: string; depth: number }
  | { type: 'flush' }
  | { type: 'ping' };

export type IndexRequestType = IndexRequest['type'];

/** What each request resolves to. */
export interface IndexResults {
  init: { restored: boolean; documents: number };
  meta: StaleSet;
  content: null;
  database: null;
  remove: null;
  clear: null;
  query: QueryResponse;
  backlinks: RichBacklink[];
  outgoing: RichOutgoingLink[];
  edges: LinkEdge[];
  mentionCandidates: string[];
  mentions: RichMention[];
  orphans: string[];
  tags: TagCount[];
  tagCooccurrence: TagPair[];
  graph: GraphSnapshot;
  neighborhood: GraphSnapshot;
  flush: null;
  ping: null;
}

/** A request envelope (main → worker). */
export interface RequestEnvelope {
  id: number;
  request: IndexRequest;
}

/** Messages the worker sends back. */
export type WorkerMessage =
  | { type: 'response'; id: number; result: unknown }
  | { type: 'error'; id: number; message: string }
  | { type: 'changed'; change: ChangeSummary };

/** Narrows an unknown message from the worker (the boundary between threads). */
export function isWorkerMessage(value: unknown): value is WorkerMessage {
  if (typeof value !== 'object' || value === null) return false;
  const message = value as { type?: unknown; id?: unknown };
  if (message.type === 'changed') return true;
  return (
    (message.type === 'response' || message.type === 'error') && typeof message.id === 'number'
  );
}
