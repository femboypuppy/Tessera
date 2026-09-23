/**
 * Built-in page covers. `PageMeta.cover = { kind: 'preset', value: '<name>' }` refers to one of
 * these; unknown names fall back to `aurora`.
 */
export const COVER_PRESETS: Readonly<Record<string, string>> = {
  aurora: 'linear-gradient(135deg, #5b5bd6 0%, #8e4ec6 55%, #d6409f 100%)',
  lagoon: 'linear-gradient(135deg, #12a594 0%, #0090ff 100%)',
  dawn: 'linear-gradient(135deg, #ffc182 0%, #ff8fa3 100%)',
  meadow: 'linear-gradient(135deg, #46a758 0%, #b8e25f 100%)',
  dusk: 'linear-gradient(160deg, #1f2a44 0%, #4f4fb8 100%)',
  ember: 'linear-gradient(135deg, #f76b15 0%, #e5484d 100%)',
  sand: 'linear-gradient(135deg, #f3e6cf 0%, #d6b08a 100%)',
  slate: 'linear-gradient(135deg, #58606e 0%, #232830 100%)',
};

/** CSS `background` for a preset cover. */
export function coverPresetBackground(name: string): string {
  return COVER_PRESETS[name] ?? COVER_PRESETS.aurora ?? '#5b5bd6';
}
