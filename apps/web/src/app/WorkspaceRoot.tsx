import {
  toError,
  type AppRuntime,
  type OnboardingActionContribution,
  type WorkspaceInfo,
  type WorkspaceSession,
} from '@tessera/core';
import { AppContextProvider } from '@tessera/core/react';
import { toast } from '@tessera/ui';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useNavigate } from 'react-router';
import { t } from '../i18n';
import { FullScreenLoading } from './FullScreenLoading';
import { AppLayout } from './AppLayout';
import { createShellBridge } from './bridge';
import { FatalErrorScreen } from './FatalError';
import { Onboarding } from './Onboarding';

/** Workspace-level controls for the shell (switcher, settings, onboarding). */
export interface WorkspaceControl {
  runtime: AppRuntime;
  workspaces: WorkspaceInfo[];
  current: WorkspaceInfo | null;
  switchTo(id: string): void;
  /** Creates a workspace and opens it; runs `action` once it is open (onboarding actions). */
  create(name: string, action?: OnboardingActionContribution): Promise<void>;
  rename(id: string, name: string): Promise<void>;
  remove(id: string): Promise<void>;
}

const WorkspaceControlContext = createContext<WorkspaceControl | null>(null);

export function useWorkspaceControl(): WorkspaceControl {
  const control = useContext(WorkspaceControlContext);
  if (!control) throw new Error('useWorkspaceControl must be used inside WorkspaceRoot');
  return control;
}

type Phase =
  | { kind: 'loading' }
  | { kind: 'onboarding' }
  | { kind: 'ready'; session: WorkspaceSession }
  | { kind: 'failed'; error: Error };

/**
 * Picks the workspace to open (the most recent one), opens its session, and shows onboarding when
 * there is none. Switching workspaces closes the old session first.
 */
export function WorkspaceRoot({ runtime }: { runtime: AppRuntime }) {
  const navigate = useNavigate();
  const bridge = useMemo(() => createShellBridge(), []);
  useLayoutEffect(() => {
    bridge.setNavigate((to, options) => {
      void navigate(to, options);
    });
  }, [bridge, navigate]);

  const [workspaces, setWorkspaces] = useState<WorkspaceInfo[] | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const pendingAction = useRef<OnboardingActionContribution | null>(null);
  const sessionRef = useRef<WorkspaceSession | null>(null);

  useEffect(() => {
    let active = true;
    const registry = runtime.workspaceRegistry;
    void registry.list().then((list) => {
      if (!active) return;
      setWorkspaces(list);
      const first = list[0];
      if (first) setActiveId((current) => current ?? first.id);
      else setPhase({ kind: 'onboarding' });
    });
    const off = registry.subscribe((list) => {
      if (active) setWorkspaces(list);
    });
    return () => {
      active = false;
      off();
    };
  }, [runtime]);

  useEffect(() => {
    if (!activeId) return undefined;
    let cancelled = false;
    let session: WorkspaceSession | null = null;
    setPhase({ kind: 'loading' });
    void (async () => {
      try {
        const info = await runtime.workspaceRegistry.open(activeId);
        const opened = await runtime.openWorkspace(info, bridge);
        if (cancelled) {
          await opened.close();
          return;
        }
        session = opened;
        sessionRef.current = opened;
        for (const [featureId, error] of opened.featureErrors) {
          toast({
            variant: 'error',
            title: t('featureFailedToStart', { feature: featureId }),
            description: error.message,
          });
        }
        setPhase({ kind: 'ready', session: opened });
        const action = pendingAction.current;
        pendingAction.current = null;
        if (action) {
          try {
            await action.run(opened.ctx);
          } catch (error) {
            toast({
              variant: 'error',
              title: t('onboardingActionFailed', { message: toError(error).message }),
            });
          }
        }
      } catch (error) {
        if (!cancelled) setPhase({ kind: 'failed', error: toError(error) });
      }
    })();
    return () => {
      cancelled = true;
      if (session) {
        if (sessionRef.current === session) sessionRef.current = null;
        void session.close();
      }
    };
  }, [activeId, runtime, bridge]);

  const switchTo = useCallback(
    (id: string) => {
      if (id === activeId) return;
      void navigate('/');
      setActiveId(id);
    },
    [activeId, navigate],
  );

  const control = useMemo<WorkspaceControl>(
    () => ({
      runtime,
      workspaces: workspaces ?? [],
      current: workspaces?.find((ws) => ws.id === activeId) ?? null,
      switchTo,
      async create(name, action) {
        const ws = await runtime.workspaceRegistry.create({ name });
        pendingAction.current = action ?? null;
        void navigate('/');
        setActiveId(ws.id);
      },
      async rename(id, name) {
        await runtime.workspaceRegistry.rename(id, name);
      },
      async remove(id) {
        // Close the open session first, so its storage is released before its data is deleted.
        if (id === activeId) {
          setPhase({ kind: 'loading' });
          await sessionRef.current?.close();
        }
        await runtime.workspaceRegistry.remove(id);
        const list = await runtime.workspaceRegistry.list();
        void navigate('/');
        const next = list[0];
        if (next) setActiveId(next.id);
        else {
          setActiveId(null);
          setPhase({ kind: 'onboarding' });
        }
      },
    }),
    [runtime, workspaces, activeId, switchTo, navigate],
  );

  let content;
  if (phase.kind === 'failed') content = <FatalErrorScreen error={phase.error} />;
  else if (phase.kind === 'onboarding') content = <Onboarding />;
  else if (phase.kind === 'loading') content = <FullScreenLoading />;
  else {
    content = (
      <AppContextProvider value={phase.session.ctx}>
        <AppLayout />
      </AppContextProvider>
    );
  }
  return (
    <WorkspaceControlContext.Provider value={control}>{content}</WorkspaceControlContext.Provider>
  );
}
