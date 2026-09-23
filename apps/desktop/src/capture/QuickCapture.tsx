import { toError } from '@tessera/core';
import { useAppContext } from '@tessera/core/react';
import { Button, Textarea } from '@tessera/ui';
import { Check, Inbox, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { t } from '../i18n';
import { getBackend } from '../runtime';
import { appendToInbox, INBOX_SETTING } from './inbox';

type Phase = { kind: 'editing' } | { kind: 'saving' } | { kind: 'saved'; page: string };

/**
 * The quick-capture window (`/capture`, a bare route in its own always-on-top window). Enter
 * appends the text to the Inbox page and puts the window away; Escape puts it away and keeps the
 * draft for next time.
 */
export default function QuickCapture() {
  const ctx = useAppContext();
  const backend = getBackend();
  const [text, setText] = useState('');
  const [phase, setPhase] = useState<Phase>({ kind: 'editing' });
  const [error, setError] = useState<string | null>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const inboxId = ctx.settings.workspace.get(INBOX_SETTING);
  const inbox = typeof inboxId === 'string' ? ctx.workspace.getPage(inboxId) : undefined;
  const inboxTitle = inbox?.title || t('inboxTitle');

  const focus = useCallback(() => {
    const element = field.current;
    if (!element) return;
    element.focus();
    element.setSelectionRange(element.value.length, element.value.length);
  }, []);

  useEffect(() => {
    // Tell Rust the page is ready: it shows the (initially hidden) window then.
    void backend.captureReady().catch(() => undefined);
    focus();
    return backend.onCaptureShown(() => {
      setPhase({ kind: 'editing' });
      setError(null);
      focus();
    });
  }, [backend, focus]);

  const hide = () => {
    void backend.hideCapture().catch(() => undefined);
  };

  const save = async () => {
    if (!text.trim() || phase.kind === 'saving') return;
    setPhase({ kind: 'saving' });
    setError(null);
    try {
      const page = await appendToInbox(ctx, text);
      setText('');
      setPhase({ kind: 'saved', page: page.title || t('inboxTitle') });
      window.setTimeout(hide, 450);
    } catch (err) {
      setPhase({ kind: 'editing' });
      setError(t('captureFailed', { message: toError(err).message }));
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      hide();
    } else if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void save();
    }
  };

  return (
    <main className="flex h-dvh flex-col overflow-hidden border border-border bg-surface text-fg">
      <header
        data-tauri-drag-region=""
        className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-4 select-none"
      >
        <Inbox className="size-4 text-accent-text" aria-hidden="true" />
        <h1 data-tauri-drag-region="" className="text-sm font-semibold">
          {t('captureTitle')}
        </h1>
        <span data-tauri-drag-region="" className="ml-auto truncate text-xs text-fg-subtle">
          {t('captureInto', { page: inboxTitle, workspace: ctx.workspace.info.name })}
        </span>
        <button
          type="button"
          onClick={hide}
          aria-label={t('close')}
          className="duration-fast -mr-1.5 inline-flex size-7 items-center justify-center rounded-md text-fg-muted transition-colors outline-none hover:bg-hover hover:text-fg focus-visible:ring-2 focus-visible:ring-focus"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
        <Textarea
          ref={field}
          aria-label={t('captureTitle')}
          placeholder={t('capturePlaceholder')}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onKeyDown}
          disabled={phase.kind === 'saving'}
          className="min-h-0 flex-1 resize-none border-transparent bg-transparent px-0 text-base shadow-none hover:border-transparent focus-visible:border-transparent focus-visible:ring-0"
        />
        {error ? (
          <p role="alert" className="text-ui text-danger-text">
            {error}
          </p>
        ) : null}
        <footer className="flex items-center justify-between gap-3">
          <p className="hidden truncate text-xs text-fg-subtle sm:block">{t('captureHint')}</p>
          {phase.kind === 'saved' ? (
            <p role="status" className="flex items-center gap-1.5 text-ui text-success-text">
              <Check className="size-4" aria-hidden="true" />
              {t('captureSaved', { page: phase.page })}
            </p>
          ) : (
            <Button
              variant="primary"
              size="sm"
              onClick={() => void save()}
              loading={phase.kind === 'saving'}
              disabled={!text.trim()}
            >
              {t('captureSave')}
            </Button>
          )}
        </footer>
      </div>
    </main>
  );
}
