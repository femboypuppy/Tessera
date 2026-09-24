import { AbortError, throwIfAborted } from '@tessera/core';
import type { ImportPlan, PlanInput, PlanPage, PlanProgress } from '../plan/types';
import type { WorkerRequest, WorkerResponse } from './protocol';

/** Where the last plan was computed (shown in diagnostics and tests). */
export let lastPlanRunner: 'worker' | 'main-thread' | null = null;

function createWorker(): Worker | null {
  if (typeof Worker === 'undefined') return null;
  try {
    return new Worker(new URL('./import.worker.ts', import.meta.url), {
      type: 'module',
      name: 'tessera-import',
    });
  } catch {
    return null;
  }
}

async function planOnMainThread(
  input: PlanInput,
  onProgress: (progress: PlanProgress) => void,
  signal: AbortSignal,
): Promise<ImportPlan> {
  lastPlanRunner = 'main-thread';
  const { planImport } = await import('../plan/planner');
  return planImport(input, { onProgress, signal });
}

/**
 * Plans an import in a Web Worker (the main thread stays free), or on the main thread where
 * workers are unavailable (tests, a worker that fails to start). Cancelling terminates the
 * worker at once.
 */
export async function planInWorker(
  input: PlanInput,
  onProgress: (progress: PlanProgress) => void,
  signal: AbortSignal,
): Promise<ImportPlan> {
  throwIfAborted(signal);
  const worker = createWorker();
  if (!worker) return planOnMainThread(input, onProgress, signal);
  return new Promise<ImportPlan>((resolve, reject) => {
    let settled = false;
    let started = false;
    const pages: PlanPage[] = [];
    const finish = (action: () => void) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      worker.terminate();
      action();
    };
    const onAbort = () => finish(() => reject(new AbortError()));
    signal.addEventListener('abort', onAbort);
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const message = event.data;
      started = true;
      if (message.type === 'progress') onProgress(message.progress);
      else if (message.type === 'pages') pages.push(...message.pages);
      else if (message.type === 'done') {
        lastPlanRunner = 'worker';
        finish(() => resolve({ ...message.plan, pages }));
      } else finish(() => reject(new Error(message.message)));
    };
    worker.onerror = (event) => {
      event.preventDefault();
      // A worker that cannot load (old browser, blocked script) falls back to the main thread.
      if (!started) finish(() => resolve(planOnMainThread(input, onProgress, signal)));
      else finish(() => reject(new Error(event.message || 'The import worker stopped')));
    };
    const request: WorkerRequest = { type: 'plan', input };
    worker.postMessage(request);
  });
}
