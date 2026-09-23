/**
 * Lints every workflow in `.github/workflows` with actionlint (https://github.com/rhysd/actionlint).
 * Downloads the pinned release once, verifies its SHA-256 checksum and caches it in
 * `node_modules/.cache/actionlint`. actionlint also runs shellcheck on `run:` scripts when
 * `shellcheck` is on the PATH (GitHub's Ubuntu runners have it).
 *
 *   node scripts/ci/actionlint.ts            # lint all workflows
 *   node scripts/ci/actionlint.ts -verbose   # extra arguments go to actionlint
 *
 * `ACTIONLINT_PATH=/path/to/actionlint` uses an installed binary instead.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const ACTIONLINT_VERSION = '1.7.12';

/** SHA-256 of each release archive, from the release's `actionlint_<version>_checksums.txt`. */
export const ACTIONLINT_CHECKSUMS: Readonly<Record<string, string>> = {
  'darwin_amd64.tar.gz': '5b44c3bc2255115c9b69e30efc0fecdf498fdb63c5d58e17084fd5f16324c644',
  'darwin_arm64.tar.gz': 'aba9ced2dee8d27fecca3dc7feb1a7f9a52caefa1eb46f3271ea66b6e0e6953f',
  'linux_amd64.tar.gz': '8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8',
  'linux_arm64.tar.gz': '325e971b6ba9bfa504672e29be93c24981eeb1c07576d730e9f7c8805afff0c6',
  'windows_amd64.zip': '6e7241b51e6817ea6a047693d8e6fed13b31819c9a0dd6c5a726e1592d22f6e9',
  'windows_arm64.zip': 'cadcf7ea4efe3a68728893813643cebe1185e5b1d4be5b96245f65c9a4d5ea41',
};

/** The release archive for a platform (`process.platform`, `process.arch`), or null. */
export function archiveFor(platform: string, arch: string): string | null {
  const os = platform === 'win32' ? 'windows' : platform;
  const cpu = arch === 'x64' ? 'amd64' : arch;
  const name = `${os}_${cpu}.${os === 'windows' ? 'zip' : 'tar.gz'}`;
  return name in ACTIONLINT_CHECKSUMS ? name : null;
}

async function ensureBinary(root: string): Promise<string> {
  const archive = archiveFor(process.platform, process.arch);
  if (!archive) throw new Error(`No actionlint build for ${process.platform}/${process.arch}.`);
  const dir = path.join(root, 'node_modules', '.cache', 'actionlint', ACTIONLINT_VERSION);
  const binary = path.join(dir, process.platform === 'win32' ? 'actionlint.exe' : 'actionlint');
  if (existsSync(binary)) return binary;

  const file = `actionlint_${ACTIONLINT_VERSION}_${archive}`;
  const url = `https://github.com/rhysd/actionlint/releases/download/v${ACTIONLINT_VERSION}/${file}`;
  console.info(`Downloading ${url}`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed: ${response.status} ${response.statusText}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const digest = createHash('sha256').update(bytes).digest('hex');
  if (digest !== ACTIONLINT_CHECKSUMS[archive]) {
    throw new Error(
      `Checksum mismatch for ${file}: expected ${ACTIONLINT_CHECKSUMS[archive]}, got ${digest}`,
    );
  }
  mkdirSync(dir, { recursive: true });
  const archivePath = path.join(dir, file);
  writeFileSync(archivePath, bytes);
  // Windows ships bsdtar (which reads zip files) in System32; Git Bash's GNU tar comes first on
  // the PATH there and can't, so name it explicitly.
  const tar =
    process.platform === 'win32'
      ? path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')
      : 'tar';
  const extract = spawnSync(tar, ['-xf', archivePath, '-C', dir], { stdio: 'inherit' });
  rmSync(archivePath, { force: true });
  if (extract.status !== 0 || !existsSync(binary)) throw new Error(`Could not extract ${file}`);
  if (process.platform !== 'win32') chmodSync(binary, 0o755);
  return binary;
}

function hasShellcheck(): boolean {
  return spawnSync('shellcheck', ['--version'], { stdio: 'ignore' }).status === 0;
}

async function main(): Promise<number> {
  const root = path.resolve(import.meta.dirname, '..', '..');
  const binary = process.env.ACTIONLINT_PATH ?? (await ensureBinary(root));
  if (!hasShellcheck()) {
    console.info('shellcheck is not installed, so `run:` scripts are not checked this time.');
  }
  const args = process.argv.slice(2);
  const result = spawnSync(binary, process.stdout.isTTY ? ['-color', ...args] : args, {
    cwd: root,
    stdio: 'inherit',
  });
  if (result.status === 0)
    console.info(`actionlint ${ACTIONLINT_VERSION}: every workflow is valid.`);
  return result.status ?? 1;
}

if (import.meta.main) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    },
  );
}
