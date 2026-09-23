import { isHttpUrl } from '@tessera/core';

/** A site Tessera can embed in a sandboxed iframe. */
export interface EmbedProvider {
  id: 'youtube' | 'vimeo' | 'loom' | 'figma' | 'codepen';
  name: string;
  /** Builds the iframe URL from the page URL, or null when the URL isn't embeddable. */
  embedUrl(url: URL): string | null;
  /** Width / height, or a fixed height in CSS pixels. */
  aspect: number | null;
  height: number | null;
}

const YOUTUBE_ID = /^[A-Za-z0-9_-]{6,20}$/;

function youtubeStart(url: URL): number | null {
  const raw = url.searchParams.get('t') ?? url.searchParams.get('start');
  if (!raw) return null;
  const match = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/.exec(raw);
  if (!match) return null;
  const seconds = Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0);
  return seconds > 0 ? seconds : null;
}

function hostIs(url: URL, ...hosts: string[]): boolean {
  const host = url.hostname.toLowerCase();
  return hosts.some((candidate) => host === candidate || host.endsWith(`.${candidate}`));
}

/**
 * The allowlist of embeddable providers. Iframes only ever load URLs these functions build from
 * validated IDs, never the pasted URL itself.
 */
export const EMBED_PROVIDERS: readonly EmbedProvider[] = [
  {
    id: 'youtube',
    name: 'YouTube',
    aspect: 16 / 9,
    height: null,
    embedUrl(url) {
      let id: string | null = null;
      if (hostIs(url, 'youtu.be')) id = url.pathname.slice(1).split('/')[0] ?? null;
      else if (hostIs(url, 'youtube.com', 'youtube-nocookie.com')) {
        if (url.pathname === '/watch') id = url.searchParams.get('v');
        else {
          const match = /^\/(?:embed|shorts|live|v)\/([^/?#]+)/.exec(url.pathname);
          id = match?.[1] ?? null;
        }
      }
      if (!id || !YOUTUBE_ID.test(id)) return null;
      const start = youtubeStart(url);
      return `https://www.youtube-nocookie.com/embed/${id}${start ? `?start=${start}` : ''}`;
    },
  },
  {
    id: 'vimeo',
    name: 'Vimeo',
    aspect: 16 / 9,
    height: null,
    embedUrl(url) {
      if (!hostIs(url, 'vimeo.com')) return null;
      const match = /^\/(?:video\/)?(\d{5,12})(?:\/([0-9a-f]{6,20}))?/.exec(url.pathname);
      if (!match?.[1]) return null;
      const hash = match[2] ?? url.searchParams.get('h');
      const hashParam = hash && /^[0-9a-f]{6,20}$/.test(hash) ? `?h=${hash}` : '';
      return `https://player.vimeo.com/video/${match[1]}${hashParam}`;
    },
  },
  {
    id: 'loom',
    name: 'Loom',
    aspect: 16 / 9,
    height: null,
    embedUrl(url) {
      if (!hostIs(url, 'loom.com')) return null;
      const match = /^\/(?:share|embed)\/([0-9a-f]{16,64})/.exec(url.pathname);
      return match?.[1] ? `https://www.loom.com/embed/${match[1]}` : null;
    },
  },
  {
    id: 'figma',
    name: 'Figma',
    aspect: null,
    height: 460,
    embedUrl(url) {
      if (!hostIs(url, 'figma.com')) return null;
      if (!/^\/(?:file|design|proto|board|slides|deck)\/[A-Za-z0-9]{10,64}/.test(url.pathname))
        return null;
      const clean = `https://www.figma.com${url.pathname}${url.search}`;
      return `https://www.figma.com/embed?embed_host=tessera&url=${encodeURIComponent(clean)}`;
    },
  },
  {
    id: 'codepen',
    name: 'CodePen',
    aspect: null,
    height: 420,
    embedUrl(url) {
      if (!hostIs(url, 'codepen.io')) return null;
      const match =
        /^\/([A-Za-z0-9_-]{1,64})\/(?:pen|embed|full|details)\/([A-Za-z0-9]{3,20})/.exec(
          url.pathname,
        );
      if (!match?.[1] || !match[2]) return null;
      return `https://codepen.io/${match[1]}/embed/${match[2]}?default-tab=result`;
    },
  },
];

/** The provider and iframe URL for a link, or null when it isn't embeddable (use a bookmark). */
export function resolveEmbed(
  href: string | null | undefined,
): { provider: EmbedProvider; src: string } | null {
  if (!isHttpUrl(href)) return null;
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  for (const provider of EMBED_PROVIDERS) {
    const src = provider.embedUrl(url);
    if (src) return { provider, src };
  }
  return null;
}

/** The host name shown on bookmark cards (`www.` removed). */
export function displayHost(href: string): string {
  try {
    return new URL(href).hostname.replace(/^www\./, '');
  } catch {
    return href;
  }
}

/** Normalizes what the user typed into an http(s) URL (adds `https://` to bare domains). */
export function normalizeUrlInput(input: string): string | null {
  const value = input.trim();
  if (!value || /\s/.test(value)) return null;
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`;
  if (!isHttpUrl(candidate)) return null;
  try {
    const url = new URL(candidate);
    return url.hostname.includes('.') || url.hostname === 'localhost' ? url.toString() : null;
  } catch {
    return null;
  }
}
