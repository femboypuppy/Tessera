import {
  definePlugin,
  type PanelContext,
  type PluginApi,
  type SettingsSchema,
} from '@tessera/plugin-api';
import {
  advance,
  formatClock,
  readState,
  remaining,
  reset,
  select,
  toggle,
  type Durations,
  type Mode,
  type TimerState,
} from './timer';

const settings = {
  focusMinutes: { type: 'number', label: 'Focus', default: 25, min: 1, max: 180, unit: 'min' },
  shortBreakMinutes: {
    type: 'number',
    label: 'Short break',
    default: 5,
    min: 1,
    max: 60,
    unit: 'min',
  },
  longBreakMinutes: {
    type: 'number',
    label: 'Long break',
    default: 15,
    min: 1,
    max: 120,
    unit: 'min',
  },
  longBreakEvery: {
    type: 'number',
    label: 'Long break after',
    default: 4,
    min: 2,
    max: 12,
    unit: 'sessions',
  },
  notify: {
    type: 'boolean',
    label: 'Notify me when a session ends',
    default: true,
  },
} satisfies SettingsSchema;

type Api = PluginApi<typeof settings>;

/** The storage key of the shared timer state. */
export const STATE_KEY = 'timer';

const LABELS: Record<Mode, string> = { focus: 'Focus', short: 'Short break', long: 'Long break' };

export function durations(api: Api): Durations {
  const minutes = 60_000;
  return {
    focus: api.settings.get('focusMinutes') * minutes,
    short: api.settings.get('shortBreakMinutes') * minutes,
    long: api.settings.get('longBreakMinutes') * minutes,
    longEvery: api.settings.get('longBreakEvery'),
  };
}

async function load(api: Api): Promise<TimerState> {
  return readState(await api.storage.get(STATE_KEY), durations(api), Date.now());
}

async function update(api: Api, change: (state: TimerState) => TimerState): Promise<TimerState> {
  const next = change(await load(api));
  await api.storage.set(STATE_KEY, next);
  return next;
}

const STYLE = `
.pomo { display: flex; flex-direction: column; align-items: center; gap: 20px; padding: 8px 4px 16px; }
.pomo-modes { display: inline-flex; gap: 2px; padding: 3px; border-radius: 999px; background: var(--tess-hover); }
.pomo-modes button { height: 28px; padding: 0 12px; border: 0; border-radius: 999px; background: transparent; box-shadow: none; font-size: 13px; color: var(--tess-fg-muted); }
.pomo-modes button[aria-checked=true] { background: var(--tess-surface); color: var(--tess-fg); box-shadow: var(--tess-shadow-sm); }
.pomo-ring { position: relative; width: 208px; height: 208px; }
.pomo-ring svg { width: 100%; height: 100%; transform: rotate(-90deg); }
.pomo-ring circle { fill: none; stroke-width: 10; }
.pomo-track { stroke: var(--tess-hover); }
.pomo-progress { stroke: var(--pomo-color); stroke-linecap: round; transition: stroke-dashoffset .3s linear; }
.pomo-center { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; }
.pomo-time { font-size: 44px; font-weight: 650; letter-spacing: -.02em; font-variant-numeric: tabular-nums; }
.pomo-label { font-size: 13px; color: var(--tess-fg-muted); }
.pomo-actions { display: flex; gap: 8px; }
.pomo-actions .primary { min-width: 104px; background: var(--pomo-color); }
.pomo-actions .primary:hover { background: var(--pomo-color); filter: brightness(1.08); }
.pomo-sessions { display: flex; flex-direction: column; align-items: center; gap: 8px; font-size: 12px; color: var(--tess-fg-muted); }
.pomo-dots { display: flex; gap: 6px; }
.pomo-dots span { width: 8px; height: 8px; border-radius: 50%; background: var(--tess-border-strong); }
.pomo-dots span[data-done] { background: var(--tess-accent); }
`;

function renderPanel(ctx: PanelContext<typeof settings>) {
  const api = ctx.api;
  const doc = ctx.root.ownerDocument;
  const html = (markup: string) => {
    const template = doc.createElement('template');
    template.innerHTML = markup;
    return template.content;
  };
  ctx.root.append(
    html(`<style>${STYLE}</style>
<section class="pomo" aria-label="Pomodoro timer">
  <div class="pomo-modes" role="radiogroup" aria-label="Mode">
    <button type="button" role="radio" data-mode="focus">Focus</button>
    <button type="button" role="radio" data-mode="short">Short break</button>
    <button type="button" role="radio" data-mode="long">Long break</button>
  </div>
  <div class="pomo-ring">
    <svg viewBox="0 0 120 120" aria-hidden="true">
      <circle class="pomo-track" cx="60" cy="60" r="54"></circle>
      <circle class="pomo-progress" cx="60" cy="60" r="54"></circle>
    </svg>
    <div class="pomo-center">
      <span class="pomo-time" role="timer" aria-label="Time left"></span>
      <span class="pomo-label"></span>
    </div>
  </div>
  <div class="pomo-actions">
    <button type="button" class="primary" data-action="toggle"></button>
    <button type="button" data-action="reset" aria-label="Reset the timer">Reset</button>
    <button type="button" class="ghost" data-action="skip" aria-label="Skip to the next session">Skip</button>
  </div>
  <div class="pomo-sessions">
    <div class="pomo-dots" aria-hidden="true"></div>
    <span class="pomo-today"></span>
  </div>
</section>`),
  );
  const section = ctx.root.querySelector<HTMLElement>('.pomo');
  const time = ctx.root.querySelector<HTMLElement>('.pomo-time');
  const label = ctx.root.querySelector<HTMLElement>('.pomo-label');
  const progress = ctx.root.querySelector<SVGCircleElement>('.pomo-progress');
  const toggleButton = ctx.root.querySelector<HTMLButtonElement>('[data-action="toggle"]');
  const dots = ctx.root.querySelector<HTMLElement>('.pomo-dots');
  const today = ctx.root.querySelector<HTMLElement>('.pomo-today');
  const circumference = 2 * Math.PI * 54;
  let state: TimerState | null = null;

  const paint = () => {
    const current = state;
    if (!current || !section || !time || !label || !progress || !toggleButton || !dots || !today)
      return;
    const total = durations(api)[current.mode];
    const left = remaining(current, Date.now());
    section.style.setProperty(
      '--pomo-color',
      current.mode === 'focus' ? 'var(--tess-accent)' : 'var(--tess-success)',
    );
    time.textContent = formatClock(left);
    label.textContent = current.running
      ? LABELS[current.mode]
      : `${LABELS[current.mode]} · ${left < total ? 'paused' : 'ready'}`;
    progress.style.strokeDasharray = String(circumference);
    progress.style.strokeDashoffset = String(circumference * (total ? 1 - left / total : 0));
    toggleButton.textContent = current.running ? 'Pause' : left < total ? 'Resume' : 'Start';
    for (const button of ctx.root.querySelectorAll<HTMLButtonElement>('[data-mode]'))
      button.setAttribute('aria-checked', String(button.dataset.mode === current.mode));
    const every = api.settings.get('longBreakEvery');
    dots.replaceChildren(
      ...Array.from({ length: every }, (_, index) => {
        const dot = doc.createElement('span');
        if (index < current.cycle) dot.setAttribute('data-done', '');
        return dot;
      }),
    );
    const count = current.today.count;
    today.textContent =
      count === 0
        ? 'No sessions yet today'
        : `${count} focus ${count === 1 ? 'session' : 'sessions'} today`;
  };

  const refresh = async () => {
    state = await load(api);
    paint();
  };
  const act = (change: (current: TimerState) => TimerState) => async () => {
    state = await update(api, change);
    paint();
  };

  ctx.root.addEventListener('click', (event) => {
    const target = (event.target as Element).closest('button');
    if (!target) return;
    const mode = target.getAttribute('data-mode') as Mode | null;
    const action = target.getAttribute('data-action');
    if (mode) void act((current) => select(current, mode, durations(api)))();
    else if (action === 'toggle') void act((current) => toggle(current, Date.now()))();
    else if (action === 'reset') void act((current) => reset(current, durations(api)))();
    else if (action === 'skip')
      void act((current) => advance(current, durations(api), Date.now(), { counted: false }))();
  });

  const stops = [
    api.storage.onChange((key) => {
      if (key === STATE_KEY) void refresh();
    }),
    api.settings.onChange(() => void refresh()),
  ];
  const ticker = setInterval(() => {
    if (state?.running) paint();
  }, 250);
  void refresh();
  return () => {
    clearInterval(ticker);
    for (const stop of stops) stop();
  };
}

/** Finishes sessions that ran out, from the worker, so it works with the panel closed. */
function watch(api: Api): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const finish = async () => {
    const state = await load(api);
    if (!state.running) return;
    if (remaining(state, Date.now()) > 0) {
      schedule(state);
      return;
    }
    const next = await update(api, (current) =>
      advance(current, durations(api), Date.now(), { counted: current.mode === 'focus' }),
    );
    if (!api.settings.get('notify')) return;
    const minutes = Math.round(durations(api)[next.mode] / 60_000);
    await api.ui.notify(
      state.mode === 'focus'
        ? {
            title: 'Focus session done',
            description: `Time for a ${minutes}-minute ${next.mode === 'long' ? 'long ' : ''}break ☕`,
            variant: 'success',
          }
        : { title: 'Break’s over', description: 'Ready for another focus session? 🍅' },
    );
  };
  const schedule = (state: TimerState) => {
    clearTimeout(timer);
    if (state.running && state.endsAt !== null)
      timer = setTimeout(() => void finish(), Math.max(0, state.endsAt - Date.now()));
  };
  const stop = api.storage.onChange((key) => {
    if (key === STATE_KEY) void load(api).then(schedule);
  });
  void load(api).then(schedule);
  return () => {
    clearTimeout(timer);
    stop();
  };
}

let stopWatching: (() => void) | null = null;

export default definePlugin({
  settings,
  activate(api) {
    api.ui.addPanel({ id: 'timer', title: 'Pomodoro', icon: '🍅' });
    api.commands.register({
      id: 'toggle',
      title: 'Start or pause the timer',
      keywords: ['pomodoro', 'focus', 'timer'],
      shortcut: 'Mod+Alt+P',
      run: async () => {
        await update(api, (state) => toggle(state, Date.now()));
      },
    });
    api.commands.register({
      id: 'show',
      title: 'Show the timer',
      keywords: ['pomodoro', 'focus'],
      run: () => api.ui.openPanel('timer'),
    });
    api.commands.register({
      id: 'reset',
      title: 'Reset the timer',
      keywords: ['pomodoro'],
      run: async () => {
        await update(api, (state) => reset(state, durations(api)));
      },
    });
    stopWatching = watch(api);
  },
  deactivate() {
    stopWatching?.();
    stopWatching = null;
  },
  panels: { timer: renderPanel },
});
