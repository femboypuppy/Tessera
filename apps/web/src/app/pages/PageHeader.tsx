import { type PageCover, type PageMeta } from '@tessera/core';
import { useAppContext } from '@tessera/core/react';
import {
  Button,
  cn,
  COVER_PRESETS,
  coverPresetBackground,
  EmojiPicker,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Spinner,
} from '@tessera/ui';
import { ImageIcon, SmilePlus } from 'lucide-react';
import {
  lazy,
  Suspense,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { t } from '../../i18n';

/** The mounted title field, so the `shell.focusTitle` command and page bodies can focus it. */
let activeTitle: HTMLTextAreaElement | null = null;

/** Focuses the current page's title, with the caret at the start or the end. */
export function focusPageTitle(position: 'start' | 'end' = 'end'): void {
  if (!activeTitle) return;
  activeTitle.focus();
  const at = position === 'start' ? 0 : activeTitle.value.length;
  activeTitle.setSelectionRange(at, at);
}

function useCoverUrl(cover: PageCover | undefined): string | null {
  const ctx = useAppContext();
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    if (cover?.kind === 'asset') {
      void ctx.services.assetStore.getUrl(cover.value).then((value) => {
        if (active) setUrl(value);
      });
    } else {
      setUrl(cover?.kind === 'url' && /^https:\/\//i.test(cover.value) ? cover.value : null);
    }
    return () => {
      active = false;
    };
  }, [ctx, cover?.kind, cover?.value]);
  return url;
}

// The picker's tabs and gallery load when it opens (Radix Tabs stays out of the startup bundle).
const CoverPickerContent = lazy(() => import('./CoverPickerContent'));

function CoverPicker({ page, children }: { page: PageMeta; children: ReactNode }) {
  const ctx = useAppContext();
  const [open, setOpen] = useState(false);
  const setCover = (cover: PageCover | null) => {
    ctx.workspace.setCover(page.id, cover);
    setOpen(false);
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className="w-[22rem] p-0" align="end">
        <Suspense
          fallback={
            <div className="flex h-44 items-center justify-center">
              <Spinner size="sm" />
            </div>
          }
        >
          <CoverPickerContent page={page} setCover={setCover} />
        </Suspense>
      </PopoverContent>
    </Popover>
  );
}

/** The page cover band, if the page has one. */
export function PageCoverBand({ page, readOnly }: { page: PageMeta; readOnly: boolean }) {
  const url = useCoverUrl(page.cover);
  if (!page.cover) return null;
  const background =
    page.cover.kind === 'preset' ? coverPresetBackground(page.cover.value) : undefined;
  return (
    <div
      className="group/cover relative h-[clamp(8rem,28vh,15rem)] w-full overflow-hidden bg-bg-subtle"
      style={{ background }}
    >
      {url ? (
        <img
          src={url}
          alt=""
          className="size-full object-cover"
          style={{ objectPosition: `center ${page.cover.positionY ?? 50}%` }}
          draggable={false}
        />
      ) : null}
      {!readOnly ? (
        <div className="duration-fast absolute right-4 bottom-3 opacity-0 transition-opacity group-hover/cover:opacity-100 focus-within:opacity-100">
          <CoverPicker page={page}>
            <Button size="sm" className="bg-surface/90 backdrop-blur">
              <ImageIcon aria-hidden="true" />
              {t('changeCover')}
            </Button>
          </CoverPicker>
        </div>
      ) : null}
    </div>
  );
}

function IconPicker({ page, children }: { page: PageMeta; children: ReactNode }) {
  const ctx = useAppContext();
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className="p-0">
        <EmojiPicker
          onSelect={(emoji) => {
            ctx.workspace.setIcon(page.id, emoji);
            setOpen(false);
          }}
          onRemove={
            page.icon
              ? () => {
                  ctx.workspace.setIcon(page.id, null);
                  setOpen(false);
                }
              : undefined
          }
        />
      </PopoverContent>
    </Popover>
  );
}

/**
 * The page header: icon, "Add icon"/"Add cover" controls, and the title (bound to
 * `PageMeta.title`). Enter or ArrowDown at the end of the title moves into the body.
 */
export function PageHeader({
  page,
  readOnly,
  onFocusBody,
  autoFocusTitle,
}: {
  page: PageMeta;
  readOnly: boolean;
  onFocusBody: (position: 'start' | 'end') => boolean;
  autoFocusTitle: boolean;
}) {
  const ctx = useAppContext();
  const titleRef = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const element = titleRef.current;
    if (!element) return;
    element.style.height = '0px';
    element.style.height = `${element.scrollHeight}px`;
  }, [page.title]);

  useEffect(() => {
    const element = titleRef.current;
    activeTitle = element;
    return () => {
      if (activeTitle === element) activeTitle = null;
    };
  }, []);

  useEffect(() => {
    if (autoFocusTitle) focusPageTitle('end');
  }, [autoFocusTitle, page.id]);

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return;
    const element = event.currentTarget;
    const atEnd =
      element.selectionStart === element.value.length &&
      element.selectionEnd === element.value.length;
    if (event.key === 'Enter' || (event.key === 'ArrowDown' && atEnd)) {
      event.preventDefault();
      onFocusBody('start');
    }
  };

  return (
    <header className={cn('group/header', page.cover ? 'pt-0' : 'pt-12 md:pt-20')}>
      {page.icon ? (
        <div className={cn('mb-2', page.cover && '-mt-10')}>
          {readOnly ? (
            <span className="text-[4.5rem] leading-none" role="img" aria-label={page.icon}>
              {page.icon}
            </span>
          ) : (
            <IconPicker page={page}>
              <button
                type="button"
                aria-label={t('changeIcon')}
                className="duration-fast relative rounded-lg p-1 text-[4.5rem] leading-none transition-colors hover:bg-hover"
              >
                {page.icon}
              </button>
            </IconPicker>
          )}
        </div>
      ) : page.cover ? (
        <div className="h-6" />
      ) : null}
      {!readOnly && (!page.icon || !page.cover) ? (
        <div className="duration-fast mb-1 flex h-7 items-center gap-1 opacity-0 transition-opacity group-hover/header:opacity-100 focus-within:opacity-100">
          {!page.icon ? (
            <IconPicker page={page}>
              <Button variant="ghost" size="sm">
                <SmilePlus aria-hidden="true" />
                {t('addIcon')}
              </Button>
            </IconPicker>
          ) : null}
          {!page.cover ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                const names = Object.keys(COVER_PRESETS);
                const name = names[Math.floor(Math.random() * names.length)] ?? 'aurora';
                ctx.workspace.setCover(page.id, { kind: 'preset', value: name });
              }}
            >
              <ImageIcon aria-hidden="true" />
              {t('addCover')}
            </Button>
          ) : null}
        </div>
      ) : null}
      <textarea
        ref={titleRef}
        rows={1}
        value={page.title}
        readOnly={readOnly}
        placeholder={t('untitled')}
        aria-label={t('pageTitle')}
        spellCheck
        onChange={(event) => ctx.workspace.renamePage(page.id, event.target.value)}
        onKeyDown={onKeyDown}
        className="block w-full resize-none overflow-hidden bg-transparent text-[2.5rem] leading-[1.2] font-bold tracking-tight text-fg outline-none placeholder:text-fg-disabled"
      />
    </header>
  );
}
