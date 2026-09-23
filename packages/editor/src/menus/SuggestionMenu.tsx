import { cn } from '@tessera/ui';
import type { Editor } from '@tiptap/core';
import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { EditorController } from '../react/controller';
import { useFloatingPosition } from '../react/floating';
import { useStore } from '../react/store';
import type { MenuItem } from './types';

function ItemIcon({ icon }: { icon: MenuItem['icon'] }) {
  if (!icon) return null;
  if (typeof icon === 'string')
    return (
      <span className="text-lg leading-none" aria-hidden="true">
        {icon}
      </span>
    );
  const Icon = icon;
  return <Icon className="size-[18px]" strokeWidth={1.75} aria-hidden="true" />;
}

/**
 * The floating list of a suggestion menu (slash commands, page links). Focus stays in the editor:
 * the editor points at the active option with `aria-activedescendant`, and the keyboard is handled
 * by the suggestion plugin.
 */
export function SuggestionMenu({
  controller,
  editor,
}: {
  controller: EditorController;
  editor: Editor;
}) {
  const state = useStore(controller.menu);
  const panel = useRef<HTMLDivElement>(null);
  const baseId = useId();
  const listId = `${baseId}-list`;
  const position = useFloatingPosition(panel, state?.getRect ?? null, {}, state?.flat.length);
  const optionId = (index: number) => `${baseId}-option-${index}`;

  // Accessibility: the editor owns the listbox while the menu is open.
  useEffect(() => {
    const dom = editor.view.dom;
    if (!state) {
      for (const name of [
        'aria-controls',
        'aria-activedescendant',
        'aria-expanded',
        'aria-autocomplete',
      ])
        dom.removeAttribute(name);
      return;
    }
    dom.setAttribute('aria-controls', listId);
    dom.setAttribute('aria-expanded', 'true');
    dom.setAttribute('aria-autocomplete', 'list');
    if (state.flat.length) dom.setAttribute('aria-activedescendant', optionId(state.active));
    else dom.removeAttribute('aria-activedescendant');
  });

  useEffect(() => {
    if (!state) return;
    const active = panel.current?.querySelector('[aria-selected="true"]');
    if (active instanceof HTMLElement) active.scrollIntoView?.({ block: 'nearest' });
  }, [state]);

  // Nothing to show until the first results arrive (a moment after the trigger).
  if (!state || (state.loading && state.flat.length === 0)) return null;
  let index = -1;
  return createPortal(
    <div
      ref={panel}
      id={listId}
      role="listbox"
      aria-label={state.label}
      data-menu={state.kind}
      className={cn(
        'tess-suggestion-menu fixed z-[var(--tess-z-popover)] w-[min(20rem,calc(100vw-16px))] overflow-y-auto overscroll-contain rounded-lg border border-border bg-surface-raised p-1 shadow-popover',
        position ? 'visible animate-pop-in' : 'invisible',
      )}
      style={{
        top: position?.top ?? 0,
        left: position?.left ?? 0,
        maxHeight: 'min(22rem, 45vh)',
      }}
    >
      {state.flat.length === 0 ? (
        <div className="px-3 py-2 text-ui text-fg-muted" role="presentation">
          {state.emptyLabel}
        </div>
      ) : (
        state.sections.map((section) => {
          const labelId = `${baseId}-${section.id}`;
          return (
            <div
              key={section.id}
              role="group"
              aria-labelledby={section.label ? labelId : undefined}
              aria-label={section.label ? undefined : state.label}
            >
              {section.label ? (
                <div
                  id={labelId}
                  className="px-2 pt-2 pb-1 text-2xs font-medium text-fg-subtle select-none"
                >
                  {section.label}
                </div>
              ) : null}
              {section.items.map((item) => {
                index += 1;
                const itemIndex = index;
                const active = itemIndex === state.active;
                return (
                  // Options never take focus: the keyboard stays in the editor, which points here
                  // with aria-activedescendant; the mouse selects with a click.
                  // eslint-disable-next-line jsx-a11y/click-events-have-key-events -- see above
                  <div
                    key={`${section.id}:${item.id}`}
                    id={optionId(itemIndex)}
                    role="option"
                    tabIndex={-1}
                    aria-selected={active}
                    data-item={item.id}
                    className={cn(
                      'flex min-h-10 cursor-default items-center gap-3 rounded-md px-2 py-1.5 select-none',
                      active && 'bg-hover',
                    )}
                    onMouseMove={() => {
                      const current = controller.menu.get();
                      if (current && current.active !== itemIndex)
                        controller.menu.set({ ...current, active: itemIndex });
                    }}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => state.select(item)}
                  >
                    {item.icon ? (
                      <span className="flex size-9 flex-none items-center justify-center rounded-md border border-border bg-surface text-fg-muted">
                        <ItemIcon icon={item.icon} />
                      </span>
                    ) : null}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-fg">{item.title}</span>
                      {item.description ? (
                        <span className="block truncate text-2xs text-fg-subtle">
                          {item.description}
                        </span>
                      ) : null}
                    </span>
                    {item.hint ? (
                      <span
                        className="flex-none font-mono text-2xs text-fg-subtle"
                        aria-hidden="true"
                      >
                        {item.hint}
                      </span>
                    ) : null}
                  </div>
                );
              })}
            </div>
          );
        })
      )}
    </div>,
    document.body,
  );
}
