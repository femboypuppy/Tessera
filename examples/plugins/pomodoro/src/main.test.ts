// @vitest-environment jsdom
import { createTestHarness } from '@tessera/plugin-api/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import plugin, { STATE_KEY } from './main';
import {
  advance,
  formatClock,
  initialState,
  pause,
  readState,
  remaining,
  reset,
  select,
  start,
  type Durations,
} from './timer';

const minute = 60_000;
const durations: Durations = {
  focus: 25 * minute,
  short: 5 * minute,
  long: 15 * minute,
  longEvery: 2,
};
const permissions = ['ui:panels', 'ui:commands', 'storage'] as const;
const t0 = new Date(2026, 8, 24, 9, 0).getTime();

describe('timer state machine', () => {
  it('starts, pauses and resumes with the right time left', () => {
    const idle = initialState(durations, t0);
    const running = start(idle, t0);
    expect(remaining(running, t0 + 10 * minute)).toBe(15 * minute);
    const paused = pause(running, t0 + 10 * minute);
    expect(paused).toMatchObject({ running: false, endsAt: null, remainingMs: 15 * minute });
    expect(remaining(paused, t0 + 60 * minute)).toBe(15 * minute);
    expect(remaining(start(paused, t0 + 60 * minute), t0 + 70 * minute)).toBe(5 * minute);
    expect(reset(paused, durations).remainingMs).toBe(25 * minute);
  });

  it('alternates focus and breaks, with a long break every few sessions', () => {
    let state = initialState(durations, t0);
    state = advance(state, durations, t0, { counted: true });
    expect(state).toMatchObject({ mode: 'short', cycle: 1, today: { count: 1 } });
    state = advance(state, durations, t0, { counted: true });
    expect(state.mode).toBe('focus');
    state = advance(state, durations, t0, { counted: true });
    expect(state).toMatchObject({
      mode: 'long',
      cycle: 0,
      remainingMs: 15 * minute,
      today: { count: 2 },
    });
    // Skipping a focus session doesn't count it.
    state = advance(select(state, 'focus', durations), durations, t0, { counted: false });
    expect(state).toMatchObject({ mode: 'short', today: { count: 2 } });
  });

  it('reads stored state defensively and starts a new day at zero', () => {
    expect(readState('garbage', durations, t0)).toEqual(initialState(durations, t0));
    const yesterday = {
      ...initialState(durations, t0 - 86_400_000),
      today: { date: '2026-09-23', count: 7 },
    };
    expect(readState(yesterday, durations, t0).today).toEqual({ date: '2026-09-24', count: 0 });
    expect(readState({ mode: 'nap', remainingMs: -5 }, durations, t0)).toMatchObject({
      mode: 'focus',
      remainingMs: 25 * minute,
    });
  });

  it('formats the clock', () => {
    expect(formatClock(25 * minute)).toBe('25:00');
    expect(formatClock(299_001)).toBe('5:00');
    expect(formatClock(7_000)).toBe('0:07');
  });
});

describe('Pomodoro plugin', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(t0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('adds its panel and commands', async () => {
    const harness = createTestHarness(plugin, { permissions });
    await harness.activate();
    expect(harness.panels).toEqual([{ id: 'timer', title: 'Pomodoro', icon: '🍅' }]);
    expect(harness.commands.map((command) => command.id)).toEqual(['toggle', 'show', 'reset']);
    await harness.runCommand('show');
    expect(harness.openedPanels).toEqual(['timer']);
    await harness.deactivate();
  });

  it('runs a session from the panel and notifies when it ends, even with the panel closed', async () => {
    const harness = createTestHarness(plugin, {
      permissions,
      settings: { focusMinutes: 1, shortBreakMinutes: 1 },
    });
    await harness.activate();
    const panel = await harness.renderPanel('timer');
    const time = () => panel.root.querySelector('[role="timer"]')?.textContent;
    const button = (name: string) =>
      [...panel.root.querySelectorAll('button')].find(
        (candidate) => candidate.textContent === name,
      );
    expect(time()).toBe('1:00');
    button('Start')?.click();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(time()).toBe('0:40');
    expect(button('Pause')).toBeDefined();
    await panel.close();
    await vi.advanceTimersByTimeAsync(41_000);
    expect(harness.notifications).toEqual([
      {
        title: 'Focus session done',
        description: 'Time for a 1-minute break ☕',
        variant: 'success',
      },
    ]);
    expect(harness.storage.get(STATE_KEY)).toMatchObject({
      mode: 'short',
      running: false,
      today: { count: 1 },
    });
    await harness.deactivate();
  });

  it('toggles from the command and switches modes from the panel', async () => {
    const harness = createTestHarness(plugin, { permissions });
    await harness.activate();
    await harness.runCommand('toggle');
    expect(harness.storage.get(STATE_KEY)).toMatchObject({ running: true, mode: 'focus' });
    const panel = await harness.renderPanel('timer');
    const shortBreak = panel.root.querySelector<HTMLButtonElement>('[data-mode="short"]');
    shortBreak?.click();
    await harness.flush();
    expect(shortBreak?.getAttribute('aria-checked')).toBe('true');
    expect(panel.root.querySelector('[role="timer"]')?.textContent).toBe('5:00');
    await panel.close();
    await harness.deactivate();
  });
});
