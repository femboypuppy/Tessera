import type { ChangeSummary } from './index-core';
import type { IndexPersistence } from './persistence';
import {
  isWorkerMessage,
  type IndexRequest,
  type IndexRequestType,
  type IndexResults,
  type RequestEnvelope,
} from './protocol';
import { IndexRuntime } from './runtime';

/** How the main thread talks to the index: a Web Worker, or the same code in-process. */
export interface IndexTransport {
  readonly kind: 'worker' | 'in-process';
  request<T extends IndexRequestType>(
    request: Extract<IndexRequest, { type: T }>,
    transfer?: Transferable[],
  ): Promise<IndexResults[T]>;
  onChange(listener: (change: ChangeSummary) => void): () => void;
  terminate(): void;
}

/**
 * Runs the index on the calling thread (tests, and browsers where the worker cannot start).
 * Results are structured-cloned like worker messages, so callers never share the index's objects.
 */
export class InProcessTransport implements IndexTransport {
  readonly kind = 'in-process';
  private readonly listeners = new Set<(change: ChangeSummary) => void>();
  private readonly runtime: IndexRuntime;

  constructor(
    options: {
      persistence?: IndexPersistence | null;
      now?: () => number;
      saveDelayMs?: number;
    } = {},
  ) {
    this.runtime = new IndexRuntime({
      persistence: options.persistence ?? null,
      now: options.now,
      saveDelayMs: options.saveDelayMs,
      notify: (change) => {
        for (const listener of [...this.listeners]) listener(change);
      },
      onError: (error) => console.warn('[search] index error', error),
    });
  }

  async request<T extends IndexRequestType>(
    request: Extract<IndexRequest, { type: T }>,
  ): Promise<IndexResults[T]> {
    const result = await this.runtime.handle(request);
    return structuredClone(result);
  }

  onChange(listener: (change: ChangeSummary) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  terminate(): void {
    this.runtime.dispose();
    this.listeners.clear();
  }
}

interface Pending {
  resolve(value: unknown): void;
  reject(error: Error): void;
}

/** Talks to the index worker with numbered request/response messages. */
export class WorkerTransport implements IndexTransport {
  readonly kind = 'worker';
  private readonly pending = new Map<number, Pending>();
  private readonly listeners = new Set<(change: ChangeSummary) => void>();
  private nextId = 1;
  private failure: Error | null = null;

  constructor(private readonly worker: Worker) {
    worker.onmessage = (event: MessageEvent<unknown>) => {
      const message = event.data;
      if (!isWorkerMessage(message)) return;
      if (message.type === 'changed') {
        for (const listener of [...this.listeners]) listener(message.change);
        return;
      }
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.type === 'response') pending.resolve(message.result);
      else pending.reject(new Error(message.message));
    };
    worker.onerror = (event) => {
      event.preventDefault();
      this.fail(new Error(event.message || 'The search worker failed'));
    };
    worker.onmessageerror = () =>
      this.fail(new Error('The search worker sent an unreadable message'));
  }

  private fail(error: Error): void {
    this.failure = error;
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }

  request<T extends IndexRequestType>(
    request: Extract<IndexRequest, { type: T }>,
    transfer: Transferable[] = [],
  ): Promise<IndexResults[T]> {
    if (this.failure) return Promise.reject(this.failure);
    const id = this.nextId;
    this.nextId += 1;
    return new Promise<IndexResults[T]>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
      const envelope: RequestEnvelope = { id, request };
      this.worker.postMessage(envelope, transfer);
    });
  }

  onChange(listener: (change: ChangeSummary) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  terminate(): void {
    this.worker.terminate();
    this.fail(new Error('The search worker was stopped'));
    this.listeners.clear();
  }
}
