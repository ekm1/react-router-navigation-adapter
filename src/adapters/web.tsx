import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { __RouterContext } from 'react-router';
import {
  BrowserRouter,
  HashRouter,
  MemoryRouter,
  Router,
  useHistory,
  useLocation,
} from 'react-router-dom';
import type { Action, History, Location, LocationDescriptorObject } from 'history';
import { UniversalRouterContext } from '../context';
import {
  formatRelativeUrl,
  normalizeHash,
  parseQueryString,
  stringifyQueryParams,
} from '../pathUtils';
import { backAtRoot, mergeQuery, promptToGuard, resolveParamsUpdate, runGuard } from '../shared';
import type {
  BackAtRootContext,
  GetUserConfirmation,
  NavigationGuardAction,
  NavigationGuardCallback,
  NavigationListener,
  ResolvedNavigationIntent,
  RouteRegistry,
  RouterAdapter,
  RouterController,
  UnifiedRoute,
} from '../types';

export interface WebRouterProviderProps<TName extends string = string> {
  /** Shared route registry created via `defineRoutes(...)`. */
  routes: RouteRegistry<TName>;
  children: React.ReactNode;
  /** Optional custom `history` v4 instance (renders React Router v5 `<Router history={history}>`). */
  history?: History;
  /** Router implementation to mount when not reusing an existing React Router v5 context. Defaults to `'browser'`. */
  routerType?: 'browser' | 'hash' | 'memory';
  /** Base URL for BrowserRouter / HashRouter. */
  basename?: string;
  /** Initial URL entries when `routerType="memory"`. */
  initialEntries?: string[];
  /** Initial index when `routerType="memory"`. */
  initialIndex?: number;
  /** Confirmation for string guard prompts. Defaults to `window.confirm`. */
  getUserConfirmation?: GetUserConfirmation;
  /** Called by `goBack()` when there is no history entry to go back to. Defaults to the route's `parent`. */
  onBackAtRoot?: (ctx: BackAtRootContext) => void;
  /**
   * If true, attaches to an ancestor React Router v5 `<Router>` instead of mounting a new one.
   * When omitted, automatically reuses an ancestor router if neither `history` nor `routerType` is specified.
   */
  useExistingRouter?: boolean;
}

type GuardHandlerRef = React.MutableRefObject<string | NavigationGuardCallback | undefined>;

interface WebInternalState {
  canGoBack: () => boolean;
  /** Entries that `goBack()` can still reach. */
  depth: () => number;
  length: () => number;
  resetStack: (depth: number) => void;
  addGuard: (handler: GuardHandlerRef) => () => void;
  runGuards: (action: NavigationGuardAction, proceed: () => void, nextPath?: string) => boolean;
  bypassRef: React.MutableRefObject<boolean>;
  onBackAtRoot?: (ctx: BackAtRootContext) => void;
}

const WebInternalContext = createContext<WebInternalState | null>(null);

const GUARD_ACTIONS: Record<Action, NavigationGuardAction> = {
  PUSH: 'push',
  REPLACE: 'replace',
  POP: 'goBack',
};

const INITIAL_KEY = '__initial__';
/** History entry key; the browser's initial entry has none. */
const keyOf = (location: Location) => location.key ?? INITIAL_KEY;

function toUnifiedRoute<TName extends string>(
  location: Location,
  registry: RouteRegistry<TName>,
): UnifiedRoute<TName> {
  const query = parseQueryString(location.search);
  const hash = normalizeHash(location.hash);
  const path = formatRelativeUrl(location.pathname, query, hash);
  const matched = registry.matchUrl(path);
  return {
    name: matched ? matched.name : null,
    path,
    pathname: location.pathname || '/',
    params: matched ? matched.params : {},
    query,
    hash,
    state: location.state,
    key: location.key,
    matchedPattern: matched ? matched.pattern : null,
  };
}

function toLocation(resolved: Pick<ResolvedNavigationIntent, 'pathname' | 'query' | 'hash' | 'state'>): LocationDescriptorObject {
  return {
    pathname: resolved.pathname,
    search: stringifyQueryParams(resolved.query),
    hash: resolved.hash ? `#${normalizeHash(resolved.hash)}` : '',
    state: resolved.state,
  };
}

const defaultConfirm: GetUserConfirmation = (message, callback) =>
  callback(
    typeof window !== 'undefined' && typeof window.confirm === 'function'
      ? Boolean(window.confirm(message))
      : false,
  );

function createWebController<TName extends string>(
  registry: RouteRegistry<TName>,
  history: History,
  internal: WebInternalState,
  route: UnifiedRoute<TName>,
): RouterController<TName> {
  const withBypass = (fn: () => void) => {
    internal.bypassRef.current = true;
    try {
      fn();
    } finally {
      internal.bypassRef.current = false;
    }
  };

  const controller: RouterController<TName> = {
    platform: 'web',
    route,
    buildUrl: (target, params, options) => registry.resolveTarget(target, params, options).path,
    navigate: (target, params, options) => {
      const resolved = registry.resolveTarget(target, params, options);
      // Same location: update in place instead of stacking a duplicate entry (like <Link>).
      if (resolved.path === route.path) history.replace(toLocation(resolved));
      else history.push(toLocation(resolved));
    },
    push: (target, params, options) =>
      history.push(toLocation(registry.resolveTarget(target, params, options))),
    replace: (target, params, options) =>
      history.replace(toLocation(registry.resolveTarget(target, params, options))),
    canGoBack: () => internal.canGoBack(),
    getLength: () => internal.length(),
    go: (delta) => {
      if (delta >= 0) return;
      if (-delta <= internal.depth()) history.go(delta);
      else controller.goBack();
    },
    goBack: () => {
      if (internal.canGoBack()) history.goBack();
      else
        backAtRoot(registry, route, controller, internal.onBackAtRoot, (proceed) =>
          internal.runGuards('goBack', proceed),
        );
    },
    reset: (targets, index) => {
      if (!targets || targets.length === 0) return;
      const last = index === undefined ? targets.length - 1 : Math.max(0, Math.min(index, targets.length - 1));
      const active = targets.slice(0, last + 1).map((entry) =>
        typeof entry === 'string'
          ? registry.resolveTarget(entry)
          : registry.resolveTarget(entry.name, entry.params, entry),
      );
      const run = () =>
        withBypass(() => {
          active.forEach((resolved, idx) =>
            idx === 0 ? history.replace(toLocation(resolved)) : history.push(toLocation(resolved)),
          );
          internal.resetStack(active.length - 1);
        });
      if (internal.runGuards('reset', run, active[active.length - 1]?.path)) run();
    },
    setParams: (partial) => {
      const resolved = resolveParamsUpdate(registry, route, partial);
      if (resolved) history.replace(toLocation(resolved));
    },
    setQuery: (input, options) => {
      const next = { ...route, query: mergeQuery(route.query, input, options?.merge ?? true) };
      if (options?.replace ?? true) history.replace(toLocation(next));
      else history.push(toLocation(next));
    },
  };
  return controller;
}

function WebRouterBridge<TName extends string>({
  routes,
  getUserConfirmation,
  onBackAtRoot,
  children,
}: {
  routes: RouteRegistry<TName>;
  getUserConfirmation?: GetUserConfirmation;
  onBackAtRoot?: (ctx: BackAtRootContext) => void;
  children: React.ReactNode;
}) {
  const history = useHistory();
  const memory = history as History & { index?: number; entries?: Location[] };
  const isMemory = typeof memory.index === 'number';

  // Track SPA history depth so `canGoBack()` is reliable (browser history exposes no index).
  // Browser history gives the initial entry no key; history v4 tracks it as `undefined`.
  const stackRef = useRef<string[]>([keyOf(history.location)]);
  const indexRef = useRef<number>(isMemory ? memory.index! : 0);
  // Lowest index `goBack()` may reach after a `reset()` (history entries cannot be removed).
  const floorRef = useRef(0);

  const bypassRef = useRef(false);
  const bypassPopRef = useRef(false);
  const guardsRef = useRef(new Set<GuardHandlerRef>());
  const unblockRef = useRef<(() => void) | null>(null);
  const confirmRef = useRef<GetUserConfirmation>(defaultConfirm);
  confirmRef.current = getUserConfirmation ?? defaultConfirm;
  const backAtRootRef = useRef(onBackAtRoot);
  backAtRootRef.current = onBackAtRoot;

  useEffect(
    () =>
      history.listen((location, action) => {
        if (isMemory) {
          indexRef.current = memory.index!;
          floorRef.current = Math.min(floorRef.current, indexRef.current);
          return;
        }
        const key = keyOf(location);
        // After a blocked POP, history v4 reverts the browser and then notifies listeners again
        // with the unchanged location and the previous action: not a new entry.
        if (key === stackRef.current[indexRef.current]) return;
        if (action === 'PUSH') {
          stackRef.current = [...stackRef.current.slice(0, indexRef.current + 1), key];
          indexRef.current = stackRef.current.length - 1;
        } else if (action === 'REPLACE') {
          stackRef.current[indexRef.current] = key;
        } else {
          const found = stackRef.current.lastIndexOf(key);
          indexRef.current = found !== -1 ? found : Math.max(0, indexRef.current - 1);
        }
      }),
    [history, isMemory, memory],
  );

  // history v4 allows one prompt at a time, so any other `history.block` caller (React Router's
  // own <Prompt>, `props.history.block`) would silently replace the adapter's guard. While mounted,
  // route `history.block` on this history instance into the central guard list instead.
  // Patched during render so children's mount effects (e.g. <Prompt>) already see it.
  const addGuardRef = useRef<(handler: GuardHandlerRef) => () => void>(() => () => {});
  const [originalBlock] = useState(() => {
    const original = history.block;
    (history as any).block = (prompt: any = false) =>
      addGuardRef.current({
        current: promptToGuard(typeof prompt === 'boolean' ? () => prompt : prompt),
      });
    return original;
  });
  useEffect(
    () => () => {
      unblockRef.current?.();
      (history as any).block = originalBlock;
    },
    [history, originalBlock],
  );

  const internal = useMemo<WebInternalState>(() => {
    const runGuards = (action: NavigationGuardAction, proceed: () => void, nextPath?: string) => {
      for (const handler of Array.from(guardsRef.current).reverse()) {
        if (!runGuard(handler.current, action, proceed, confirmRef.current, nextPath)) return false;
      }
      return true;
    };

    // Re-run a blocked transition once its guard allows it.
    const replay = (location: Location, action: Action) => {
      if (action === 'POP') {
        const keys = isMemory ? memory.entries!.map(keyOf) : stackRef.current;
        const target = keys.indexOf(keyOf(location));
        bypassPopRef.current = true;
        history.go(target !== -1 ? target - indexRef.current : -1);
        return;
      }
      bypassRef.current = true;
      try {
        if (action === 'PUSH') history.push(location);
        else history.replace(location);
      } finally {
        bypassRef.current = false;
      }
    };

    const blocker = (location: Location, action: Action) => {
      if (bypassRef.current) return undefined;
      if (action === 'POP' && bypassPopRef.current) {
        bypassPopRef.current = false;
        return undefined;
      }
      // Query/hash-only changes (setQuery/setParams on the same path) do not leave the screen.
      if (location.pathname === history.location.pathname) return undefined;
      const nextPath = `${location.pathname}${location.search}${location.hash}`;
      return runGuards(GUARD_ACTIONS[action], () => replay(location, action), nextPath) ? undefined : false;
    };

    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };

    const sync = () => {
      const active = guardsRef.current.size > 0;
      if (active && !unblockRef.current) {
        const unblock = originalBlock.call(history, blocker as any);
        if (typeof window !== 'undefined' && !isMemory) {
          window.addEventListener('beforeunload', onBeforeUnload);
        }
        unblockRef.current = () => {
          unblock();
          if (typeof window !== 'undefined') window.removeEventListener('beforeunload', onBeforeUnload);
        };
      } else if (!active && unblockRef.current) {
        unblockRef.current();
        unblockRef.current = null;
      }
    };

    return {
      canGoBack: () => (isMemory ? memory.index! : indexRef.current) > floorRef.current,
      depth: () => (isMemory ? memory.index! : indexRef.current) - floorRef.current,
      length: () => (isMemory ? memory.index! : indexRef.current) - floorRef.current + 1,
      resetStack: (depth) => {
        if (isMemory) {
          indexRef.current = memory.index!;
          floorRef.current = Math.max(0, memory.index! - depth);
        } else {
          stackRef.current = Array.from({ length: depth + 1 }, (_, i) =>
            i === depth ? keyOf(history.location) : `__reset_${i}__`,
          );
          indexRef.current = depth;
          floorRef.current = 0;
        }
      },
      addGuard: (handler) => {
        guardsRef.current.add(handler);
        sync();
        return () => {
          guardsRef.current.delete(handler);
          sync();
        };
      },
      runGuards,
      bypassRef,
      get onBackAtRoot() {
        return backAtRootRef.current;
      },
    };
  }, [history, isMemory, memory, originalBlock]);
  addGuardRef.current = internal.addGuard;

  const adapter = useMemo<RouterAdapter<TName>>(
    () => ({
      platform: 'web',

      useRoute: () => {
        const location = useLocation();
        return useMemo(() => toUnifiedRoute(location, routes), [location]);
      },

      useController: () => {
        const rrHistory = useHistory();
        const location = useLocation();
        const ctx = useContext(WebInternalContext)!;
        return useMemo(
          () => createWebController(routes, rrHistory, ctx, toUnifiedRoute(location, routes)),
          [rrHistory, ctx, location],
        );
      },

      useIsFocused: () => true,

      useFocusEffect: (effect) => {
        useEffect(() => {
          const cleanup = effect();
          return () => {
            if (typeof cleanup === 'function') cleanup();
          };
        }, [effect]);
      },

      useNavigationGuard: (when, messageOrHandler) => {
        const ctx = useContext(WebInternalContext)!;
        const handlerRef: GuardHandlerRef = useRef(messageOrHandler);
        handlerRef.current = messageOrHandler;
        useEffect(() => (when ? ctx.addGuard(handlerRef) : undefined), [when, ctx]);
      },

      useListen: () => {
        const rrHistory = useHistory();
        return useMemo(
          () => (listener: NavigationListener) =>
            rrHistory.listen((location, action) => listener(toUnifiedRoute(location, routes), action)),
          [rrHistory],
        );
      },

      useLastAction: () => {
        useLocation(); // re-render on change
        return useHistory().action;
      },
    }),
    [routes],
  );

  const contextValue = useMemo(() => ({ registry: routes, adapter }), [routes, adapter]);

  return (
    <WebInternalContext.Provider value={internal}>
      <UniversalRouterContext.Provider value={contextValue}>{children}</UniversalRouterContext.Provider>
    </WebInternalContext.Provider>
  );
}

/**
 * Web `<RouterProvider>` backed by React Router v5.
 */
export function WebRouterProvider<TName extends string = string>({
  routes,
  children,
  history,
  routerType,
  basename,
  initialEntries,
  initialIndex,
  getUserConfirmation,
  onBackAtRoot,
  useExistingRouter,
}: WebRouterProviderProps<TName>) {
  const existingRouter = useContext(__RouterContext);
  const reuseExisting =
    useExistingRouter === true ||
    (useExistingRouter === undefined && !history && !routerType && existingRouter != null);

  const bridge = (
    <WebRouterBridge routes={routes} getUserConfirmation={getUserConfirmation} onBackAtRoot={onBackAtRoot}>
      {children}
    </WebRouterBridge>
  );

  if (reuseExisting) return bridge;
  if (history) return <Router history={history}>{bridge}</Router>;
  if (routerType === 'memory') {
    return (
      <MemoryRouter initialEntries={initialEntries ?? ['/']} initialIndex={initialIndex} getUserConfirmation={getUserConfirmation}>
        {bridge}
      </MemoryRouter>
    );
  }
  if (routerType === 'hash') {
    return <HashRouter basename={basename} getUserConfirmation={getUserConfirmation}>{bridge}</HashRouter>;
  }
  return <BrowserRouter basename={basename} getUserConfirmation={getUserConfirmation}>{bridge}</BrowserRouter>;
}
