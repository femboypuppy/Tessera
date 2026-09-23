/** Lowercases and strips accents, so "résumé" matches "resume". */
export function foldText(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase();
}

function isWordStart(text: string, index: number): boolean {
  if (index === 0) return true;
  const previous = text[index - 1] ?? ' ';
  return /[\s\-_/.,:;()[\]]/.test(previous);
}

/** Scores one query token against a text (both folded). Higher is better; null when no match. */
function tokenScore(token: string, text: string): number | null {
  if (!token) return 0;
  if (text === token) return 1000;
  if (text.startsWith(token)) return 800 + Math.round((token.length / text.length) * 100);
  // A word starting with the token ("list" in "bulleted list").
  let index = text.indexOf(token);
  while (index >= 0) {
    if (isWordStart(text, index)) return 600;
    index = text.indexOf(token, index + 1);
  }
  const substring = text.indexOf(token);
  if (substring >= 0) return 400 - Math.min(substring, 100);
  // Characters in order ("hdg" → "heading"), rewarding word starts and runs.
  let score = 100;
  let position = 0;
  let previous = -2;
  for (const char of token) {
    const found = text.indexOf(char, position);
    if (found < 0) return null;
    if (found === previous + 1) score += 6;
    if (isWordStart(text, found)) score += 8;
    score -= Math.min(found - position, 10);
    previous = found;
    position = found + 1;
  }
  return Math.max(score, 1);
}

/**
 * Scores how well a query matches a text, or returns null. Every whitespace-separated query token
 * must match (exact > prefix > word start > substring > characters in order).
 *
 * @example
 * fuzzyScore('head 2', 'Heading 2'); // a high score
 * fuzzyScore('xyz', 'Heading 2'); // null
 */
export function fuzzyScore(query: string, text: string): number | null {
  const tokens = foldText(query).trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return 0;
  const folded = foldText(text);
  let total = 0;
  for (const token of tokens) {
    const score = tokenScore(token, folded);
    if (score === null) return null;
    total += score;
  }
  // Whole-query matches rank above token-by-token ones.
  if (tokens.length > 1) {
    const whole = tokenScore(tokens.join(' '), folded);
    if (whole !== null) total += whole;
  }
  return total;
}

/** Something a menu can filter: a title and optional keywords. */
export interface Rankable {
  id: string;
  title: string;
  keywords?: readonly string[];
}

/** The best score of an item: its title, or (slightly less) one of its keywords. */
export function itemScore(query: string, item: Rankable): number | null {
  let best = fuzzyScore(query, item.title);
  for (const keyword of item.keywords ?? []) {
    const score = fuzzyScore(query, keyword);
    if (score !== null) {
      const weighted = Math.round(score * 0.9);
      if (best === null || weighted > best) best = weighted;
    }
  }
  return best;
}

/**
 * Filters and ranks items for a query: best score first, then the most recently used, then the
 * original order. With an empty query the order is kept, recently used items first.
 *
 * @param recent - Item IDs, most recent first.
 */
export function rankItems<T extends Rankable>(
  items: readonly T[],
  query: string,
  recent: readonly string[] = [],
): T[] {
  const recency = (item: T) => {
    const index = recent.indexOf(item.id);
    return index < 0 ? Number.POSITIVE_INFINITY : index;
  };
  const scored = items
    .map((item, index) => ({ item, index, score: query.trim() ? itemScore(query, item) : 0 }))
    .filter((entry): entry is { item: T; index: number; score: number } => entry.score !== null);
  scored.sort(
    (a, b) => b.score - a.score || recency(a.item) - recency(b.item) || a.index - b.index,
  );
  return scored.map((entry) => entry.item);
}

/** Adds an ID to the front of a most-recent-first list (deduplicated, capped). */
export function pushRecent(list: readonly string[], id: string, max = 8): string[] {
  return [id, ...list.filter((existing) => existing !== id)].slice(0, max);
}
