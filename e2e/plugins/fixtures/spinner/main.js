// A plugin that hangs its worker: `while (true) {}` inside a command (Mod+Alt+Shift+Y).
export default {
  __tesseraPlugin: 1,
  activate(api) {
    api.commands.register({
      id: 'spin',
      title: 'Spin forever',
      shortcut: 'Mod+Alt+Shift+Y',
      run() {
        console.info('Spinning now');
        for (;;) {
          // Never yields: only the heartbeat watchdog can stop this.
        }
      },
    });
  },
};
