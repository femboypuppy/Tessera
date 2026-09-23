/** The person using this device. */
export interface CurrentUser {
  /** Stable per device (nanoid) until the sync feature signs in; then the account ID. */
  id: string;
  /** Display name for presence and "edited by" (the General settings section edits it). */
  name: string;
  /** Presence color: one of {@link USER_COLORS}. */
  color: string;
}

/**
 * Presence colors (cursor and avatar colors), chosen to be readable on both themes. The shell
 * picks one at random on first run; users change it in Settings → General.
 */
export const USER_COLORS = [
  '#e5484d',
  '#f76b15',
  '#ffc53d',
  '#46a758',
  '#12a594',
  '#0090ff',
  '#6e56cf',
  '#d6409f',
] as const;

/** Picks a presence color deterministically from an ID (for users who never chose one). */
export function colorForId(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return USER_COLORS[hash % USER_COLORS.length] ?? USER_COLORS[0];
}
