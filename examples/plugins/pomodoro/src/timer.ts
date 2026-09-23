/**
 * The Pomodoro timer as a pure state machine. The state lives in plugin storage (JSON), shared by
 * the panel (which shows it and starts, pauses or skips) and the worker (which notices when a
 * session ends and moves on, even while the panel is closed).
 */

export type Mode = 'focus' | 'short' | 'long';

/** A type alias, not an interface, so it counts as JSON for `api.storage.set`. */
export type TimerState = {
  mode: Mode;
  running: boolean;
  /** When the running session ends (epoch ms), or null while paused. */
  endsAt: number | null;
  /** Time left while paused. */
  remainingMs: number;
  /** Focus sessions completed in the current cycle (for the long break). */
  cycle: number;
  /** Focus sessions completed today. */
  today: { date: string; count: number };
};

export interface Durations {
  focus: number;
  short: number;
  long: number;
  /** A long break after this many focus sessions. */
  longEvery: number;
}

const MODES: readonly Mode[] = ['focus', 'short', 'long'];

export function durationOf(mode: Mode, durations: Durations): number {
  return durations[mode];
}

/** YYYY-MM-DD in local time. */
export function dayOf(now: number): string {
  const date = new Date(now);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function initialState(durations: Durations, now: number): TimerState {
  return {
    mode: 'focus',
    running: false,
    endsAt: null,
    remainingMs: durations.focus,
    cycle: 0,
    today: { date: dayOf(now), count: 0 },
  };
}

/** Reads a stored state defensively (storage holds whatever an older version wrote). */
export function readState(value: unknown, durations: Durations, now: number): TimerState {
  const fallback = initialState(durations, now);
  if (typeof value !== 'object' || value === null) return fallback;
  const input = value as Partial<TimerState>;
  const mode = MODES.includes(input.mode as Mode) ? (input.mode as Mode) : 'focus';
  const number = (candidate: unknown, otherwise: number) =>
    typeof candidate === 'number' && Number.isFinite(candidate) && candidate >= 0
      ? candidate
      : otherwise;
  const running = input.running === true && typeof input.endsAt === 'number';
  const today =
    input.today && typeof input.today.date === 'string' && input.today.date === dayOf(now)
      ? { date: input.today.date, count: number(input.today.count, 0) }
      : { date: dayOf(now), count: 0 };
  return {
    mode,
    running,
    endsAt: running ? number(input.endsAt, now) : null,
    remainingMs: Math.min(
      number(input.remainingMs, durationOf(mode, durations)),
      durationOf(mode, durations),
    ),
    cycle: number(input.cycle, 0),
    today,
  };
}

/** Milliseconds left. */
export function remaining(state: TimerState, now: number): number {
  return state.running && state.endsAt !== null
    ? Math.max(0, state.endsAt - now)
    : state.remainingMs;
}

export function start(state: TimerState, now: number): TimerState {
  if (state.running) return state;
  return { ...state, running: true, endsAt: now + state.remainingMs };
}

export function pause(state: TimerState, now: number): TimerState {
  if (!state.running) return state;
  return { ...state, running: false, endsAt: null, remainingMs: remaining(state, now) };
}

export function toggle(state: TimerState, now: number): TimerState {
  return state.running ? pause(state, now) : start(state, now);
}

/** Back to the full length of the current mode, stopped. */
export function reset(state: TimerState, durations: Durations): TimerState {
  return { ...state, running: false, endsAt: null, remainingMs: durationOf(state.mode, durations) };
}

/** Switches to a mode, stopped. */
export function select(state: TimerState, mode: Mode, durations: Durations): TimerState {
  return { ...state, mode, running: false, endsAt: null, remainingMs: durationOf(mode, durations) };
}

/**
 * What comes after the current session (finished or skipped): a break after focus (long every
 * `longEvery` sessions), focus after a break. Finishing a focus session counts it.
 */
export function advance(
  state: TimerState,
  durations: Durations,
  now: number,
  options: { counted: boolean },
): TimerState {
  if (state.mode === 'focus') {
    const cycle = options.counted ? state.cycle + 1 : state.cycle;
    const today =
      state.today.date === dayOf(now)
        ? { date: state.today.date, count: state.today.count + (options.counted ? 1 : 0) }
        : { date: dayOf(now), count: options.counted ? 1 : 0 };
    const longBreak = options.counted && cycle >= durations.longEvery;
    return {
      ...select(state, longBreak ? 'long' : 'short', durations),
      cycle: longBreak ? 0 : cycle,
      today,
    };
  }
  return select(state, 'focus', durations);
}

/** 25:00, 4:59, 0:07. */
export function formatClock(ms: number): string {
  const seconds = Math.ceil(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
