import type { BlockRendererProps, JsonValue, WebEmbedData } from '@tessera/core';
import { cn } from '@tessera/ui';
import { ExternalLink, Globe } from 'lucide-react';
import { t } from '../i18n';
import { displayHost, resolveEmbed } from './providers';

function readData(data: JsonValue | null): Partial<WebEmbedData> {
  return data && typeof data === 'object' && !Array.isArray(data)
    ? (data as Partial<WebEmbedData>)
    : {};
}

function text(value: unknown, max = 300): string | null {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null;
}

/** A link card: title, description, host. Never loads anything from the linked site. */
function Bookmark({ href, data }: { href: string; data: Partial<WebEmbedData> }) {
  const title = text(data.title) ?? displayHost(href);
  const description = text(data.description);
  const siteName = text(data.siteName) ?? displayHost(href);
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer nofollow"
      className="tess-bookmark group/bookmark duration-fast flex min-h-[4.5rem] items-stretch overflow-hidden rounded-lg border border-border bg-surface no-underline transition-colors hover:bg-hover focus-visible:ring-2 focus-visible:ring-focus"
      aria-label={t('bookmarkLabel', { url: href })}
      draggable={false}
    >
      <span className="flex min-w-0 flex-1 flex-col justify-center gap-0.5 px-4 py-3">
        <span className="truncate text-sm font-medium text-fg">{title}</span>
        {description ? (
          <span className="line-clamp-2 text-ui text-fg-muted">{description}</span>
        ) : null}
        <span className="mt-1 flex min-w-0 items-center gap-1.5 text-2xs text-fg-subtle">
          <Globe className="size-3 flex-none" aria-hidden="true" />
          <span className="truncate">{siteName !== title ? siteName : href}</span>
        </span>
      </span>
      <span className="duration-fast flex w-10 flex-none items-center justify-center text-fg-subtle opacity-0 transition-opacity group-hover/bookmark:opacity-100 group-focus-visible/bookmark:opacity-100">
        <ExternalLink className="size-4" aria-hidden="true" />
      </span>
    </a>
  );
}

/**
 * Renders `embed` blocks of kind `web`: an allowlisted provider (YouTube, Vimeo, Loom, Figma,
 * CodePen) in a sandboxed iframe built from the parsed ID, or a bookmark card for anything else.
 */
export default function WebEmbed({ ref: href, data, selected }: BlockRendererProps) {
  if (!href) return null;
  const details = readData(data);
  const resolved = details.display === 'bookmark' ? null : resolveEmbed(href);
  if (!resolved) return <Bookmark href={href} data={details} />;
  const { provider, src } = resolved;
  const height =
    typeof details.height === 'number' && details.height >= 120 && details.height <= 1600
      ? details.height
      : provider.height;
  return (
    <figure className="tess-web-embed m-0">
      <div
        className={cn(
          'overflow-hidden rounded-lg border border-border bg-bg-subtle',
          selected && 'ring-2 ring-accent',
        )}
        style={
          provider.aspect && !details.height
            ? { aspectRatio: String(provider.aspect) }
            : { height: `${height ?? 400}px` }
        }
      >
        <iframe
          src={src}
          title={t('embedFrameTitle', { provider: provider.name })}
          className="block size-full border-0"
          loading="lazy"
          referrerPolicy="strict-origin-when-cross-origin"
          sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-presentation"
          allow="autoplay; encrypted-media; fullscreen; picture-in-picture; clipboard-write"
        />
      </div>
      <figcaption className="mt-1.5 flex items-center gap-1.5 text-2xs text-fg-subtle">
        <span>{provider.name}</span>
        <span aria-hidden="true">·</span>
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer nofollow"
          className="inline-flex min-w-0 items-center gap-1 truncate text-fg-subtle hover:text-fg focus-visible:ring-2 focus-visible:ring-focus"
        >
          <span className="truncate">{t('openOriginal', { provider: provider.name })}</span>
          <ExternalLink className="size-3 flex-none" aria-hidden="true" />
        </a>
      </figcaption>
    </figure>
  );
}
