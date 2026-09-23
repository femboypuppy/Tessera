import type { AppRuntime } from '@tessera/core';
import { ConfirmHost, Toaster, TooltipProvider } from '@tessera/ui';
import { lazy, Suspense } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router';
import { AppErrorBoundary } from './FatalError';
import { FullScreenLoading } from './FullScreenLoading';
import { WorkspaceRoot } from './WorkspaceRoot';

const DevUiView = lazy(() =>
  import('./dev/DevUiView').then((module) => ({ default: module.DevUiView })),
);

/** The application root: providers, the hidden `/dev/ui` gallery, and the workspace app. */
export function App({ runtime }: { runtime: AppRuntime }) {
  return (
    <AppErrorBoundary>
      <TooltipProvider>
        {/* No transitions: a navigation must render in the same pass as the document change that
         * caused it. With them, creating a page from `/` re-renders the home view first, and its
         * redirect replaces the new page's history entry (losing the "focus the title" state). */}
        <BrowserRouter useTransitions={false}>
          <Routes>
            <Route
              path="/dev/ui"
              element={
                <Suspense fallback={<FullScreenLoading />}>
                  <DevUiView />
                </Suspense>
              }
            />
            <Route path="*" element={<WorkspaceRoot runtime={runtime} />} />
          </Routes>
        </BrowserRouter>
        <Toaster />
        <ConfirmHost />
      </TooltipProvider>
    </AppErrorBoundary>
  );
}
