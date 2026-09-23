/**
 * React test helpers: render a feature component with every provider the shell gives it (the
 * app context, tooltips, a router, toasts and confirmations), on an in-memory or seeded
 * workspace. Use in jsdom tests with `@tessera/core/testing/setup-dom`.
 *
 * @example
 * const { findByText, ctx, dispose } = await renderWithApp(<BacklinksPanel pageId={id} />, { seed: { pages: 50 } });
 * await dispose();
 */
import type { AppContext, FeatureModule } from '@tessera/core';
import { AppContextProvider } from '@tessera/core/react';
import { createTestAppContext, type TestAppContext } from '@tessera/core/testing';
import { ConfirmHost, Toaster, TooltipProvider } from '@tessera/ui';
import { render, type RenderOptions, type RenderResult } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { createSeededAppContext, type SeededAppContextOptions } from '../runtime/runtime';

export interface AppProvidersProps {
  ctx: AppContext;
  /** The router's initial path. Default `/`. */
  path?: string;
  children?: ReactNode;
}

/** The providers the app shell puts around every feature component. */
export function AppProviders({ ctx, path = '/', children }: AppProvidersProps) {
  return (
    <AppContextProvider value={ctx}>
      <TooltipProvider>
        <MemoryRouter initialEntries={[path]}>{children}</MemoryRouter>
        <Toaster />
        <ConfirmHost />
      </TooltipProvider>
    </AppContextProvider>
  );
}

export interface RenderWithAppOptions {
  /** Render against this context instead of creating one. */
  context?: TestAppContext;
  /** Features for a new in-memory context (ignored with `context`). */
  features?: FeatureModule[];
  /** Open a generated workspace instead of an empty one (ignored with `context`). */
  seed?: SeededAppContextOptions;
  /** The router's initial path. */
  path?: string;
  render?: Omit<RenderOptions, 'wrapper'>;
}

export type RenderWithAppResult = RenderResult &
  TestAppContext & {
    /** Unmounts, then closes the workspace and the runtime (unless the context was passed in). */
    dispose(): Promise<void>;
  };

/** Renders `ui` inside {@link AppProviders} on an in-memory (or seeded) workspace. */
export async function renderWithApp(
  ui: ReactElement,
  options: RenderWithAppOptions = {},
): Promise<RenderWithAppResult> {
  const owned = !options.context;
  const context =
    options.context ??
    (options.seed
      ? await createSeededAppContext({
          ...options.seed,
          features: options.features ?? options.seed.features,
        })
      : await createTestAppContext({ features: options.features ?? [] }));
  const result = render(ui, {
    ...options.render,
    wrapper: ({ children }: { children: ReactNode }) => (
      <AppProviders ctx={context.ctx} path={options.path}>
        {children}
      </AppProviders>
    ),
  });
  return {
    ...result,
    ...context,
    dispose: async () => {
      result.unmount();
      if (owned) await context.dispose();
    },
  };
}
