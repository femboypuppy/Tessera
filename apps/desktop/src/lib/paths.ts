import { t } from '../i18n';

/** Shows paths under the home folder as `~/…` (with the platform's separator kept). */
export function displayPath(path: string, home: string | null): string {
  if (!path) return '';
  if (home && (path === home || path.startsWith(`${home}/`) || path.startsWith(`${home}\\`)))
    return `~${path.slice(home.length)}`;
  return path;
}

/** Joins a folder and a name with the separator the folder already uses. */
export function joinPath(folder: string, name: string): string {
  const separator = folder.includes('\\') && !folder.includes('/') ? '\\' : '/';
  return `${folder.replace(/[\\/]+$/, '')}${separator}${name}`;
}

/** The folder a path is in. */
export function parentPath(path: string): string {
  return path.replace(/[\\/]+$/, '').replace(/[\\/][^\\/]*$/, '');
}

/** "Reveal in Finder", "Show in Explorer" or "Show in file manager". */
export function revealLabel(os: string): string {
  if (os === 'mac' || os === 'macos') return t('revealInFinder');
  if (os === 'windows') return t('revealInExplorer');
  return t('revealInFiles');
}
