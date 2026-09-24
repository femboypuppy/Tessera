import type { ImportPlan, PlanInput, PlanPage, PlanProgress } from '../plan/types';

/** Messages to the import worker. */
export type WorkerRequest = { type: 'plan'; input: PlanInput };

/**
 * Messages from the import worker. The plan's pages arrive in chunks before `done` (which carries
 * the rest of the plan with no pages): one message with every page would take the main thread a
 * long moment to read.
 */
export type WorkerResponse =
  | { type: 'progress'; progress: PlanProgress }
  | { type: 'pages'; pages: PlanPage[] }
  | { type: 'done'; plan: ImportPlan }
  | { type: 'error'; message: string };

/** Pages per `pages` message. */
export const PAGES_PER_MESSAGE = 100;
