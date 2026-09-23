import { IdbPersistence } from '../engine/persistence';
import { InProcessTransport, WorkerTransport, type IndexTransport } from '../engine/transport';

const START_TIMEOUT_MS = 10_000;

/**
 * Starts the index worker, or falls back to running the index in-process when workers are not
 * available or the worker fails to start (a strict CSP, an old browser). Search keeps working
 * either way; only the main thread pays for indexing in the fallback.
 */
export async function createBrowserTransport(): Promise<IndexTransport> {
  const fallback = () =>
    new InProcessTransport({
      persistence: IdbPersistence.isAvailable() ? new IdbPersistence() : null,
    });
  if (typeof Worker === 'undefined') return fallback();
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
    return fallback();
  }
}
