import type { GenerateOptions } from '../src/generator';

/**
 * Generator options from the harness URL:
 * `?seed=42&pages=5000&databases=3&rows=20&large=2000&trashed=2&links=3&depth=5`.
 * Unknown or invalid values fall back to the generator's defaults.
 */
export function optionsFromSearch(search: string): GenerateOptions {
  const params = new URLSearchParams(search);
  const whole = (name: string): number | undefined => {
    const raw = params.get(name);
    if (raw === null || raw === '') return undefined;
    const value = Number(raw);
    return Number.isInteger(value) && value >= 0 ? value : undefined;
  };
  const options: GenerateOptions = {};
  const seed = params.get('seed');
  if (seed) options.seed = /^\d+$/.test(seed) ? Number(seed) : seed;
  const pages = whole('pages');
  if (pages !== undefined) options.pages = pages;
  const databases = whole('databases');
  if (databases !== undefined) options.databases = databases;
  const rows = whole('rows');
  if (rows !== undefined) options.rowsPerDatabase = rows;
  const trashed = whole('trashed');
  if (trashed !== undefined) options.trashed = trashed;
  const depth = whole('depth');
  if (depth !== undefined) options.maxDepth = depth;
  const links = Number(params.get('links'));
  if (params.has('links') && Number.isFinite(links) && links >= 0) options.linksPerPage = links;
  const large = (params.get('large') ?? '')
    .split(',')
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value > 0);
  if (large.length) options.largePages = large;
  return options;
}
