/**
 * Languages offered by the code block's language picker. `id` is what the document stores (a
 * lowercase highlight.js name or alias); the grammars load lazily with lowlight's `common` set.
 */
export const CODE_LANGUAGES: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'bash', label: 'Bash' },
  { id: 'c', label: 'C' },
  { id: 'cpp', label: 'C++' },
  { id: 'csharp', label: 'C#' },
  { id: 'css', label: 'CSS' },
  { id: 'diff', label: 'Diff' },
  { id: 'go', label: 'Go' },
  { id: 'graphql', label: 'GraphQL' },
  { id: 'html', label: 'HTML' },
  { id: 'ini', label: 'INI / TOML' },
  { id: 'java', label: 'Java' },
  { id: 'javascript', label: 'JavaScript' },
  { id: 'json', label: 'JSON' },
  { id: 'kotlin', label: 'Kotlin' },
  { id: 'less', label: 'Less' },
  { id: 'lua', label: 'Lua' },
  { id: 'makefile', label: 'Makefile' },
  { id: 'markdown', label: 'Markdown' },
  { id: 'objectivec', label: 'Objective-C' },
  { id: 'perl', label: 'Perl' },
  { id: 'php', label: 'PHP' },
  { id: 'python', label: 'Python' },
  { id: 'r', label: 'R' },
  { id: 'ruby', label: 'Ruby' },
  { id: 'rust', label: 'Rust' },
  { id: 'scss', label: 'SCSS' },
  { id: 'shell', label: 'Shell session' },
  { id: 'sql', label: 'SQL' },
  { id: 'swift', label: 'Swift' },
  { id: 'typescript', label: 'TypeScript' },
  { id: 'xml', label: 'XML' },
  { id: 'yaml', label: 'YAML' },
];

const ALIASES: Readonly<Record<string, string>> = {
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  py: 'python',
  rb: 'ruby',
  rs: 'rust',
  sh: 'bash',
  zsh: 'bash',
  console: 'shell',
  yml: 'yaml',
  md: 'markdown',
  toml: 'ini',
  htm: 'html',
  'c++': 'cpp',
  'c#': 'csharp',
  cs: 'csharp',
  kt: 'kotlin',
  golang: 'go',
  objc: 'objectivec',
};

/** The display name of a stored language (`typescript` → `TypeScript`), or the id itself. */
export function languageLabel(id: string | null | undefined): string | null {
  if (!id) return null;
  const canonical = ALIASES[id] ?? id;
  return CODE_LANGUAGES.find((language) => language.id === canonical)?.label ?? id;
}
