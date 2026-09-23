import { definePlugin, type PageInfo, type SettingsSchema } from '@tessera/plugin-api';

const settings = {
  includeRows: {
    type: 'boolean',
    label: 'Include database rows',
    description: 'Rows are pages too; leave this off to only land on regular pages.',
    default: false,
  },
  includeDatabases: {
    type: 'boolean',
    label: 'Include databases',
    default: true,
  },
} satisfies SettingsSchema;

/**
 * Picks a page other than the current one. `random` returns a number in [0, 1) (Math.random by
 * default; tests pass their own).
 */
export function pickRandomPage(
  pages: readonly PageInfo[],
  options: { exclude: string | null; includeDatabases: boolean },
  random: () => number = Math.random,
): PageInfo | null {
  const candidates = pages.filter(
    (page) =>
      page.id !== options.exclude &&
      !page.trashed &&
      (options.includeDatabases || page.kind !== 'database'),
  );
  if (!candidates.length) return null;
  return (
    candidates[Math.min(Math.floor(random() * candidates.length), candidates.length - 1)] ?? null
  );
}

export default definePlugin({
  settings,
  activate(api) {
    api.commands.register({
      id: 'open-random',
      title: 'Open a random page',
      keywords: ['random', 'surprise', 'serendipity', 'shuffle'],
      async run({ pageId }) {
        try {
          const pages = await api.pages.list({ includeRows: api.settings.get('includeRows') });
          const page = pickRandomPage(pages, {
            exclude: pageId,
            includeDatabases: api.settings.get('includeDatabases'),
          });
          if (!page) {
            await api.ui.notify('There’s no other page to open yet.');
            return;
          }
          await api.pages.open(page.id);
        } catch (error) {
          await api.ui.notify({
            title: 'Couldn’t open a random page',
            description: error instanceof Error ? error.message : String(error),
            variant: 'error',
          });
        }
      },
    });
  },
});
