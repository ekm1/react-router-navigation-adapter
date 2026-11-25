import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
} from 'react';
import { __RouterContext } from 'react-router';
import {
  BrowserRouter,
  HashRouter,
  MemoryRouter,
  Router,
  useHistory,
  useLocation,
} from 'react-router-dom';
import type { Action, History, Location } from 'history';
import { UniversalRouterContext } from '../context';
import {
  formatRelativeUrl,
  normalizeHash,
  normalizeQueryInput,
  parseQueryString,
  stringifyQueryParams,
} from '../pathUtils';
import type {
  NavigationGuardAction,
  NavigationGuardCallback,
  NavigationOptions,
  NavigationTarget,
  QueryInput,
  ResetTarget,
  RouteParams,
  RouteRegistry,
  RouterAdapter,
  RouterController,
  SetQueryOptions,
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
  /** Confirmation handler used when `useNavigationGuard` returns a prompt string. */
  getUserConfirmation?: (message: string, callback: (allow: boolean) => void) => void;
  /**
   * If true, attaches to an ancestor React Router v5 `<Router>` instead of mounting a new one.
   * When omitted, automatically reuses an ancestor router if neither `history` nor `routerType` is specified.
   */
  useExistingRouter?: boolean;
}

interface WebInternalState {
  canGoBack: () => boolean;
  resetStack: (depth: number) => void;
  isResettingRef: React.MutableRefObject<boolean>;
  hasCustomConfirmation: boolean;
  isMemoryWithoutConfirmation: boolean;
}

const WebInternalContext = createContext<WebInternalState | null>(null);

function mapHistoryAction(action: Action): NavigationGuardAction {
  switch (action) {
    case 'PUSH':
      return 'push';
    case 'REPLACE':
      return 'replace';
    case 'POP':
      return 'goBack';
    default:
      return 'unknown';
  }
}

function buildUnifiedRouteFromLocation<TName extends string>(
  location: Location,
  registry: RouteRegistry<TName>,
): UnifiedRoute<TName> {
  const query = parseQueryString(location.search);
  const hash = normalizeHash(location.hash);
  const fullPath = formatRelativeUrl(location.pathname, query, hash);
  const matched = registry.matchUrl(fullPath);

  return {
    name: matched ? matched.name : null,
    path: fullPath,
    pathname: location.pathname || '/',
    params: matched ? matched.params : {},
    query,
    hash,
    state: location.state,
    key: location.key,
    matchedPattern: matched ? matched.pattern : null,
  };
}

function toHistoryLocation(
  pathname: string,
  query: Record<string, any>,
  hash: string,
  state?: unknown,
) {
  return {
    pathname,
    search: stringifyQueryParams(query),
    hash: hash ? `#${normalizeHash(hash)}` : '',
    state,
  };
}

function WebRouterBridge<TName extends string>({
  routes,
  hasCustomConfirmation,
  isMemoryWithoutConfirmation,
  children,
}: {
  routes: RouteRegistry<TName>;
  hasCustomConfirmation: boolean;
  isMemoryWithoutConfirmation: boolean;
  children: React.ReactNode;
}) {
  const history = useHistory();
  const isResettingRef = useRef(false);

  // Track SPA history depth so `canGoBack()` behaves reliably across BrowserHistory & MemoryHistory
  const memoryHistory = history as History & {
    index?: number;
    entries?: Location[];
  };
  const initialKey = history.location.key ?? '__initial__';
  const stackRef = useRef<string[]>([initialKey]);
  const indexRef = useRef<number>(
    typeof memoryHistory.index === 'number' ? memoryHistory.index : 0,
  );
  // Minimum index boundary after a `reset()` call (important for MemoryHistory where real index may stay > 0)
  const floorIndexRef = useRef<number>(0);

  useEffect(() => {
    const unlisten = history.listen((location, action) => {
      if (isResettingRef.current) return;

      if (typeof memoryHistory.index === 'number') {
        indexRef.current = memoryHistory.index;
        if (indexRef.current < floorIndexRef.current) {
          floorIndexRef.current = indexRef.current;
        }
        return;
      }

      const key = location.key ?? `${location.pathname}${location.search}${location.hash}`;
      if (action === 'PUSH') {
        const nextStack = stackRef.current.slice(0, indexRef.current + 1);
        nextStack.push(key);
        stackRef.current = nextStack;
        indexRef.current = nextStack.length - 1;
      } else if (action === 'REPLACE') {
        stackRef.current[indexRef.current] = key;
      } else if (action === 'POP') {
        const foundIdx = stackRef.current.lastIndexOf(key);
        if (foundIdx !== -1) {
          indexRef.current = foundIdx;
        } else if (indexRef.current > 0) {
          indexRef.current -= 1;
        }
      }
    });

    return unlisten;
  }, [history, memoryHistory]);

  const internalState = useMemo<WebInternalState>(
    () => ({
      canGoBack: () => {
        if (typeof memoryHistory.index === 'number') {
          return memoryHistory.index > floorIndexRef.current;
        }
        return indexRef.current > floorIndexRef.current;
      },
      resetStack: (depth: number) => {
        if (typeof memoryHistory.index === 'number') {
          floorIndexRef.current = Math.max(0, memoryHistory.index - depth);
          indexRef.current = memoryHistory.index;
        } else {
          const currentKey = history.location.key ?? '__reset__';
          stackRef.current = Array.from({ length: depth + 1 }, (_, i) =>
            i === depth ? currentKey : `__reset_${i}__`,
          );
          indexRef.current = depth;
          floorIndexRef.current = 0;
        }
      },
      isResettingRef,
      hasCustomConfirmation,
      isMemoryWithoutConfirmation,
    }),
    [history, memoryHistory, hasCustomConfirmation, isMemoryWithoutConfirmation],
  );

  const adapter = useMemo<RouterAdapter<TName>>(
    () => ({
      platform: 'web',

      useRoute: () => {
        const location = useLocation();
        return useMemo(
          () => buildUnifiedRouteFromLocation(location, routes),
          [location],
        );
      },

      useController: () => {
        const rrHistory = useHistory();
        const location = useLocation();
        const internal = useContext(WebInternalContext)!;

        const route = useMemo(
          () => buildUnifiedRouteFromLocation(location, routes),
          [location],
        );

        const navigate = useCallback(
          (
            target: NavigationTarget<TName>,
            params?: RouteParams,
            options?: NavigationOptions,
          ) => {
            const resolved = routes.resolveTarget(target, params, options);
            rrHistory.push(
              toHistoryLocation(
                resolved.pathname,
                resolved.query,
                resolved.hash,
                resolved.state,
              ),
            );
          },
          [rrHistory],
        );

        const push = useCallback(
          (
            target: NavigationTarget<TName>,
            params?: RouteParams,
            options?: NavigationOptions,
          ) => {
            const resolved = routes.resolveTarget(target, params, options);
            rrHistory.push(
              toHistoryLocation(
                resolved.pathname,
                resolved.query,
                resolved.hash,
                resolved.state,
              ),
            );
          },
          [rrHistory],
        );

        const replace = useCallback(
          (
            target: NavigationTarget<TName>,
            params?: RouteParams,
            options?: NavigationOptions,
          ) => {
            const resolved = routes.resolveTarget(target, params, options);
            rrHistory.replace(
              toHistoryLocation(
                resolved.pathname,
                resolved.query,
                resolved.hash,
                resolved.state,
              ),
            );
          },
          [rrHistory],
        );

        const canGoBack = useCallback(() => internal.canGoBack(), [internal]);

        const goBack = useCallback(() => {
          if (internal.canGoBack()) {
            rrHistory.goBack();
          }
        }, [rrHistory, internal]);

        const reset = useCallback(
          (targets: ResetTarget<TName>[], index?: number) => {
            if (!targets || targets.length === 0) return;
            const targetIndex =
              index === undefined
                ? targets.length - 1
                : Math.max(0, Math.min(index, targets.length - 1));
            const activeSlice = targets.slice(0, targetIndex + 1);

            internal.isResettingRef.current = true;
            try {
              activeSlice.forEach((entry, idx) => {
                const resolved =
                  typeof entry === 'string'
                    ? routes.resolveTarget(entry)
                    : routes.resolveTarget(entry.name, entry.params, {
                        query: entry.query,
                        hash: entry.hash,
                        state: entry.state,
                      });
                const loc = toHistoryLocation(
                  resolved.pathname,
                  resolved.query,
                  resolved.hash,
                  resolved.state,
                );
                if (idx === 0) {
                  rrHistory.replace(loc);
                } else {
                  rrHistory.push(loc);
                }
              });
              internal.resetStack(activeSlice.length - 1);
            } finally {
              internal.isResettingRef.current = false;
            }
          },
          [rrHistory, internal],
        );

        const setParams = useCallback(
          (partialParams: RouteParams) => {
            if (!route.name) return;
            const mergedParams = { ...route.params, ...partialParams };
            const nextPath = routes.buildPath(route.name, mergedParams, {
              query: route.query,
              hash: route.hash,
            });
            const resolved = routes.resolveTarget(nextPath, undefined, {
              state: route.state,
            });
            rrHistory.replace(
              toHistoryLocation(
                resolved.pathname,
                resolved.query,
                resolved.hash,
                route.state,
              ),
            );
          },
          [route, rrHistory],
        );

        const setQuery = useCallback(
          (queryInput: QueryInput, options?: SetQueryOptions) => {
            const shouldReplace = options?.replace ?? true;
            const shouldMerge = options?.merge ?? true;

            const baseQuery = shouldMerge ? { ...route.query } : {};
            const nextQuery: Record<string, any> = { ...baseQuery };

            for (const [key, value] of Object.entries(queryInput)) {
              if (value === undefined || value === null) {
                delete nextQuery[key];
              } else {
                const normalized = normalizeQueryInput({ [key]: value });
                if (key in normalized) {
                  nextQuery[key] = normalized[key];
                } else {
                  delete nextQuery[key];
                }
              }
            }

            const loc = toHistoryLocation(
              route.pathname,
              nextQuery,
              route.hash,
              route.state,
            );
            if (shouldReplace) {
              rrHistory.replace(loc);
            } else {
              rrHistory.push(loc);
            }
          },
          [route, rrHistory],
        );

        const buildUrl = useCallback(
          (
            target: NavigationTarget<TName>,
            params?: RouteParams,
            options?: NavigationOptions,
          ) => routes.resolveTarget(target, params, options).path,
          [],
        );

        return useMemo<RouterController<TName>>(
          () => ({
            navigate,
            push,
            replace,
            goBack,
            canGoBack,
            reset,
            setParams,
            setQuery,
            buildUrl,
            route,
            platform: 'web',
          }),
          [
            navigate,
            push,
            replace,
            goBack,
            canGoBack,
            reset,
            setParams,
            setQuery,
            buildUrl,
            route,
          ],
        );
      },

      useIsFocused: () => true,

      useFocusEffect: (effect: () => void | (() => void)) => {
        useEffect(() => {
          const cleanup = effect();
          return () => {
            if (typeof cleanup === 'function') cleanup();
          };
        }, [effect]);
      },

      useNavigationGuard: (
        when: boolean,
        messageOrHandler?: string | NavigationGuardCallback,
      ) => {
        const rrHistory = useHistory();
        const internal = useContext(WebInternalContext)!;
        const handlerRef = useRef(messageOrHandler);
        handlerRef.current = messageOrHandler;

        useEffect(() => {
          if (!when) return;

          const unblock = rrHistory.block((nextLocation, action) => {
            if (internal.isResettingRef.current) {
              return undefined;
            }

            const currentHandler = handlerRef.current;

            if (typeof currentHandler === 'function') {
              let prevented = false;
              let proceeded = false;

              const proceed = () => {
                proceeded = true;
                unblock();
                if (action === 'REPLACE') {
                  rrHistory.replace(nextLocation);
                } else if (action === 'POP') {
                  rrHistory.goBack();
                } else {
                  rrHistory.push(nextLocation);
                }
              };

              const result = currentHandler({
                action: mapHistoryAction(action),
                proceed,
                preventDefault: () => {
                  prevented = true;
                },
              });

              if (proceeded) {
                return false;
              }
              if (prevented || result === false) {
                return false;
              }
              if (typeof result === 'string') {
                return internal.isMemoryWithoutConfirmation ? false : result;
              }
              return undefined;
            }

            if (typeof currentHandler === 'string') {
              return internal.isMemoryWithoutConfirmation
                ? false
                : currentHandler;
            }

            return false;
          });

          return () => {
            unblock();
          };
        }, [when, rrHistory, internal]);
      },
    }),
    [routes],
  );

  const contextValue = useMemo(
    () => ({ registry: routes, adapter }),
    [routes, adapter],
  );

  return (
    <WebInternalContext.Provider value={internalState}>
      <UniversalRouterContext.Provider value={contextValue}>
        {children}
      </UniversalRouterContext.Provider>
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
  useExistingRouter,
}: WebRouterProviderProps<TName>) {
  const existingRouter = useContext(__RouterContext);

  const shouldReuseExisting =
    useExistingRouter === true ||
    (useExistingRouter === undefined &&
      !history &&
      !routerType &&
      existingRouter != null);

  const hasCustomConfirmation = typeof getUserConfirmation === 'function';
  const resolvedType = routerType ?? 'browser';
  const isMemoryWithoutConfirmation =
    !shouldReuseExisting &&
    !history &&
    resolvedType === 'memory' &&
    !hasCustomConfirmation;

  const bridge = (
    <WebRouterBridge
      routes={routes}
      hasCustomConfirmation={hasCustomConfirmation}
      isMemoryWithoutConfirmation={isMemoryWithoutConfirmation}
    >
      {children}
    </WebRouterBridge>
  );

  if (shouldReuseExisting) {
    return bridge;
  }

  if (history) {
    return <Router history={history}>{bridge}</Router>;
  }

  if (resolvedType === 'memory') {
    return (
      <MemoryRouter
        initialEntries={initialEntries ?? ['/']}
        initialIndex={initialIndex}
        getUserConfirmation={getUserConfirmation}
      >
        {bridge}
      </MemoryRouter>
    );
  }

  if (resolvedType === 'hash') {
    return (
      <HashRouter
        basename={basename}
        getUserConfirmation={getUserConfirmation}
      >
        {bridge}
      </HashRouter>
    );
  }

  return (
    <BrowserRouter
      basename={basename}
      getUserConfirmation={getUserConfirmation}
    >
      {bridge}
    </BrowserRouter>
  );
}
