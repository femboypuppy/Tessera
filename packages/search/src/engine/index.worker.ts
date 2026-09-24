/**
 * The search index worker: MiniSearch, the link graph and IndexedDB persistence, off the main
 * thread. The main thread (`IndexHost`) sends page metadata and Yjs updates; see `protocol.ts`.
 */
import { IdbPersistence } from './persistence';
import type { RequestEnvelope, WorkerMessage } from './protocol';
import { IndexRuntime } from './runtime';

interface WorkerScope {
  postMessage(message: WorkerMessage): void;
  onmessage: ((event: MessageEvent<RequestEnvelope>) => void) | null;
}

const scope = self as unknown as WorkerScope;

const runtime = new IndexRuntime({
  persistence: IdbPersistence.isAvailable() ? new IdbPersistence() : null,
  notify: (change) => scope.postMessage({ type: 'changed', change }),
  onError: (error) => console.warn('[search worker]', error),
});

scope.onmessage = (event) => {
  const { id, request } = event.data;
  runtime.handle(request).then(
    (result) => scope.postMessage({ type: 'response', id, result }),
    (error: unknown) =>
      scope.postMessage({
        type: 'error',
        id,
        message: error instanceof Error ? error.message : String(error),
      }),
  );
};
