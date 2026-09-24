import { colorForId, type Awareness, type DocHandle, type PageSectionProps } from '@tessera/core';
import { useAppContext, useCurrentUser } from '@tessera/core/react';
import { Avatar, AvatarStack, Popover, PopoverContent, PopoverTrigger, Tooltip } from '@tessera/ui';
import { useEffect, useState } from 'react';
import { t } from '../i18n';

export interface PresentPerson {
  id: string;
  name: string;
  color: string;
}

/**
 * Other people on a doc, from its awareness: one entry per person (several tabs or devices of
 * one account count once), never the current user.
 */
export function peopleFrom(awareness: Awareness, selfId: string): PresentPerson[] {
  const people = new Map<string, PresentPerson>();
  for (const [clientId, state] of awareness.getStates()) {
    if (clientId === awareness.clientID) continue;
    const user = (state as { user?: { id?: unknown; name?: unknown; color?: unknown } }).user;
    if (!user || typeof user.id !== 'string' || user.id === selfId) continue;
    if (people.has(user.id)) continue;
    people.set(user.id, {
      id: user.id,
      name: typeof user.name === 'string' && user.name.trim() ? user.name : t('someone'),
      color: typeof user.color === 'string' && user.color ? user.color : colorForId(user.id),
    });
  }
  return [...people.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Who else is on this page right now (the page's awareness), as avatars in the top bar. */
export function PresenceAvatars({ pageId, page }: PageSectionProps) {
  const ctx = useAppContext();
  const me = useCurrentUser();
  const [people, setPeople] = useState<PresentPerson[]>([]);
  const local = ctx.serviceSources.syncProvider === 'local';

  useEffect(() => {
    // Local-only workspaces have nobody else to show.
    if (local) return undefined;
    let handle: DocHandle | null =
      page.kind === 'database' ? ctx.acquireDatabaseDoc(pageId) : ctx.acquirePageDoc(pageId);
    let off: (() => void) | null = null;
    let active = true;
    void handle.whenLoaded
      .then(() => {
        const awareness = handle?.sync?.awareness;
        if (!active || !awareness) return;
        const refresh = () => setPeople(peopleFrom(awareness, me.id));
        awareness.on('change', refresh);
        off = () => awareness.off('change', refresh);
        refresh();
      })
      .catch(() => undefined);
    return () => {
      active = false;
      off?.();
      handle?.release();
      handle = null;
      setPeople([]);
    };
  }, [ctx, pageId, page.kind, local, me.id]);

  if (people.length === 0) return null;
  const names = people.map((person) => person.name).join(', ');
  // A button (not only a tooltip): the list must be reachable by keyboard and on touch screens.
  return (
    <Popover>
      <Tooltip content={t('alsoHere', { names })}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={`${t('presenceLabel', { count: people.length })}: ${names}`}
            data-testid="presence"
            className="duration-fast flex h-7 items-center rounded-md px-1 transition-colors outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-focus"
          >
            <AvatarStack people={people} size="sm" max={4} />
          </button>
        </PopoverTrigger>
      </Tooltip>
      <PopoverContent align="end" className="w-60 p-1">
        <p className="px-2 pt-1 pb-1.5 text-xs font-medium text-fg-subtle">
          {t('presenceLabel', { count: people.length })}
        </p>
        <ul>
          {people.map((person) => (
            <li
              key={person.id}
              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-fg"
            >
              <Avatar name={person.name} color={person.color} size="sm" />
              <span className="min-w-0 flex-1 truncate">{person.name}</span>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
