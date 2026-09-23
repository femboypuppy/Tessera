import type { AppContext, EditorExtensionContribution } from '@tessera/core';
import type { AnyExtension } from '@tiptap/core';

function isBehaviorExtension(value: unknown): value is AnyExtension {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as { type?: unknown; name?: unknown; config?: unknown };
  return (
    candidate.type === 'extension' &&
    typeof candidate.name === 'string' &&
    typeof candidate.config === 'object'
  );
}

/**
 * Builds the TipTap extensions other features contribute (`editorExtensions`). Each `create`
 * must return a behavior-only `Extension`: nodes and marks are rejected because the schema is
 * fixed by `@tessera/core`. A contribution that throws or returns something else is skipped with
 * a warning, so one broken feature never breaks the editor.
 */
export function contributedExtensions(
  contributions: ReadonlyArray<EditorExtensionContribution & { featureId?: string }>,
  ctx: AppContext,
): AnyExtension[] {
  const result: AnyExtension[] = [];
  for (const contribution of contributions) {
    try {
      const extension = contribution.create(ctx);
      if (!isBehaviorExtension(extension)) {
        console.warn(
          `[editor] Ignoring editor extension "${contribution.id}"${contribution.featureId ? ` from "${contribution.featureId}"` : ''}: it must be a TipTap Extension (nodes and marks are not allowed).`,
        );
        continue;
      }
      result.push(
        contribution.priority === undefined
          ? extension
          : extension.extend({ priority: contribution.priority }),
      );
    } catch (error) {
      console.warn(`[editor] Editor extension "${contribution.id}" failed to load`, error);
    }
  }
  return result;
}
