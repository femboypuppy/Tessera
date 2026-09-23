import { createContext, useContext } from 'react';
import type { EditorController } from './controller';

/** The controller of the editor a component belongs to (menus, React node views). */
export const EditorControllerContext = createContext<EditorController | null>(null);

/** The current editor's controller. Throws outside an editor. */
export function useEditorController(): EditorController {
  const controller = useContext(EditorControllerContext);
  if (!controller) throw new Error('useEditorController must be used inside the page editor');
  return controller;
}
