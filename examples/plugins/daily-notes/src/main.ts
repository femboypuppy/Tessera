import {
  definePlugin,
  type PageInfo,
  type PluginApi,
  type SettingsSchema,
} from '@tessera/plugin-api';
import { addDays, formatDate } from './dates';

const settings = {
  dateFormat: {
    type: 'string',
    label: 'Date format',
    description:
      'How notes are titled. Tokens: YYYY, MM, DD, MMMM, MMM, dddd, ddd, Do. Text in [brackets] stays as is.',
    default: 'YYYY-MM-DD',
    placeholder: 'YYYY-MM-DD',
    maxLength: 100,
  },
  folder: {
    type: 'string',
    label: 'Folder page',
    description:
      'Daily notes go under a page with this title. Leave it empty to keep them at the top level.',
    default: 'Daily notes',
    maxLength: 200,
  },
  template: {
    type: 'string',
    label: 'Template',
    description: 'Markdown every new daily note starts with.',
    default: '## Plan\n\n- [ ] \n\n## Notes\n\n',
    multiline: true,
    maxLength: 10_000,
  },
  autoCreate: {
    type: 'boolean',
    label: 'Create today’s note when Tessera opens',
    description: 'It is created in the background; open it with the command.',
    default: false,
  },
} satisfies SettingsSchema;

type Api = PluginApi<typeof settings>;

/** Finds or creates the folder page (null for the top level). */
async function folderId(api: Api): Promise<string | null> {
  const title = api.settings.get('folder').trim();
  if (!title) return null;
  const existing = (await api.pages.list({ parentId: null })).find(
    (page) => page.title === title && page.kind === 'page',
  );
  if (existing) return existing.id;
  return (await api.pages.create({ title, icon: '📅' })).id;
}

/** Finds or creates the daily note of `date`, and opens it when asked. */
export async function dailyNote(
  api: Api,
  date: Date,
  options: { open: boolean },
): Promise<PageInfo> {
  const parentId = await folderId(api);
  const title = formatDate(date, api.settings.get('dateFormat') || 'YYYY-MM-DD');
  const siblings = await api.pages.list({ parentId });
  const page =
    siblings.find((candidate) => candidate.title === title) ??
    (await api.pages.create({ title, parentId, content: api.settings.get('template') }));
  if (options.open) await api.pages.open(page.id);
  return page;
}

export default definePlugin({
  settings,
  async activate(api) {
    const open = (days: number) => async () => {
      try {
        await dailyNote(api, addDays(new Date(), days), { open: true });
      } catch (error) {
        await api.ui.notify({
          title: 'Couldn’t open the daily note',
          description: error instanceof Error ? error.message : String(error),
          variant: 'error',
        });
      }
    };
    api.commands.register({
      id: 'open-today',
      title: 'Open today’s note',
      keywords: ['daily', 'journal', 'today'],
      shortcut: 'Mod+Alt+D',
      run: open(0),
    });
    api.commands.register({
      id: 'open-yesterday',
      title: 'Open yesterday’s note',
      keywords: ['daily', 'journal'],
      run: open(-1),
    });
    api.commands.register({
      id: 'open-tomorrow',
      title: 'Open tomorrow’s note',
      keywords: ['daily', 'journal', 'plan'],
      run: open(1),
    });
    if (api.settings.get('autoCreate')) await dailyNote(api, new Date(), { open: false });
  },
});
