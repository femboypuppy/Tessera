import type { Random } from './random';
import { MONTHS, PEOPLE, WEEKDAYS, type Topic } from './words';

/** Upper-cases the first letter. */
export function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Fills a template's placeholders from a topic (see words.ts). Two different people and two
 * different nouns are used when a template asks for both.
 */
export function fill(template: string, rng: Random, topic: Topic): string {
  const noun = rng.pick(topic.nouns);
  const nouns = topic.nouns.filter((candidate) => candidate !== noun);
  const person = rng.pick(PEOPLE);
  const people = PEOPLE.filter((candidate) => candidate !== person);
  const values: Record<string, () => string> = {
    noun: () => noun,
    Noun: () => capitalize(noun),
    noun2: () => rng.pick(nouns.length ? nouns : topic.nouns),
    adj: () => rng.pick(topic.adjectives),
    verb: () => rng.pick(topic.verbs),
    proper: () => rng.pick(topic.properNouns),
    person: () => person,
    person2: () => rng.pick(people),
    weekday: () => rng.pick(WEEKDAYS),
    month: () => rng.pick(MONTHS),
    number: () => String(rng.pick([2, 3, 4, 5, 7, 8, 12, 14, 20, 24, 30, 42, 60, 90, 120])),
    percent: () => `${rng.int(2, 19) * 5}%`,
    time: () => `${String(rng.int(6, 22)).padStart(2, '0')}:${rng.pick(['00', '15', '30', '45'])}`,
  };
  return template.replace(/\{(\w+)\}/g, (match, name: string) => values[name]?.() ?? match);
}

/** A sentence from a template: filled and capitalized. */
export function sentence(template: string, rng: Random, topic: Topic): string {
  return capitalize(fill(template, rng, topic));
}
