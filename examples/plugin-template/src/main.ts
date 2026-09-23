import { definePlugin, type PanelContext } from '@tessera/plugin-api';

/**
 * A Tessera plugin. `activate` runs in a background worker when the plugin starts: it registers
 * a command and a side panel. `panels.page` renders the panel in its own sandboxed frame.
 *
 * Everything the plugin can do goes through `api`, and only with the permissions listed in
 * manifest.json and approved by the user.
 */
export default definePlugin({
  settings: {
    greeting: {
      type: 'string',
      label: 'Greeting',
      description: 'What “Say hello” says.',
      default: 'Hello from My plugin 👋',
    },
  },

  activate(api) {
    api.commands.register({
      id: 'say-hello',
      title: 'Say hello',
      run: () => api.ui.notify(api.settings.get('greeting')),
    });
    api.ui.addPanel({ id: 'page', title: 'My plugin', icon: '👋' });
  },

  panels: {
    page: renderPanel,
  },
});

/** The side panel: the title of the page you are on, kept up to date. */
function renderPanel(ctx: PanelContext) {
  const heading = ctx.root.ownerDocument.createElement('h2');
  const text = ctx.root.ownerDocument.createElement('p');
  text.className = 'muted';
  ctx.root.append(heading, text);

  const show = async () => {
    heading.textContent = 'You are on';
    if (!ctx.pageId) {
      text.textContent = 'No page. Open one from the sidebar.';
      return;
    }
    try {
      const page = await ctx.api.pages.get(ctx.pageId);
      text.textContent = page.title || 'Untitled';
    } catch (error) {
      text.textContent = error instanceof Error ? error.message : String(error);
    }
  };

  const stop = ctx.onPageChange(() => void show());
  void show();
  return stop;
}
