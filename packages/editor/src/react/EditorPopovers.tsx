import { CALLOUT_TONES, type CalloutTone } from '@tessera/core';
import {
  Button,
  cn,
  EmojiPicker,
  Input,
  Popover,
  PopoverAnchor,
  PopoverContent,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@tessera/ui';
import type { Editor } from '@tiptap/core';
import { Check, Upload } from 'lucide-react';
import { useId, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { insertImageFiles, insertImageUrl, insertTable, insertWebEmbed } from '../actions/media';
import { CODE_LANGUAGES } from '../code/languages';
import { normalizeUrlInput, resolveEmbed } from '../embeds/providers';
import { t } from '../i18n';
import { rankItems } from '../menus/fuzzy';
import { parseCalloutTone } from '../schema/nodes/callout';
import type { EditorController, PopoverRequest } from './controller';
import { useStore } from './store';

type Close = (options?: { focusEditor?: boolean }) => void;

interface PanelProps<K extends PopoverRequest['kind']> {
  editor: Editor;
  controller: EditorController;
  request: Extract<PopoverRequest, { kind: K }>;
  close: Close;
}

const TONE_SWATCH: Record<CalloutTone, string> = {
  default: 'bg-tag-default-bg',
  info: 'bg-info-subtle',
  success: 'bg-success-subtle',
  warning: 'bg-warning-subtle',
  danger: 'bg-danger-subtle',
};

function CalloutPanel({ editor, request, close }: PanelProps<'callout'>) {
  const node = editor.state.doc.nodeAt(request.pos);
  const tone = parseCalloutTone(node?.attrs.tone);
  return (
    <div className="flex flex-col">
      <div
        className="flex items-center gap-1 border-b border-border px-3 py-2"
        role="group"
        aria-label={t('calloutStyle')}
      >
        {CALLOUT_TONES.map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={tone === value}
            aria-label={t(`tone_${value}`)}
            title={t(`tone_${value}`)}
            className={cn(
              'flex size-7 items-center justify-center rounded-md border border-border',
              TONE_SWATCH[value],
              tone === value && 'ring-2 ring-accent',
              'focus-visible:ring-2 focus-visible:ring-focus',
            )}
            onClick={() => editor.commands.updateCallout({ tone: value }, request.pos)}
          >
            {tone === value ? <Check className="size-3.5 text-fg" aria-hidden="true" /> : null}
          </button>
        ))}
      </div>
      <EmojiPicker
        onSelect={(emoji) => {
          editor.commands.updateCallout({ emoji }, request.pos);
          close();
        }}
      />
    </div>
  );
}

function LanguagePanel({ editor, request, close }: PanelProps<'codeLanguage'>) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listId = useId();
  const current = editor.state.doc.nodeAt(request.pos)?.attrs.language ?? null;
  const options = useMemo(() => {
    const all = [{ id: '', label: t('plainText') }, ...CODE_LANGUAGES];
    return rankItems(
      all.map((language) => ({ id: language.id, title: language.label, keywords: [language.id] })),
      query,
    );
  }, [query]);
  const choose = (id: string) => {
    const node = editor.state.doc.nodeAt(request.pos);
    if (node?.type.name === 'codeBlock') {
      editor.view.dispatch(editor.state.tr.setNodeAttribute(request.pos, 'language', id || null));
    }
    close();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      setActive((value) => (value + delta + options.length) % Math.max(options.length, 1));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const option = options[active];
      if (option) choose(option.id);
    }
  };
  return (
    <div className="flex w-56 flex-col gap-1">
      <Input
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setActive(0);
        }}
        onKeyDown={onKeyDown}
        placeholder={t('searchLanguages')}
        aria-label={t('codeLanguage')}
        role="combobox"
        aria-expanded="true"
        aria-controls={listId}
        aria-activedescendant={options[active] ? `${listId}-${active}` : undefined}
        autoComplete="off"
      />
      <div
        id={listId}
        role="listbox"
        aria-label={t('codeLanguage')}
        className="max-h-64 overflow-y-auto"
      >
        {options.map((option, index) => (
          // Keyboard selection goes through the search field (aria-activedescendant).
          // eslint-disable-next-line jsx-a11y/click-events-have-key-events -- see above
          <div
            key={option.id || 'plain'}
            id={`${listId}-${index}`}
            role="option"
            tabIndex={-1}
            aria-selected={index === active}
            className={cn(
              'flex h-8 cursor-default items-center justify-between rounded-md px-2 text-ui text-fg',
              index === active && 'bg-hover',
            )}
            onMouseMove={() => setActive(index)}
            onClick={() => choose(option.id)}
          >
            {option.title}
            {(current ?? '') === option.id ? (
              <Check className="size-3.5 text-accent-text" aria-hidden="true" />
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function AltTextPanel({ editor, request, close }: PanelProps<'imageAlt'>) {
  const node = editor.state.doc.nodeAt(request.pos);
  const [value, setValue] = useState(typeof node?.attrs.alt === 'string' ? node.attrs.alt : '');
  const save = (event?: FormEvent) => {
    event?.preventDefault();
    const current = editor.state.doc.nodeAt(request.pos);
    if (current?.type.name === 'image') {
      editor.view.dispatch(
        editor.state.tr.setNodeAttribute(request.pos, 'alt', value.trim().slice(0, 2000) || null),
      );
    }
    close();
  };
  return (
    <form className="flex w-72 flex-col gap-2" onSubmit={save}>
      <label className="text-ui font-medium text-fg" htmlFor="tess-image-alt">
        {t('imageAlt')}
      </label>
      <Input
        id="tess-image-alt"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder={t('imageAltPlaceholder')}
        maxLength={2000}
      />
      <div className="flex justify-end">
        <Button type="submit" size="sm" variant="primary">
          {t('imageAltSave')}
        </Button>
      </div>
    </form>
  );
}

function ImagePanel({ editor, controller, request, close }: PanelProps<'image'>) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submitUrl = (event: FormEvent) => {
    event.preventDefault();
    const normalized = normalizeUrlInput(url);
    if (
      !normalized ||
      !normalized.startsWith('https:') ||
      !insertImageUrl(editor, normalized, request.insertAt)
    ) {
      setError(t('imageInvalidUrl'));
      return;
    }
    close({ focusEditor: false });
  };
  return (
    <Tabs defaultValue="upload" className="w-80">
      <TabsList className="px-1">
        <TabsTrigger value="upload">{t('imageUpload')}</TabsTrigger>
        <TabsTrigger value="link">{t('imageLink')}</TabsTrigger>
      </TabsList>
      <TabsContent value="upload" className="flex flex-col gap-2 p-2">
        <input
          ref={fileInput}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp,image/avif"
          multiple
          className="sr-only"
          aria-label={t('imageChooseFile')}
          onChange={(event) => {
            const files = [...(event.target.files ?? [])];
            if (!files.length) return;
            setBusy(true);
            void insertImageFiles(controller, files, request.insertAt).then(() => {
              setBusy(false);
              close({ focusEditor: false });
            });
          }}
        />
        <Button variant="primary" disabled={busy} onClick={() => fileInput.current?.click()}>
          <Upload aria-hidden="true" />
          {busy ? t('imageUploading') : t('imageChooseFile')}
        </Button>
        <p className="text-center text-2xs text-fg-subtle">{t('imageDropHint')}</p>
      </TabsContent>
      <TabsContent value="link" className="p-2">
        <form className="flex flex-col gap-2" onSubmit={submitUrl}>
          <Input
            value={url}
            onChange={(event) => {
              setUrl(event.target.value);
              setError(null);
            }}
            placeholder={t('imageUrlPlaceholder')}
            aria-label={t('imageUrlPlaceholder')}
            aria-invalid={error ? true : undefined}
            inputMode="url"
          />
          {error ? <p className="text-2xs text-danger-text">{error}</p> : null}
          <Button type="submit" variant="primary">
            {t('imageEmbed')}
          </Button>
        </form>
      </TabsContent>
    </Tabs>
  );
}

const MAX_TABLE = 8;

function TablePanel({ editor, request, close }: PanelProps<'table'>) {
  const [size, setSize] = useState({ columns: 3, rows: 3 });
  const insert = (columns: number, rows: number) => {
    close({ focusEditor: false });
    insertTable(editor, rows, columns, request.insertAt);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const moves: Record<string, [number, number]> = {
      ArrowRight: [1, 0],
      ArrowLeft: [-1, 0],
      ArrowDown: [0, 1],
      ArrowUp: [0, -1],
    };
    const move = moves[event.key];
    if (move) {
      event.preventDefault();
      setSize(({ columns, rows }) => ({
        columns: Math.min(MAX_TABLE, Math.max(1, columns + move[0])),
        rows: Math.min(MAX_TABLE, Math.max(1, rows + move[1])),
      }));
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      insert(size.columns, size.rows);
    }
  };
  const label = t('tableSize', { columns: size.columns, rows: size.rows });
  return (
    <div className="flex flex-col items-center gap-2 p-1">
      <div
        role="grid"
        tabIndex={0}
        aria-label={`${t('insertTable')}: ${label}`}
        className="grid gap-1 rounded-md p-1 outline-none focus-visible:ring-2 focus-visible:ring-focus"
        style={{ gridTemplateColumns: `repeat(${MAX_TABLE}, 1rem)` }}
        onKeyDown={onKeyDown}
      >
        {Array.from({ length: MAX_TABLE * MAX_TABLE }, (_, index) => {
          const column = (index % MAX_TABLE) + 1;
          const row = Math.floor(index / MAX_TABLE) + 1;
          const selected = column <= size.columns && row <= size.rows;
          return (
            <button
              key={index}
              type="button"
              tabIndex={-1}
              aria-label={t('tableSize', { columns: column, rows: row })}
              className={cn(
                'size-4 rounded-[3px] border',
                selected ? 'border-accent bg-accent-subtle' : 'border-border bg-surface',
              )}
              onMouseEnter={() => setSize({ columns: column, rows: row })}
              onFocus={() => setSize({ columns: column, rows: row })}
              onClick={() => insert(column, row)}
            />
          );
        })}
      </div>
      <p className="text-ui text-fg-muted" aria-live="polite">
        {label}
      </p>
    </div>
  );
}

function WebEmbedPanel({ editor, request, close }: PanelProps<'webEmbed'>) {
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const normalized = normalizeUrlInput(url);
  const bookmarkInstead = request.display === 'embed' && normalized && !resolveEmbed(normalized);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!normalized) {
      setError(t('embedInvalidUrl'));
      return;
    }
    close({ focusEditor: false });
    insertWebEmbed(editor, normalized, request.display, request.insertAt);
    editor.view.focus();
  };
  const placeholder =
    request.display === 'embed' ? t('embedUrlPlaceholder') : t('bookmarkUrlPlaceholder');
  return (
    <form className="flex w-80 flex-col gap-2" onSubmit={submit}>
      <Input
        value={url}
        onChange={(event) => {
          setUrl(event.target.value);
          setError(null);
        }}
        placeholder={placeholder}
        aria-label={placeholder}
        aria-invalid={error ? true : undefined}
        inputMode="url"
      />
      {error ? <p className="text-2xs text-danger-text">{error}</p> : null}
      {bookmarkInstead ? <p className="text-2xs text-fg-subtle">{t('embedUnsupported')}</p> : null}
      <Button type="submit" variant="primary">
        {request.display === 'embed' ? t('embedSubmit') : t('bookmarkSubmit')}
      </Button>
    </form>
  );
}

function LinkPanel({ editor, request, close }: PanelProps<'link'>) {
  const [href, setHref] = useState(request.href ?? '');
  const [error, setError] = useState<string | null>(null);
  const apply = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = href.trim();
    const normalized = /^(mailto:|tel:|\/|#)/i.test(trimmed) ? trimmed : normalizeUrlInput(trimmed);
    if (!normalized) {
      setError(t('invalidLink'));
      return;
    }
    close({ focusEditor: false });
    editor
      .chain()
      .focus()
      .setTextSelection({ from: request.from, to: request.to })
      .extendMarkRange('link')
      .setLink({ href: normalized })
      .run();
  };
  const remove = () => {
    close({ focusEditor: false });
    editor
      .chain()
      .focus()
      .setTextSelection({ from: request.from, to: request.to })
      .extendMarkRange('link')
      .unsetLink()
      .run();
  };
  return (
    <form className="flex w-80 flex-col gap-2" onSubmit={apply}>
      <Input
        value={href}
        onChange={(event) => {
          setHref(event.target.value);
          setError(null);
        }}
        placeholder={t('linkPlaceholder')}
        aria-label={t('link')}
        aria-invalid={error ? true : undefined}
        inputMode="url"
      />
      {error ? <p className="text-2xs text-danger-text">{error}</p> : null}
      <div className="flex justify-end gap-2">
        {request.href ? (
          <Button type="button" size="sm" variant="ghost" onClick={remove}>
            {t('removeLink')}
          </Button>
        ) : null}
        <Button type="submit" size="sm" variant="primary">
          {t('applyLink')}
        </Button>
      </div>
    </form>
  );
}

function PanelFor({
  editor,
  controller,
  request,
  close,
}: Omit<PanelProps<PopoverRequest['kind']>, 'request'> & { request: PopoverRequest }) {
  switch (request.kind) {
    case 'callout':
      return (
        <CalloutPanel editor={editor} controller={controller} request={request} close={close} />
      );
    case 'codeLanguage':
      return (
        <LanguagePanel editor={editor} controller={controller} request={request} close={close} />
      );
    case 'imageAlt':
      return (
        <AltTextPanel editor={editor} controller={controller} request={request} close={close} />
      );
    case 'image':
      return <ImagePanel editor={editor} controller={controller} request={request} close={close} />;
    case 'table':
      return <TablePanel editor={editor} controller={controller} request={request} close={close} />;
    case 'webEmbed':
      return (
        <WebEmbedPanel editor={editor} controller={controller} request={request} close={close} />
      );
    case 'link':
      return <LinkPanel editor={editor} controller={controller} request={request} close={close} />;
  }
}

/**
 * Every anchored popover the editor opens (emoji and tone of a callout, code language, image alt
 * text and insertion, table size, web embeds, URL paste choices, link editing). One at a time,
 * anchored to an element or the caret, closed with Escape or a click outside.
 */
export function EditorPopovers({
  controller,
  editor,
}: {
  controller: EditorController;
  editor: Editor;
}) {
  const state = useStore(controller.popover);
  const anchorRef = useRef<{ getBoundingClientRect: () => DOMRect }>({
    getBoundingClientRect: () => new DOMRect(),
  });
  if (state) {
    const anchor = state.anchor;
    anchorRef.current = {
      getBoundingClientRect: () =>
        anchor instanceof HTMLElement ? anchor.getBoundingClientRect() : anchor,
    };
  }
  const close: Close = (options) => controller.closePopover(options);
  const padded = state?.request.kind !== 'callout';
  return (
    <Popover
      open={!!state}
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <PopoverAnchor virtualRef={anchorRef} />
      {state ? (
        <PopoverContent
          key={`${state.request.kind}`}
          className={cn(padded ? 'p-2' : 'p-0', 'tess-editor-popover')}
          data-popover={state.request.kind}
          align="start"
          onCloseAutoFocus={(event) => event.preventDefault()}
        >
          <PanelFor editor={editor} controller={controller} request={state.request} close={close} />
        </PopoverContent>
      ) : null}
    </Popover>
  );
}
