import type { ChangeSummary } from '../engine/index-core';
import { IdbPersistence } from '../engine/persistence';
import type { IndexRequest, IndexRequestType, IndexResults } from '../engine/protocol';
import { InProcessTransport, WorkerTransport, type IndexTransport } from '../engine/transport';

const START_TIMEOUT_MS = 10_000;

function inProcess(): IndexTransport {
  return new InProcessTransport({
    persistence: IdbPersistence.isAvailable() ? new IdbPersistence() : null,
  });
}

async function startWorker(): Promise<IndexTransport> {
  if (typeof Worker === 'undefined') return inProcess();
  let transport: WorkerTransport | null = null;
  try {
    const worker = new Worker(new URL('../engine/index.worker.ts', import.meta.url), {
      type: 'module',
      name: 'tessera-search-index',
    });
    transport = new WorkerTransport(worker);
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      transport.request({ type: 'ping' }),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('The search worker did not start')),
          START_TIMEOUT_MS,
        );
      }),
    ]).finally(() => clearTimeout(timer));
    return transport;
  } catch (error) {
    console.warn('[search] running the index on the main thread', error);
    transport?.terminate();
    return inProcess();
  }
}

/**
 * A transport that is usable at once: requests queue (in order) until the index worker answers,
 * and fall back to an in-process index when workers are unavailable or the worker fails to start
 * (a strict CSP, an old browser). Opening a workspace never waits for the worker.
 */
export class DeferredTransport implements IndexTransport {
  private resolved: IndexTransport | null = null;
  private readonly target: Promise<IndexTransport>;
  private readonly listeners = new Set<(change: ChangeSummary) => void>();
  private terminated = false;

  constructor(start: () => Promise<IndexTransport> = startWorker) {
    this.target = start().then((transport) => {
      if (this.terminated) transport.terminate();
      this.resolved = transport;
      transport.onChange((change) => {
        for (const listener of [...this.listeners]) listener(change);
      });
      return transport;
    });
  }

  get kind(): IndexTransport['kind'] {
    return this.resolved?.kind ?? 'worker';
  }

  request<T extends IndexRequestType>(
    request: Extract<IndexRequest, { type: T }>,
    transfer?: Transferable[],
  ): Promise<IndexResults[T]> {
    // Every request chains on the same promise, so the order is kept while the worker starts.
    return this.target.then((transport) => transport.request(request, transfer));
  }

  onChange(listener: (change: ChangeSummary) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  terminate(): void {
    this.terminated = true;
    this.resolved?.terminate();
    this.listeners.clear();
  }
}

/** The browser transport: the index worker, started in the background. */
export function createBrowserTransport(): IndexTransport {
  return new DeferredTransport();
}
