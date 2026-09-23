import { commandShortcuts, COMMANDS, formatShortcut } from '@tessera/core';
import { useAppContext, useCommands } from '@tessera/core/react';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  KeyCombo,
} from '@tessera/ui';
import { t } from '../../i18n';
import { useUiStore } from '../ui-store';

const GROUP_ORDER = ['navigation', 'page', 'editor', 'view', 'workspace', 'help'];

function groupTitle(group: string): string {
  return GROUP_ORDER.includes(group) ? t(`group.${group}` as 'group.help') : t('group.other');
}

interface ShortcutRow {
  id: string;
  title: string;
  shortcuts: string[];
}

/** Every command that has a shortcut, grouped (the help overlay and Settings → Shortcuts). */
export function ShortcutList() {
  const ctx = useAppContext();
  const commands = useCommands().filter((command) => commandShortcuts(command).length > 0);
  const groups = new Map<string, ShortcutRow[]>();
  const add = (group: string, row: ShortcutRow) =>
    groups.set(group, [...(groups.get(group) ?? []), row]);
  // Mod+K is reserved for the command palette. Without the search feature, say so where it would be.
  if (!commands.some((command) => command.id === COMMANDS.openPalette)) {
    add('navigation', {
      id: COMMANDS.openPalette,
      title: t('shortcutPaletteUnavailable'),
      shortcuts: ['Mod+K'],
    });
  }
  for (const command of commands) {
    add(command.group ?? 'other', {
      id: command.id,
      title: command.title,
      shortcuts: commandShortcuts(command),
    });
  }
  const sorted = [...groups.entries()].sort(
    ([a], [b]) => (GROUP_ORDER.indexOf(a) + 1 || 99) - (GROUP_ORDER.indexOf(b) + 1 || 99),
  );
  return (
    <div className="flex flex-col gap-5">
      {sorted.map(([group, rows]) => (
        <section key={group}>
          <h3 className="mb-1 text-xs font-medium text-fg-subtle">{groupTitle(group)}</h3>
          <ul className="divide-y divide-border">
            {rows.map((row) => (
              <li key={row.id} className="flex items-center justify-between gap-4 py-1.5">
                <span className="text-sm text-fg">{row.title}</span>
                <span className="flex shrink-0 items-center gap-2">
                  {row.shortcuts.map((shortcut) => (
                    <KeyCombo
                      key={shortcut}
                      keys={formatShortcut(shortcut, ctx.platform.isApple)}
                    />
                  ))}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** The keyboard shortcuts overlay (`?` or Mod+/). */
export function ShortcutsDialog() {
  const open = useUiStore((state) => state.shortcutsOpen);
  const setOpen = useUiStore((state) => state.setShortcutsOpen);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>{t('shortcutsTitle')}</DialogTitle>
          <DialogDescription>{t('shortcutsHint')}</DialogDescription>
        </DialogHeader>
        <DialogBody className="pb-5">
          <ShortcutList />
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
