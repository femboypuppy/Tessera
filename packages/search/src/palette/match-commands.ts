import type { Command } from '@tessera/core';
import { normalizeTerm, tokenize } from '../engine/text';

/**
 * Commands matching a query: every query word must start a word of the title or keywords.
 * Earlier and title-start matches rank higher.
 *
 * @example
 * matchCommands(commands, 'tog th'); // [Toggle theme]
 */
export function matchCommands(commands: readonly Command[], query: string): Command[] {
  const terms = tokenize(query).map(normalizeTerm).filter(Boolean);
  if (terms.length === 0) return [...commands];
  const phrase = terms.join(' ');
  const scored: Array<{ command: Command; score: number }> = [];
  for (const command of commands) {
    const titleWords = tokenize(command.title).map(normalizeTerm);
    const words = [...titleWords, ...(command.keywords ?? []).flatMap(tokenize).map(normalizeTerm)];
    let score = 0;
    let matched = true;
    for (const term of terms) {
      const index = words.findIndex((word) => word.startsWith(term));
      if (index < 0) {
        matched = false;
        break;
      }
      score += index === 0 ? 4 : index < titleWords.length ? 2 : 1;
    }
    if (!matched) continue;
    if (titleWords.join(' ').startsWith(phrase)) score += 6;
    scored.push({ command, score });
  }
  return scored
    .sort((a, b) => b.score - a.score || a.command.title.localeCompare(b.command.title))
    .map(({ command }) => command);
}
