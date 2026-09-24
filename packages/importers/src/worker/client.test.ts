import { AbortError } from '@tessera/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ImportPlan, PlanInput, PlanPage } from '../plan/types';
import { planInWorker } from './client';
import type { WorkerRequest, WorkerResponse } from './protocol';

const input: PlanInput = { format: 'markdown', files: [], attachments: [], ignored: [] };

function page(index: number): PlanPage {
  return {
    key: `note-${index}`,
    id: `id${index}`,
    parentKey: null,
    kind: 'page',
    title: `Note ${index}`,
  };
}

/** A worker that answers a plan request with the given messages, one task apart. */
function fakeWorker(responses: WorkerResponse[]) {
  const instances: FakeWorker[] = [];
  class FakeWorker {
    onmessage: ((event: MessageEvent<WorkerResponse>) => void) | null = null;
    onerror: ((event: ErrorEvent) => void) | null = null;
    terminated = false;
    requests: WorkerRequest[] = [];
    constructor() {
      instances.push(this);
    }
    postMessage(request: WorkerRequest) {
      this.requests.push(request);
      void (async () => {
        for (const data of responses) {
          await new Promise((resolve) => setTimeout(resolve, 0));
          if (this.terminated) return;
          this.onmessage?.({ data } as MessageEvent<WorkerResponse>);
        }
      })();
    }
    terminate() {
      this.terminated = true;
    }
  }
  vi.stubGlobal('Worker', FakeWorker);
  return instances;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('planInWorker', () => {
  it('reassembles the pages the worker sends in chunks, in order', async () => {
    const plan: ImportPlan = {
      format: 'markdown',
      pages: [],
      unreferencedAssets: 0,
      links: 3,
      issues: [],
      skippedFiles: 0,
    };
    const workers = fakeWorker([
      { type: 'progress', progress: { done: 1, total: 3 } },
      { type: 'pages', pages: [page(0), page(1)] },
      { type: 'pages', pages: [page(2)] },
      { type: 'done', plan },
    ]);
    const progress = vi.fn();
    const result = await planInWorker(input, progress, new AbortController().signal);
    expect(result.pages.map((entry) => entry.key)).toEqual(['note-0', 'note-1', 'note-2']);
    expect(result.links).toBe(3);
    expect(progress).toHaveBeenCalledWith({ done: 1, total: 3 });
    expect(workers[0]?.requests).toEqual([{ type: 'plan', input }]);
    expect(workers[0]?.terminated).toBe(true);
  });

  it('stops the worker when cancelled', async () => {
    const workers = fakeWorker([{ type: 'progress', progress: { done: 0, total: 1 } }]);
    const controller = new AbortController();
    const planning = planInWorker(input, () => controller.abort(), controller.signal);
    await expect(planning).rejects.toBeInstanceOf(AbortError);
    expect(workers[0]?.terminated).toBe(true);
  });

  it('reports a worker error', async () => {
    fakeWorker([{ type: 'error', message: 'Out of memory' }]);
    await expect(
      planInWorker(input, () => undefined, new AbortController().signal),
    ).rejects.toThrow('Out of memory');
  });
});
