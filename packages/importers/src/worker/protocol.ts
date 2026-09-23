import type { ImportPlan, PlanInput, PlanProgress } from '../plan/types';

/** Messages to the import worker. */
export type WorkerRequest = { type: 'plan'; input: PlanInput };

/** Messages from the import worker. */
export type WorkerResponse =
  | { type: 'progress'; progress: PlanProgress }
  | { type: 'done'; plan: ImportPlan }
  | { type: 'error'; message: string };
