import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
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
  createControlledHistory,
  type ControlledHistory,
  type ControlledLocation,
  type ControlledNavigateAction,
  type ControlledNavigateIntent,
} from './controlledHistory';
import {
  formatRelativeUrl,
  normalizeHash,
  normalizePathname,
  parseQueryString,
  stringifyQueryParams,
} from '../pathUtils';
import {
  backAtRoot,
  mergeQuery,
  promptToGuard,
  resolveEntryGuardChain,
  resolveParamsUpdate,
  resolveTargetFromRoute,
  runGuard,
} from '../shared';
import { registerImperativeRouter, toImperativeLocation } from '../imperative';
import type {
  BackAtRootContext,
  GetUserConfirmation,
  ImperativeRouter,
  NavigationGuardAction,
  NavigationGuardCallback,
  NavigationListener,
  NavigationOptions,
  NavigationTarget,
  ResolvedNavigationIntent,
  RouteParams,
  RouteRegistry,
  RouterAdapter,
  RouterController,
  RouterHandle,
  UnifiedRoute,
} from '../types';

export type { ControlledLocation, ControlledNavigateAction, ControlledNavigateIntent };

export interface WebRouteOverride {
  route: UnifiedRoute<any>;
  isFocused: boolean;
  scope: 'base' | 'overlay';
}

/**
 * Internal context set by `<RouterView>` on web so a base route rendered underneath an
 * active overlay keeps its own `useRoute()` / `useParams()` and reports `useIsFocused() === false`.
 */
export const WebRouteOverrideContext = createContext<WebRouteOverride | null>(null);

export interface WebRouterProviderProps<TName extends string = string> {
  /** Shared route registry created via `defineRoutes(...)`. */
  routes: RouteRegistry<TName>;
  children: React.ReactNode;
  /** Optional custom `history` v4 instance (renders React Router v5 `<Router history={history}>`). */
  history?: History;
  /** Router implementation to mount when not reusing an existing React Router v5 context. Defaults to `'browser'`. */
  routerType?: 'browser' | 'hash' | 'memory';
  /** Base URL for BrowserRouter / HashRouter (also applied to `<Link>` hrefs in controlled mode). */
  basename?: string;
  /** Initial URL entries when `routerType="memory"`. */
  initialEntries?: string[];
  /** Initial index when `routerType="memory"`. */
  initialIndex?: number;
  /** Confirmation for string guard prompts. Defaults to `window.confirm`. */
  getUserConfirmation?: GetUserConfirmation;
  /** Called by `goBack()` when there is no history entry to go back to. */
  onBackAtRoot?: (ctx: BackAtRootContext) => void;
  /**
   * If true, attaches to an ancestor React Router v5 `<Router>` instead of mounting a new one.
   * When omitted, automatically reuses an ancestor router if neither `history` nor `routerType` is specified.
   */
  useExistingRouter?: boolean;
  /** Optional reactive context passed to route `enabled(context)` predicates and entry `guard(route, context)` hooks. */
  routeContext?: unknown;
  /**
   * Controlled mode (embedded web micro-frontend): host-owned URL (string path or location object).
   * When defined, the adapter never reads or writes `window.history`.
   */
  location?: ControlledLocation;
  /** Controlled mode: optional state paired with a string `location` prop. */
  locationState?: unknown;
  /** Controlled mode: callback invoked with outgoing navigation intents (`push`, `replace`, `back`). */
  onNavigate?: (intent: ControlledNavigateIntent) => void;
  /** Controlled mode: optional host-provided answer for `router.canGoBack()`. */
  canGoBack?: boolean;
  /**
   * Called when navigating to a URL that does not match any enabled route in the registry
   * (e.g. a host-owned page in an embedded micro-frontend) or an external origin URL.
   * When omitted, unmatched relative URLs navigate normally and render `<RouterView fallback>`.
   */
  onExternal?: (url: string) => void;
  /** Optional handler invoked by `router.reload()`. Defaults to `window.location.reload()` on web. */
  onReload?: () => void;
  /** Optional explicit ref populated with the provider's imperative router handle (`createRouterRef()`). */
  routerRef?: RouterHandle<any>;
}

type GuardHandlerRef = React.MutableRefObject<string | NavigationGuardCallback | undefined>;
type GuardScope = 'base' | 'overlay' | 'layout';
interface WebGuardEntry {
  handler: GuardHandlerRef;
  scope: GuardScope;
  isFocused: React.MutableRefObject<boolean>;
}

interface WebInternalState {
  isControlled: boolean;
  controlledCanGoBack?: boolean;
  canGoBack: () => boolean;
  /** Entries that `goBack()` can still reach. */
  depth: () => number;
  length: () => number;
  resetStack: (depth: number) => void;
  addGuard: (entry: WebGuardEntry) => () => void;
  runGuards: (
    action: NavigationGuardAction,
    proceed: () => void,
    nextPath?: string,
    options?: { skipBase?: boolean },
  ) => boolean;
  bypassRef: React.MutableRefObject<boolean>;
  bypassNextPathRef: React.MutableRefObject<string | null>;
  pendingActionRef: React.MutableRefObject<NavigationGuardAction | null>;
  onBackAtRoot?: (ctx: BackAtRootContext) => void;
  onExternal?: (url: string) => void;
  onReload?: () => void;
}

const WebInternalContext = createContext<WebInternalState | null>(null);

/** Internal hook allowing `<RouterView>` entry-guard redirects to bypass leave guards. */
export function useWebBypassNextPath(): (path: string) => void {
  const ctx = useContext(WebInternalContext);
  return (path: string) => {
    if (ctx) ctx.bypassNextPathRef.current = path;
  };
}

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
  routeContext?: unknown,
): UnifiedRoute<TName> {
  const query = parseQueryString(location.search);
  const hash = normalizeHash(location.hash);
  const path = formatRelativeUrl(location.pathname, query, hash);
  const matched = registry.matchUrl(path, routeContext);
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
    ...(matched?.isOverlay
      ? { isOverlay: true, basePathname: matched.basePathname }
      : {}),
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
  routeContext?: unknown,
): RouterController<TName> {
  const withBypass = (fn: () => void) => {
    internal.bypassRef.current = true;
    try {
      fn();
    } finally {
      internal.bypassRef.current = false;
    }
  };

  const resolveForNavigation = (
    target: NavigationTarget<TName>,
    params?: RouteParams,
    options?: NavigationOptions,
  ) => {
    const initial = resolveTargetFromRoute(registry, route, target, params, options, routeContext);
    const guardEval = resolveEntryGuardChain(registry, initial, routeContext);
    return guardEval.kind === 'redirect' ? guardEval.intent : initial;
  };

  const getExternalUrl = (
    rawTarget: NavigationTarget<TName>,
    resolved: ResolvedNavigationIntent<TName>,
  ): string | null => {
    if (!internal.onExternal) return null;
    if (typeof rawTarget === 'string' && /^https?:\/\//i.test(rawTarget)) {
      try {
        const parsed = new URL(rawTarget);
        if (typeof window !== 'undefined' && parsed.origin !== window.location.origin) {
          return rawTarget;
        }
      } catch {
        // fall through
      }
    }
    if (resolved.name === null) return resolved.path;
    return null;
  };

  const invokeExternal = (action: NavigationGuardAction, url: string) => {
    const fn = internal.onExternal!;
    if (internal.runGuards(action, () => fn(url), url)) fn(url);
  };

  const controller: RouterController<TName> = {
    platform: 'web',
    route,
    buildUrl: (target, params, options) =>
      resolveTargetFromRoute(registry, route, target, params, options, routeContext).path,
    navigate: (target, params, options) => {
      const resolved = resolveForNavigation(target, params, options);
      const extUrl = getExternalUrl(target, resolved);
      if (extUrl !== null) {
        invokeExternal('navigate', extUrl);
        return;
      }
      internal.pendingActionRef.current = 'navigate';
      try {
        // Same location: update in place instead of stacking a duplicate entry (like <Link>).
        if (resolved.path === route.path) history.replace(toLocation(resolved));
        else history.push(toLocation(resolved));
      } finally {
        internal.pendingActionRef.current = null;
      }
    },
    push: (target, params, options) => {
      const resolved = resolveForNavigation(target, params, options);
      const extUrl = getExternalUrl(target, resolved);
      if (extUrl !== null) {
        invokeExternal('push', extUrl);
        return;
      }
      history.push(toLocation(resolved));
    },
    replace: (target, params, options) => {
      const resolved = resolveForNavigation(target, params, options);
      const extUrl = getExternalUrl(target, resolved);
      if (extUrl !== null) {
        invokeExternal('replace', extUrl);
        return;
      }
      history.replace(toLocation(resolved));
    },
    canGoBack: () => internal.canGoBack(),
    getLength: () => internal.length(),
    go: (delta) => {
      if (delta >= 0) return;
      if (-delta <= internal.depth()) history.go(delta);
      else if (
        internal.isControlled &&
        internal.controlledCanGoBack === undefined &&
        !internal.onBackAtRoot &&
        !registry.resolveParent(route, routeContext)
      ) {
        history.go(delta);
      } else
        backAtRoot(
          registry,
          route,
          controller,
          internal.onBackAtRoot,
          (proceed) => internal.runGuards('goBack', proceed),
          routeContext,
        );
    },
    goBack: () => {
      if (internal.canGoBack()) history.goBack();
      else if (
        internal.isControlled &&
        internal.controlledCanGoBack === undefined &&
        !internal.onBackAtRoot &&
        !registry.resolveParent(route, routeContext)
      ) {
        history.goBack();
      } else
        backAtRoot(
          registry,
          route,
          controller,
          internal.onBackAtRoot,
          (proceed) => internal.runGuards('goBack', proceed),
          routeContext,
        );
    },
    reset: (targets, index) => {
      if (!targets || targets.length === 0) return;
      const last = index === undefined ? targets.length - 1 : Math.max(0, Math.min(index, targets.length - 1));
      const keptTargets = targets.slice(0, last + 1);
      const active = keptTargets.map((entry) =>
        typeof entry === 'string'
          ? resolveTargetFromRoute(registry, route, entry, undefined, undefined, routeContext)
          : resolveTargetFromRoute(registry, route, entry.name, entry.params, entry, routeContext),
      );
      if (active.length > 0) {
        const lastIdx = active.length - 1;
        const guardEval = resolveEntryGuardChain(registry, active[lastIdx], routeContext);
        if (guardEval.kind === 'redirect') active[lastIdx] = guardEval.intent;
      }
      const lastActive = active[active.length - 1];
      const extUrl = lastActive
        ? getExternalUrl(keptTargets[keptTargets.length - 1] as NavigationTarget<TName>, lastActive)
        : null;
      const run = () =>
        withBypass(() => {
          if (extUrl !== null) {
            const registered = active.slice(0, -1).filter((r) => r.name !== null);
            if (registered.length > 0) {
              if (internal.isControlled) {
                internal.resetStack(0);
                history.replace(toLocation(registered[registered.length - 1]));
              } else {
                registered.forEach((resolved, idx) =>
                  idx === 0 ? history.replace(toLocation(resolved)) : history.push(toLocation(resolved)),
                );
                internal.resetStack(registered.length - 1);
              }
            }
            internal.onExternal!(extUrl);
          } else if (internal.isControlled) {
            internal.resetStack(0);
            history.replace(toLocation(lastActive));
          } else {
            active.forEach((resolved, idx) =>
              idx === 0 ? history.replace(toLocation(resolved)) : history.push(toLocation(resolved)),
            );
            internal.resetStack(active.length - 1);
          }
        });
      if (internal.runGuards('reset', run, extUrl ?? lastActive?.path)) run();
    },
    setParams: (partial) => {
      const resolved = resolveParamsUpdate(registry, route, partial, routeContext);
      if (resolved) history.replace(toLocation(resolved));
    },
    setQuery: (input, options) => {
      const next = { ...route, query: mergeQuery(route.query, input, options?.merge ?? true) };
      if (options?.replace ?? true) history.replace(toLocation(next));
      else history.push(toLocation(next));
    },
    openExternal: (url, options) => {
      const perform = () => {
        if (internal.onExternal) {
          internal.onExternal(url);
        } else if (typeof window !== 'undefined' && window.location) {
          if (options?.replace) window.location.replace(url);
          else window.location.assign(url);
        }
      };
      if (internal.runGuards('navigate', perform, url)) perform();
    },
    reload: () => {
      const perform = () => {
        if (internal.onReload) {
          internal.onReload();
        } else if (typeof window !== 'undefined' && window.location) {
          window.location.reload();
        }
      };
      if (internal.runGuards('replace', perform, route.path)) perform();
    },
  };
  return controller;
}

function WebRouterBridge<TName extends string>({
  routes,
  routeContext,
  getUserConfirmation,
  onBackAtRoot,
  onExternal,
  onReload,
  routerRef,
  controlledCanGoBack,
  children,
}: {
  routes: RouteRegistry<TName>;
  routeContext?: unknown;
  getUserConfirmation?: GetUserConfirmation;
  onBackAtRoot?: (ctx: BackAtRootContext) => void;
  onExternal?: (url: string) => void;
  onReload?: () => void;
  routerRef?: RouterHandle<any>;
  controlledCanGoBack?: boolean;
  children: React.ReactNode;
}) {
  const history = useHistory();
  const controlled = (history as Partial<ControlledHistory>).__isControlled
    ? (history as ControlledHistory)
    : null;
  const isControlled = controlled !== null;
  const memory = history as History & { index?: number; entries?: Location[] };
  const isMemory = !isControlled && typeof memory.index === 'number';

  // Track SPA history depth so `canGoBack()` is reliable (browser history exposes no index).
  // Browser history gives the initial entry no key; history v4 tracks it as `undefined`.
  const stackRef = useRef<string[]>([keyOf(history.location)]);
  const indexRef = useRef<number>(isMemory ? memory.index! : 0);
  // Lowest index `goBack()` may reach after a `reset()` (history entries cannot be removed).
  const floorRef = useRef(0);

  const bypassRef = useRef(false);
  const bypassPopRef = useRef(false);
  const bypassNextPathRef = useRef<string | null>(null);
  const pendingActionRef = useRef<NavigationGuardAction | null>(null);
  const guardsRef = useRef(new Set<WebGuardEntry>());
  const unblockRef = useRef<(() => void) | null>(null);
  const routesRef = useRef(routes);
  routesRef.current = routes;
  const routeContextRef = useRef(routeContext);
  routeContextRef.current = routeContext;
  const controlledCanGoBackRef = useRef(controlledCanGoBack);
  controlledCanGoBackRef.current = controlledCanGoBack;
  const confirmRef = useRef<GetUserConfirmation>(defaultConfirm);
  confirmRef.current = getUserConfirmation ?? defaultConfirm;
  const backAtRootRef = useRef(onBackAtRoot);
  backAtRootRef.current = onBackAtRoot;
  const externalRef = useRef(onExternal);
  externalRef.current = onExternal;
  const reloadRef = useRef(onReload);
  reloadRef.current = onReload;

  useEffect(
    () => {
      if (isControlled) return undefined;
      return history.listen((location, action) => {
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
      });
    },
    [history, isControlled, isMemory, memory],
  );

  // history v4 allows one prompt at a time, so any other `history.block` caller (React Router's
  // own <Prompt>, `props.history.block`) would silently replace the adapter's guard. While mounted,
  // route `history.block` on this history instance into the central guard list instead.
  // Patched during render so children's mount effects (e.g. <Prompt>) already see it.
  const addGuardRef = useRef<(entry: WebGuardEntry) => () => void>(() => () => {});
  const [originalBlock] = useState(() => {
    const original = history.block;
    (history as any).block = (prompt: any = false) =>
      addGuardRef.current({
        handler: {
          current: promptToGuard(typeof prompt === 'boolean' ? () => prompt : prompt),
        },
        scope: 'layout',
        isFocused: { current: true },
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
    const runGuards = (
      action: NavigationGuardAction,
      proceed: () => void,
      nextPath?: string,
      options?: { skipBase?: boolean },
    ) => {
      for (const entry of Array.from(guardsRef.current).reverse()) {
        if (!entry.isFocused.current) continue;
        if (options?.skipBase && entry.scope === 'base') continue;
        if (!runGuard(entry.handler.current, action, proceed, confirmRef.current, nextPath)) return false;
      }
      return true;
    };

    // Re-run a blocked transition once its guard allows it.
    const replay = (location: Location, action: Action) => {
      if (action === 'POP') {
        if (isControlled) {
          bypassPopRef.current = true;
          history.go(-1);
          return;
        }
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
      const nextPath = location.pathname
        ? `${location.pathname}${location.search}${location.hash}`
        : undefined;
      if (nextPath && bypassNextPathRef.current && nextPath === bypassNextPathRef.current) {
        bypassNextPathRef.current = null;
        return undefined;
      }
      // Query/hash-only changes (setQuery/setParams on the same path) do not leave the screen.
      if (location.pathname && location.pathname === history.location.pathname) return undefined;
      const guardAction = pendingActionRef.current ?? GUARD_ACTIONS[action];
      // Opening an overlay over the same base pathname keeps the base screen mounted underneath.
      const ctx = routeContextRef.current;
      const currentOverlay = routesRef.current.matchOverlayUrl(history.location.pathname, ctx);
      const nextOverlay = location.pathname
        ? routesRef.current.matchOverlayUrl(location.pathname, ctx)
        : null;
      const currentBase = normalizePathname(currentOverlay ? currentOverlay.basePathname : history.location.pathname);
      const skipBase = Boolean(
        !currentOverlay &&
          nextOverlay &&
          normalizePathname(nextOverlay.basePathname) === currentBase,
      );
      return runGuards(guardAction, () => replay(location, action), nextPath, { skipBase })
        ? undefined
        : false;
    };

    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };

    const sync = () => {
      const active = guardsRef.current.size > 0;
      if (active && !unblockRef.current) {
        const unblock = originalBlock.call(history, blocker as any);
        if (typeof window !== 'undefined' && !isMemory && !isControlled) {
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
      isControlled,
      get controlledCanGoBack() {
        return controlledCanGoBackRef.current;
      },
      canGoBack: () => {
        if (isControlled) {
          return controlledCanGoBackRef.current !== undefined
            ? controlledCanGoBackRef.current
            : controlled!.getDepth() > 0;
        }
        return (isMemory ? memory.index! : indexRef.current) > floorRef.current;
      },
      depth: () => {
        if (isControlled) {
          if (controlledCanGoBackRef.current === true) return Math.max(1, controlled!.getDepth());
          if (controlledCanGoBackRef.current === false) return 0;
          return controlled!.getDepth();
        }
        return (isMemory ? memory.index! : indexRef.current) - floorRef.current;
      },
      length: () => {
        if (isControlled) return controlled!.getDepth() + 1;
        return (isMemory ? memory.index! : indexRef.current) - floorRef.current + 1;
      },
      resetStack: (depth) => {
        if (isControlled) {
          controlled!.resetDepth();
        } else if (isMemory) {
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
      addGuard: (entry) => {
        guardsRef.current.add(entry);
        sync();
        return () => {
          guardsRef.current.delete(entry);
          sync();
        };
      },
      runGuards,
      bypassRef,
      bypassNextPathRef,
      pendingActionRef,
      get onBackAtRoot() {
        return backAtRootRef.current;
      },
      get onExternal() {
        return externalRef.current;
      },
      get onReload() {
        return reloadRef.current;
      },
    };
  }, [history, isControlled, controlled, isMemory, memory, originalBlock]);
  addGuardRef.current = internal.addGuard;

  useEffect(() => {
    const getCurrentRoute = () => toUnifiedRoute(history.location, routesRef.current, routeContextRef.current);
    const getCurrentController = () =>
      createWebController(routesRef.current, history, internal, getCurrentRoute(), routeContextRef.current);
    const handle: ImperativeRouter<TName> = {
      platform: 'web',
      getLocation: () => toImperativeLocation(getCurrentRoute()),
      getRoute: () => getCurrentRoute(),
      subscribe: (listener) =>
        history.listen((loc, action) =>
          listener(toImperativeLocation(toUnifiedRoute(loc, routesRef.current, routeContextRef.current)), action),
        ),
      navigate: (...args) => getCurrentController().navigate(...args),
      push: (...args) => getCurrentController().push(...args),
      replace: (...args) => getCurrentController().replace(...args),
      goBack: () => getCurrentController().goBack(),
      go: (delta) => getCurrentController().go(delta),
      canGoBack: () => getCurrentController().canGoBack(),
      getLength: () => getCurrentController().getLength(),
      reset: (...args) => getCurrentController().reset(...args),
      setParams: (partial) => getCurrentController().setParams(partial),
      setQuery: (...args) => getCurrentController().setQuery(...args),
      buildUrl: (...args) => getCurrentController().buildUrl(...args),
      openExternal: (...args) => getCurrentController().openExternal(...args),
      reload: () => getCurrentController().reload(),
    };
    return registerImperativeRouter(handle, routerRef);
  }, [history, internal, routerRef]);

  const adapter = useMemo<RouterAdapter<TName>>(
    () => ({
      platform: 'web',

      useRoute: () => {
        const override = useContext(WebRouteOverrideContext);
        const location = useLocation();
        const computed = useMemo(
          () => toUnifiedRoute(location, routes, routeContext),
          [location, routes, routeContext],
        );
        return (override?.route as UnifiedRoute<TName> | undefined) ?? computed;
      },

      useController: () => {
        const rrHistory = useHistory();
        const location = useLocation();
        const override = useContext(WebRouteOverrideContext);
        const ctx = useContext(WebInternalContext)!;
        const activeRoute = useMemo(
          () =>
            (override?.route as UnifiedRoute<TName> | undefined) ??
            toUnifiedRoute(location, routes, routeContext),
          [override, location, routes, routeContext],
        );
        return useMemo(
          () => createWebController(routes, rrHistory, ctx, activeRoute, routeContext),
          [routes, rrHistory, ctx, activeRoute, routeContext],
        );
      },

      useIsFocused: () => {
        const override = useContext(WebRouteOverrideContext);
        return override ? override.isFocused : true;
      },

      useFocusEffect: (effect) => {
        const override = useContext(WebRouteOverrideContext);
        const focused = override ? override.isFocused : true;
        useEffect(() => {
          if (!focused) return undefined;
          const cleanup = effect();
          return () => {
            if (typeof cleanup === 'function') cleanup();
          };
        }, [effect, focused]);
      },

      useNavigationGuard: (when, messageOrHandler) => {
        const ctx = useContext(WebInternalContext)!;
        const override = useContext(WebRouteOverrideContext);
        const handlerRef: GuardHandlerRef = useRef(messageOrHandler);
        handlerRef.current = messageOrHandler;
        const focusedRef = useRef(override ? override.isFocused : true);
        focusedRef.current = override ? override.isFocused : true;
        const scope: GuardScope = override ? override.scope : 'layout';
        useEffect(
          () =>
            when
              ? ctx.addGuard({ handler: handlerRef, scope, isFocused: focusedRef })
              : undefined,
          [when, ctx, scope],
        );
      },

      useListen: () => {
        const rrHistory = useHistory();
        return useMemo(
          () => (listener: NavigationListener) =>
            rrHistory.listen((location, action) =>
              listener(toUnifiedRoute(location, routesRef.current, routeContextRef.current), action),
            ),
          [rrHistory],
        );
      },

      useLastAction: () => {
        useLocation(); // re-render on change
        return useHistory().action;
      },
    }),
    [routes, routeContext],
  );

  const contextValue = useMemo(
    () => ({ registry: routes, adapter, routeContext }),
    [routes, adapter, routeContext],
  );

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
  routeContext,
  children,
  history,
  routerType,
  basename,
  initialEntries,
  initialIndex,
  getUserConfirmation,
  onBackAtRoot,
  onExternal,
  onReload,
  routerRef,
  useExistingRouter,
  location,
  locationState,
  onNavigate,
  canGoBack,
}: WebRouterProviderProps<TName>) {
  const existingHistory = useHistory();
  const isControlled = location !== undefined;

  const controlledHistoryRef = useRef<ControlledHistory | null>(null);
  if (isControlled && !controlledHistoryRef.current) {
    controlledHistoryRef.current = createControlledHistory(location, locationState, {
      onNavigate,
      basename,
    });
  }
  if (isControlled && controlledHistoryRef.current) {
    controlledHistoryRef.current.setOptions({ onNavigate, basename });
  }
  useEffect(() => {
    if (isControlled && controlledHistoryRef.current) {
      controlledHistoryRef.current.syncFromHost(location, locationState);
    }
  }, [isControlled, location, locationState]);

  const reuseExisting =
    !isControlled &&
    (useExistingRouter === true ||
      (useExistingRouter === undefined && !history && !routerType && existingHistory != null));

  const bridge = (
    <WebRouterBridge
      routes={routes}
      routeContext={routeContext}
      getUserConfirmation={getUserConfirmation}
      onBackAtRoot={onBackAtRoot}
      onExternal={onExternal}
      onReload={onReload}
      routerRef={routerRef}
      controlledCanGoBack={canGoBack}
    >
      {children}
    </WebRouterBridge>
  );

  if (isControlled) {
    return <Router history={controlledHistoryRef.current!}>{bridge}</Router>;
  }
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
