import { AlertTriangle, Copy, RotateCcw } from 'lucide-react';
import { Component, useState, type ErrorInfo, type ReactNode } from 'react';
import { tUi } from '../i18n/index';
import { cn } from '../lib/cn';
import { Button } from './button';

interface ErrorBoundaryProps {
  /** Renders instead of the children after an error. */
  fallback: (error: Error, reset: () => void) => ReactNode;
  onError?: (error: Error, info: ErrorInfo) => void;
  /** When any value changes, the boundary resets (for example the page ID). */
  resetKeys?: readonly unknown[];
  children?: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
  keys: readonly unknown[] | undefined;
}

/** Catches render errors in its subtree. */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null, keys: this.props.resetKeys };

  static getDerivedStateFromError(error: unknown): Partial<ErrorBoundaryState> {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  static getDerivedStateFromProps(
    props: ErrorBoundaryProps,
    state: ErrorBoundaryState,
  ): Partial<ErrorBoundaryState> | null {
    const keys = props.resetKeys;
    const changed =
      state.keys !== keys &&
      (keys?.length !== state.keys?.length ||
        (keys ?? []).some((key, index) => !Object.is(key, state.keys?.[index])));
    return changed ? { error: null, keys } : null;
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    this.props.onError?.(error, info);
  }

  reset = (): void => {
    this.setState({ error: null });
  };

  override render(): ReactNode {
    if (this.state.error) return this.props.fallback(this.state.error, this.reset);
    return this.props.children;
  }
}

/** Formats an error for bug reports. */
export function describeError(error: Error, context: Record<string, string> = {}): string {
  const lines = [`${error.name}: ${error.message}`];
  for (const [key, value] of Object.entries(context)) lines.push(`${key}: ${value}`);
  if (typeof navigator !== 'undefined') lines.push(`User agent: ${navigator.userAgent}`);
  if (error.stack) lines.push('', error.stack);
  return lines.join('\n');
}

function CopyDetailsButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      size="sm"
      variant="ghost"
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => setCopied(true));
      }}
    >
      <Copy aria-hidden="true" />
      {copied ? tUi('copied') : tUi('copyDetails')}
    </Button>
  );
}

/** The fallback shown when a feature's component crashes. */
export function FeatureErrorFallback({
  error,
  featureId,
  reset,
  className,
}: {
  error: Error;
  featureId: string;
  reset: () => void;
  className?: string;
}) {
  return (
    <div role="alert" className={cn('rounded-lg border border-border bg-bg-subtle p-4', className)}>
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning-text" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-fg">{tUi('featureCrashedTitle')}</p>
          <p className="mt-0.5 text-ui text-fg-muted">
            {tUi('featureCrashedDescription', { feature: featureId })}
          </p>
          <p className="mt-2 truncate font-mono text-xs text-fg-subtle" title={error.message}>
            {error.message}
          </p>
          <div className="mt-3 flex flex-wrap gap-1">
            <Button size="sm" onClick={reset}>
              <RotateCcw aria-hidden="true" />
              {tUi('retry')}
            </Button>
            <CopyDetailsButton text={describeError(error, { Feature: featureId })} />
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Wraps a feature's component so a crash stays contained. The shell wraps every contributed
 * component in one; the editor wraps every embed renderer.
 *
 * @example
 * <FeatureBoundary featureId="databases" resetKeys={[pageId]}><DatabaseView /></FeatureBoundary>
 */
export function FeatureBoundary({
  featureId,
  children,
  resetKeys,
  className,
  onError,
}: {
  featureId: string;
  children?: ReactNode;
  resetKeys?: readonly unknown[];
  className?: string;
  onError?: (error: Error, info: ErrorInfo) => void;
}) {
  return (
    <ErrorBoundary
      resetKeys={resetKeys}
      onError={(error, info) => {
        console.error(`[${featureId}] crashed`, error, info.componentStack);
        onError?.(error, info);
      }}
      fallback={(error, reset) => (
        <FeatureErrorFallback
          error={error}
          featureId={featureId}
          reset={reset}
          className={className}
        />
      )}
    >
      {children}
    </ErrorBoundary>
  );
}
