import type { PluginKey } from '@tiptap/pm/state';
import { exitSuggestion, type SuggestionOptions, type SuggestionProps } from '@tiptap/suggestion';
import type { EditorController } from '../react/controller';
import type { MenuItem, SuggestionMenuState } from './types';

type MenuBase<T extends MenuItem> = Omit<SuggestionMenuState<T>, 'active' | 'select' | 'getRect'>;

/** Moves the active row, wrapping around. */
export function moveActive(controller: EditorController, delta: number): void {
  const state = controller.menu.get();
  if (!state || state.flat.length === 0) return;
  const count = state.flat.length;
  controller.menu.set({ ...state, active: (state.active + delta + count) % count });
}

/**
 * Connects a TipTap `Suggestion` to the editor's menu store: the React menu renders the store, and
 * the keyboard (arrows, Enter, Tab, Escape) is handled here while the menu is open.
 */
export function suggestionRenderer<T extends MenuItem>(
  controller: EditorController,
  pluginKey: PluginKey,
  build: (props: SuggestionProps<T, T>) => MenuBase<T>,
): NonNullable<SuggestionOptions<T, T>['render']> {
  return () => {
    const update = (props: SuggestionProps<T, T>, reset: boolean) => {
      const base = build(props);
      const previous = controller.menu.get();
      const keep = !reset && previous?.kind === base.kind && previous.query === base.query;
      const active = keep ? Math.min(previous.active, Math.max(0, base.flat.length - 1)) : 0;
      controller.menu.set({
        ...base,
        active,
        getRect: props.clientRect ?? null,
        select: (item) => props.command(item as T),
      } as SuggestionMenuState);
    };
    return {
      onStart: (props) => update(props, true),
      onUpdate: (props) => update(props, props.query !== controller.menu.get()?.query),
      onKeyDown: ({ event, view }) => {
        const state = controller.menu.get();
        if (!state) return false;
        switch (event.key) {
          case 'ArrowDown':
            moveActive(controller, 1);
            return true;
          case 'ArrowUp':
            moveActive(controller, -1);
            return true;
          case 'Home':
          case 'End':
            if (!state.flat.length) return false;
            controller.menu.set({
              ...state,
              active: event.key === 'Home' ? 0 : state.flat.length - 1,
            });
            return true;
          case 'Enter':
          case 'Tab': {
            const item = state.flat[state.active];
            if (!item) {
              exitSuggestion(view, pluginKey);
              controller.menu.set(null);
              return event.key === 'Tab';
            }
            state.select(item);
            return true;
          }
          case 'Escape':
            exitSuggestion(view, pluginKey);
            controller.menu.set(null);
            return true;
          default:
            return false;
        }
      },
      onExit: () => controller.menu.set(null),
    };
  };
}
