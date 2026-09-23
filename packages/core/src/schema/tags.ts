/**
 * Tag names follow Obsidian's rules so imported vaults keep their tags: letters, digits, `_`, `-`
 * and `/` (nested tags like `project/alpha`), at least one character that is not a digit or `/`,
 * no leading, trailing or double `/`, at most 100 characters. Stored without `#`.
 */
export const TAG_NAME_PATTERN = /^[\p{L}\p{M}\p{N}_/-]+$/u;

/** Returns true when `name` (without `#`) is a valid tag name. */
export function isValidTagName(name: unknown): name is string {
  return (
    typeof name === 'string' &&
    name.length > 0 &&
    name.length <= 100 &&
    TAG_NAME_PATTERN.test(name) &&
    /[^\p{N}/]/u.test(name) &&
    !name.startsWith('/') &&
    !name.endsWith('/') &&
    !name.includes('//')
  );
}

/**
 * Normalizes user or imported input into a tag name (strips one leading `#`, trims, NFC), or
 * returns null when it is not a valid tag.
 *
 * @example
 * normalizeTagName('#Project/Alpha'); // 'Project/Alpha'
 * normalizeTagName('#1984'); // null
 */
export function normalizeTagName(input: string): string | null {
  const name = input.trim().replace(/^#/, '').normalize('NFC');
  return isValidTagName(name) ? name : null;
}

/**
 * Comparison key for tags: tags are case-insensitive (`#Project` and `#project` are the same tag),
 * but the first spelling is kept for display.
 */
export function tagKey(name: string): string {
  return name.normalize('NFC').toLowerCase();
}

/**
 * The tag and its ancestors for nested tags, outermost first.
 *
 * @example
 * tagHierarchy('area/work/q3'); // ['area', 'area/work', 'area/work/q3']
 */
export function tagHierarchy(name: string): string[] {
  const parts = name.split('/');
  return parts.map((_, index) => parts.slice(0, index + 1).join('/'));
}
