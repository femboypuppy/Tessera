// The shim must run before micromark loads (see its comment): keep this import first.
import './dom-shim';
import { planImport } from '../plan/planner';
import type { WorkerRequest, WorkerResponse } from './protocol';

/**
 * The import worker: plans imports (parses every markdown and CSV file, resolves links) off the
 * main thread, so the app stays responsive while a large vault is read.
 */
const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage(message: WorkerResponse): void;
};

scope.onmessage = (event) => {
  const request = event.data;
  if (request?.type !== 'plan') return;
  planImport(request.input, {
    onProgress: (progress) => scope.postMessage({ type: 'progress', progress }),
  }).then(
    (plan) => scope.postMessage({ type: 'done', plan }),
    (error: unknown) =>
      scope.postMessage({
        type: 'error',
        message: error instanceof Error ? error.message : String(error),
      }),
  );
};
