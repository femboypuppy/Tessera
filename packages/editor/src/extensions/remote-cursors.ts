import { colorForId, type SyncHandle } from '@tessera/core';
import { readableTextColor } from '@tessera/ui';
import type { Editor } from '@tiptap/core';
import { yCursorPlugin, yCursorPluginKey } from '@tiptap/y-tiptap';
import { t } from '../i18n';

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

interface RemoteUser {
  name?: unknown;
  color?: unknown;
  id?: unknown;
}

/** A peer's color, validated (awareness data comes from other clients). */
export function remoteColor(user: RemoteUser, clientId: number): string {
  if (typeof user.color === 'string' && HEX_COLOR.test(user.color)) return user.color;
  return colorForId(typeof user.id === 'string' ? user.id : String(clientId));
}

/** A peer's name, trimmed to a sensible length (text only, never HTML). */
export function remoteName(user: RemoteUser): string {
  const name = typeof user.name === 'string' ? user.name.trim() : '';
  return name ? name.slice(0, 40) : t('anonymousUser');
}

/** The caret of a collaborator: a colored bar with their name above it. */
export function buildRemoteCaret(user: RemoteUser, clientId: number): HTMLElement {
  const color = remoteColor(user, clientId);
  const caret = document.createElement('span');
  caret.className = 'tess-remote-caret';
  caret.style.setProperty('--tess-remote-color', color);
  caret.setAttribute('aria-hidden', 'true');
  const label = document.createElement('span');
  label.className = 'tess-remote-label';
  label.textContent = remoteName(user);
  // White or near-black, whichever contrasts more with the presence color (as avatars do).
  label.style.color = readableTextColor(color);
  caret.append(document.createTextNode('⁠'), label, document.createTextNode('⁠'));
  return caret;
}

/** The selection highlight of a collaborator. */
export function buildRemoteSelection(user: RemoteUser, clientId: number) {
  return {
    class: 'tess-remote-selection',
    style: `background-color: ${remoteColor(user, clientId)}33`,
  };
}

/**
 * Shows collaborators' carets and selections (and shares this user's) while a sync provider is
 * connected, following its status: local-only documents show nothing and publish nothing.
 * Returns a cleanup function.
 */
export function watchRemoteCursors(editor: Editor, sync: SyncHandle): () => void {
  let installed = false;
  const install = () => {
    if (installed || editor.isDestroyed) return;
    editor.registerPlugin(
      yCursorPlugin(sync.awareness, {
        cursorBuilder: buildRemoteCaret,
        selectionBuilder: buildRemoteSelection,
      }),
    );
    installed = true;
  };
  const uninstall = () => {
    if (!installed) return;
    installed = false;
    if (!editor.isDestroyed) editor.unregisterPlugin(yCursorPluginKey);
    // Stop advertising a caret nobody should see.
    if (sync.awareness.getLocalState()?.cursor != null)
      sync.awareness.setLocalStateField('cursor', null);
  };
  const follow = (status: { status: string }) => {
    if (status.status === 'local') uninstall();
    else install();
  };
  follow(sync.getStatus());
  const stop = sync.onStatus(follow);
  return () => {
    stop();
    uninstall();
  };
}
