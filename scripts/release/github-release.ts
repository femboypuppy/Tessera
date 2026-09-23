/**
 * GitHub Release steps for `.github/workflows/release.yml`. Plain Node (no install needed).
 *
 *   node scripts/release/github-release.ts verify-version --tag v0.1.0
 *   node scripts/release/github-release.ts draft --tag v0.1.0 --notes release-notes.md
 *   node scripts/release/github-release.ts checksums --release-id 123
 *   node scripts/release/github-release.ts publish --release-id 123
 *
 * The API commands read GITHUB_TOKEN, GITHUB_REPOSITORY and GITHUB_API_URL (set in Actions).
 * `draft` writes `id=<release id>` to $GITHUB_OUTPUT.
 */
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { parseArgs } from 'node:util';

export const CHECKSUMS_FILE = 'SHA256SUMS.txt';

/** `v1.2.3` → `1.2.3`; throws for tags that aren't `v` + semver. */
export function versionFromTag(tag: string): string {
  const match = /^v(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)$/.exec(tag);
  if (!match?.[1]) throw new Error(`"${tag}" is not a release tag like v1.2.3 or v1.2.3-beta.1.`);
  return match[1];
}

/** Pre-releases have a `-` suffix (`v0.2.0-beta.1`). */
export function isPrerelease(tag: string): boolean {
  return versionFromTag(tag).split('+')[0]?.includes('-') ?? false;
}

/**
 * Checks that the tag matches the desktop app's version (its bundles and updater manifest use
 * it). Returns problems as messages; an empty list means the tag is fine.
 */
export function verifyVersion(tag: string, root: string): { errors: string[]; notes: string[] } {
  const version = versionFromTag(tag);
  const errors: string[] = [];
  const notes: string[] = [];
  const tauriConfig = path.join(root, 'apps/desktop/src-tauri/tauri.conf.json');
  if (existsSync(tauriConfig)) {
    const config = JSON.parse(readFileSync(tauriConfig, 'utf8')) as { version?: unknown };
    if (config.version !== version) {
      errors.push(
        `apps/desktop/src-tauri/tauri.conf.json has version "${String(config.version)}", but the tag is ${tag}. Update it, commit, and tag again.`,
      );
    }
  } else {
    notes.push('No apps/desktop/src-tauri/tauri.conf.json; skipped the desktop version check.');
  }
  const rootPackage = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as {
    version?: unknown;
  };
  if (rootPackage.version !== version) {
    notes.push(`package.json has version "${String(rootPackage.version)}" (the tag is ${tag}).`);
  }
  return { errors, notes };
}

export interface ReleaseAsset {
  id: number;
  name: string;
  size: number;
}

export interface Release {
  id: number;
  tag_name: string;
  draft: boolean;
  prerelease: boolean;
  upload_url: string;
}

/** `<sha256>  <name>` lines, sorted by name, like `sha256sum`. */
export function formatChecksums(entries: ReadonlyArray<{ name: string; sha256: string }>): string {
  return `${[...entries]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((entry) => `${entry.sha256}  ${entry.name}`)
    .join('\n')}\n`;
}

type Fetch = typeof fetch;

interface ClientOptions {
  token: string;
  /** `owner/name`. */
  repo: string;
  apiUrl?: string;
  fetch?: Fetch;
}

/** The few GitHub REST calls a release needs. */
export class GitHubReleases {
  // A plain field, not a parameter property: Node's type stripping doesn't support those.
  private readonly options: ClientOptions;

  constructor(options: ClientOptions) {
    this.options = options;
  }

  private get fetchImpl(): Fetch {
    return this.options.fetch ?? fetch;
  }

  private async request(url: string, init: RequestInit = {}): Promise<Response> {
    const full =
      url.startsWith('https://') || url.startsWith('http://')
        ? url
        : `${this.options.apiUrl ?? 'https://api.github.com'}${url}`;
    const response = await this.fetchImpl(full, {
      ...init,
      headers: {
        authorization: `Bearer ${this.options.token}`,
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        ...(init.headers as Record<string, string> | undefined),
      },
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(
        `${init.method ?? 'GET'} ${full}: ${response.status} ${detail.slice(0, 500)}`,
      );
    }
    return response;
  }

  private async json<T>(url: string, init?: RequestInit): Promise<T> {
    return (await (await this.request(url, init)).json()) as T;
  }

  /** Every release (drafts included, which the "by tag" endpoint doesn't return). */
  async listReleases(): Promise<Release[]> {
    const releases: Release[] = [];
    for (let page = 1; ; page += 1) {
      const batch = await this.json<Release[]>(
        `/repos/${this.options.repo}/releases?per_page=100&page=${page}`,
      );
      releases.push(...batch);
      if (batch.length < 100) return releases;
    }
  }

  /** Creates the draft for `tag`, or updates the notes of an existing draft. */
  async draft(tag: string, notes: string): Promise<Release> {
    const existing = (await this.listReleases()).find((release) => release.tag_name === tag);
    if (existing && !existing.draft) {
      throw new Error(`The release for ${tag} is already published; delete it or use a new tag.`);
    }
    if (existing) {
      return this.json<Release>(`/repos/${this.options.repo}/releases/${existing.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ body: notes }),
      });
    }
    return this.json<Release>(`/repos/${this.options.repo}/releases`, {
      method: 'POST',
      body: JSON.stringify({
        tag_name: tag,
        name: `Tessera ${tag}`,
        body: notes,
        draft: true,
        prerelease: isPrerelease(tag),
      }),
    });
  }

  async getRelease(id: string): Promise<Release> {
    return this.json<Release>(`/repos/${this.options.repo}/releases/${id}`);
  }

  async listAssets(id: string): Promise<ReleaseAsset[]> {
    const assets: ReleaseAsset[] = [];
    for (let page = 1; ; page += 1) {
      const batch = await this.json<ReleaseAsset[]>(
        `/repos/${this.options.repo}/releases/${id}/assets?per_page=100&page=${page}`,
      );
      assets.push(...batch);
      if (batch.length < 100) return assets;
    }
  }

  /** Streams an asset through SHA-256 (assets can be hundreds of megabytes). */
  async sha256(asset: ReleaseAsset): Promise<string> {
    const response = await this.request(`/repos/${this.options.repo}/releases/assets/${asset.id}`, {
      headers: { accept: 'application/octet-stream' },
    });
    if (!response.body) throw new Error(`Empty download for ${asset.name}`);
    const hash = createHash('sha256');
    for await (const chunk of Readable.fromWeb(response.body as WebReadableStream<Uint8Array>)) {
      hash.update(chunk as Uint8Array);
    }
    return hash.digest('hex');
  }

  /** Computes SHA256SUMS.txt over every other asset and (re)uploads it. Returns its contents. */
  async uploadChecksums(id: string): Promise<string> {
    const release = await this.getRelease(id);
    const assets = await this.listAssets(id);
    const entries: Array<{ name: string; sha256: string }> = [];
    for (const asset of assets) {
      if (asset.name === CHECKSUMS_FILE) continue;
      entries.push({ name: asset.name, sha256: await this.sha256(asset) });
    }
    const text = formatChecksums(entries);
    const previous = assets.find((asset) => asset.name === CHECKSUMS_FILE);
    if (previous) {
      await this.request(`/repos/${this.options.repo}/releases/assets/${previous.id}`, {
        method: 'DELETE',
      });
    }
    const uploadUrl = release.upload_url.replace(/\{.*\}$/, '');
    await this.request(`${uploadUrl}?name=${encodeURIComponent(CHECKSUMS_FILE)}`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain; charset=utf-8' },
      body: text,
    });
    return text;
  }

  /** Publishes a draft; stable releases become "latest". */
  async publish(id: string): Promise<Release> {
    const release = await this.getRelease(id);
    return this.json<Release>(`/repos/${this.options.repo}/releases/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ draft: false, make_latest: release.prerelease ? 'false' : 'true' }),
    });
  }
}

function client(): GitHubReleases {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY;
  if (!token || !repo) throw new Error('GITHUB_TOKEN and GITHUB_REPOSITORY must be set.');
  return new GitHubReleases({ token, repo, apiUrl: process.env.GITHUB_API_URL });
}

async function main(): Promise<number> {
  const [command, ...rest] = process.argv.slice(2);
  const { values } = parseArgs({
    args: rest,
    options: {
      tag: { type: 'string' },
      notes: { type: 'string' },
      'release-id': { type: 'string' },
    },
  });
  const root = path.resolve(import.meta.dirname, '..', '..');
  switch (command) {
    case 'verify-version': {
      const { errors, notes } = verifyVersion(values.tag ?? '', root);
      for (const note of notes) console.info(note);
      for (const error of errors) console.error(`error: ${error}`);
      if (!errors.length) console.info(`${values.tag} matches the app version.`);
      return errors.length ? 1 : 0;
    }
    case 'draft': {
      const tag = values.tag ?? '';
      versionFromTag(tag);
      const notes = values.notes ? readFileSync(values.notes, 'utf8') : '';
      const release = await client().draft(tag, notes);
      console.info(`Draft release ${release.id} for ${tag}.`);
      if (process.env.GITHUB_OUTPUT)
        appendFileSync(process.env.GITHUB_OUTPUT, `id=${release.id}\n`);
      return 0;
    }
    case 'checksums': {
      const text = await client().uploadChecksums(values['release-id'] ?? '');
      process.stdout.write(text);
      return 0;
    }
    case 'publish': {
      const release = await client().publish(values['release-id'] ?? '');
      console.info(`Published ${release.tag_name}.`);
      return 0;
    }
    default:
      console.error('Usage: github-release.ts verify-version|draft|checksums|publish [options]');
      return 2;
  }
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
