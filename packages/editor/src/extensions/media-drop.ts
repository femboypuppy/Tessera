import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { insertImageFiles, isImageFile } from '../actions/media';
import type { EditorController } from '../react/controller';

export const mediaDropKey = new PluginKey('tesseraMediaDrop');

function imageFiles(data: DataTransfer | null): File[] {
  return [...(data?.files ?? [])].filter(isImageFile);
}

/**
 * Pasting or dropping image files stores them in the `AssetStore` and inserts image blocks (at
 * the caret, or where they were dropped).
 */
export function mediaDrop(controller: EditorController) {
  return Extension.create({
    name: 'mediaDrop',
    addProseMirrorPlugins() {
      return [
        new Plugin({
          key: mediaDropKey,
          props: {
            handlePaste(view, event) {
              const files = imageFiles(event.clipboardData);
              if (!files.length || !controller.isEditable()) return false;
              event.preventDefault();
              void insertImageFiles(controller, files, view.state.selection.from);
              return true;
            },
            handleDrop(view, event, _slice, moved) {
              if (moved) return false;
              const files = imageFiles(event.dataTransfer);
              if (!files.length || !controller.isEditable()) return false;
              event.preventDefault();
              const coords = view.posAtCoords({ left: event.clientX, top: event.clientY });
              const at = coords ? coords.pos : view.state.selection.from;
              void insertImageFiles(controller, files, at);
              return true;
            },
          },
        }),
      ];
    },
  });
}
