import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  CommonActions,
  NavigationContainer,
  NavigationContext,
  NavigationRouteContext,
  StackActions,
  createNavigationContainerRef,
  useFocusEffect as useRNFocusEffect,
  useIsFocused as useRNIsFocused,
} from '@react-navigation/native';
import type {
  NavigationContainerRefWithCurrent,
  NavigationState,
  ParamListBase as RNParamListBase,
  PartialState,
  Route as RNRoute,
} from '@react-navigation/native';
import { UniversalRouterContext } from '../context';
import { formatRelativeUrl, normalizeHash, normalizeQueryInput } from '../pathUtils';
import type {
  NavigationGuardAction,
  NavigationGuardCallback,
  NavigationOptions,
  NavigationTarget,
  QueryInput,
  QueryParams,
  ResetTarget,
  RouteParams,
  RouteRegistry,
  RouterAdapter,
  RouterController,
  SetQueryOptions,
  UnifiedRoute,
} from '../types';

type RNNavigationContainerProps = React.ComponentProps<typeof NavigationContainer>;

const META_KEY = '__urMeta';

interface NativeRouteMeta {
  query?: QueryParams;
  hash?: string;
  state?: unknown;
}

export interface NativeRouterProviderProps<TName extends string = string> {
  /** Shared route registry created via `defineRoutes(...)`. */
  routes: RouteRegistry<TName>;
  children: React.ReactNode;
  /** Optional prefixes for deep linking (e.g. `['myapp://', 'https://example.com']`). */
  linkingPrefixes?: string[];
  /** Optional custom React Navigation `linking` config (overrides auto-generated linking config). */
  linking?: RNNavigationContainerProps['linking'];
  /** Optional navigation container ref for imperative navigation outside screens. */
  navigationRef?: NavigationContainerRefWithCurrent<RNParamListBase>;
  /** Initial navigation state forwarded to `<NavigationContainer>`. */
  initialState?: RNNavigationContainerProps['initialState'];
  /** Forwarded to `<NavigationContainer onStateChange={...}>`. */
  onStateChange?: RNNavigationContainerProps['onStateChange'];
  /** Forwarded to `<NavigationContainer onReady={...}>`. */
  onReady?: RNNavigationContainerProps['onReady'];
  /** Forwarded to `<NavigationContainer theme={...}>`. */
  theme?: RNNavigationContainerProps['theme'];
  /** Forwarded to `<NavigationContainer independent={...}>`. */
  independent?: boolean;
  /**
   * If true, attaches to an ancestor `<NavigationContainer>` instead of mounting a new one.
   */
  useExistingContainer?: boolean;
  /**
   * Optional handler invoked if a raw URL string passed to `navigate()` does not match any registered route.
   */
  onUnmatchedUrl?: (url: string) => void;
}

interface NativeInternalContextValue {
  containerRef: NavigationContainerRefWithCurrent<RNParamListBase>;
  currentLeafRoute: RNRoute<string> | undefined;
  onUnmatchedUrl?: (url: string) => void;
}

const NativeInternalContext = createContext<NativeInternalContextValue | null>(
  null,
);

function getActiveLeafRoute(
  state?: NavigationState | PartialState<NavigationState>,
): RNRoute<string> | undefined {
  if (!state || !state.routes || state.routes.length === 0) return undefined;
  const idx = typeof state.index === 'number' ? state.index : state.routes.length - 1;
  const active = state.routes[idx] as RNRoute<string> & {
    state?: NavigationState | PartialState<NavigationState>;
  };
  if (!active) return undefined;
  if (active.state) {
    return getActiveLeafRoute(active.state) ?? active;
  }
  return active;
}

function packNativeParams(
  params: RouteParams,
  query: QueryParams,
  hash: string,
  state: unknown,
): Record<string, unknown> {
  const payload: Record<string, unknown> = { ...params };
  const hasQuery = Object.keys(query).length > 0;
  const hasHash = Boolean(hash);
  const hasState = state !== undefined;

  if (hasQuery || hasHash || hasState) {
    const meta: NativeRouteMeta = {};
    if (hasQuery) meta.query = query;
    if (hasHash) meta.hash = hash;
    if (hasState) meta.state = state;
    payload[META_KEY] = meta;
  }

  return payload;
}

function unpackNativeRoute<TName extends string>(
  rnRoute: RNRoute<string> | undefined,
  registry: RouteRegistry<TName>,
): UnifiedRoute<TName> {
  if (!rnRoute) {
    return {
      name: null,
      path: '/',
      pathname: '/',
      params: {},
      query: {},
      hash: '',
      state: undefined,
      key: undefined,
      matchedPattern: null,
    };
  }

  const rawParams = (rnRoute.params ?? {}) as Record<string, unknown>;
  const meta = (rawParams[META_KEY] ?? {}) as NativeRouteMeta;

  const cleanParams: RouteParams = {};
  const routeDef = registry.getRoute(rnRoute.name);

  for (const [key, value] of Object.entries(rawParams)) {
    if (key === META_KEY) continue;
    if (typeof value === 'string' && routeDef?.parse?.[key]) {
      cleanParams[key] = routeDef.parse[key](value);
    } else {
      cleanParams[key] = value;
    }
  }

  const query: QueryParams = meta.query ? { ...meta.query } : {};
  const hash = normalizeHash(meta.hash);
  const state = meta.state;

  let pathname = '/';
  let matchedPattern: string | null = null;
  let resolvedName: TName | null = null;

  if (routeDef) {
    resolvedName = routeDef.name;
    matchedPattern = routeDef.path;
    try {
      const built = registry.buildPath(routeDef.name, cleanParams);
      pathname = built;
    } catch {
      // Fallback if screen mounted without required path params yet
      pathname = routeDef.path;
    }
  } else {
    pathname = `/${rnRoute.name}`;
  }

  const path = formatRelativeUrl(pathname, query, hash);

  return {
    name: resolvedName,
    path,
    pathname,
    params: cleanParams,
    query,
    hash,
    state,
    key: rnRoute.key,
    matchedPattern,
  };
}

function mapReactNavActionType(actionType: string): NavigationGuardAction {
  switch (actionType) {
    case 'NAVIGATE':
      return 'navigate';
    case 'PUSH':
      return 'push';
    case 'REPLACE':
      return 'replace';
    case 'GO_BACK':
      return 'goBack';
    case 'POP':
    case 'POP_TO_TOP':
      return 'pop';
    case 'RESET':
      return 'reset';
    default:
      return 'unknown';
  }
}

function NativeRouterBridge<TName extends string>({
  routes,
  containerRef,
  currentLeafRoute,
  onUnmatchedUrl,
  children,
}: {
  routes: RouteRegistry<TName>;
  containerRef: NavigationContainerRefWithCurrent<RNParamListBase>;
  currentLeafRoute: RNRoute<string> | undefined;
  onUnmatchedUrl?: (url: string) => void;
  children: React.ReactNode;
}) {
  const internalValue = useMemo<NativeInternalContextValue>(
    () => ({ containerRef, currentLeafRoute, onUnmatchedUrl }),
    [containerRef, currentLeafRoute, onUnmatchedUrl],
  );

  const adapter = useMemo<RouterAdapter<TName>>(
    () => ({
      platform: 'native',

      useRoute: () => {
        const screenRoute = useContext(NavigationRouteContext);
        const internal = useContext(NativeInternalContext)!;
        const activeRoute = screenRoute ?? internal.currentLeafRoute;

        return useMemo(
          () => unpackNativeRoute(activeRoute, routes),
          [activeRoute],
        );
      },

      useController: () => {
        const screenNavigation = useContext(NavigationContext);
        const screenRoute = useContext(NavigationRouteContext);
        const internal = useContext(NativeInternalContext)!;

        const activeRoute = screenRoute ?? internal.currentLeafRoute;
        const route = useMemo(
          () => unpackNativeRoute(activeRoute, routes),
          [activeRoute],
        );

        const getNav = useCallback(() => {
          if (screenNavigation) return screenNavigation;
          if (internal.containerRef.isReady()) return internal.containerRef;
          return null;
        }, [screenNavigation, internal]);

        const resolveForNative = useCallback(
          (
            target: NavigationTarget<TName>,
            params?: RouteParams,
            options?: NavigationOptions,
          ) => {
            const resolved = routes.resolveTarget(target, params, options);
            if (!resolved.name) {
              if (internal.onUnmatchedUrl) {
                internal.onUnmatchedUrl(resolved.path);
                return null;
              }
              throw new Error(
                `[react-router-navigation-adapter] Cannot navigate to unmatched URL "${resolved.path}" on native. Register a matching route in defineRoutes() or provide onUnmatchedUrl.`,
              );
            }
            const payload = packNativeParams(
              resolved.params,
              resolved.query,
              resolved.hash,
              resolved.state,
            );
            return { name: resolved.name, payload };
          },
          [internal],
        );

        const navigate = useCallback(
          (
            target: NavigationTarget<TName>,
            params?: RouteParams,
            options?: NavigationOptions,
          ) => {
            const nav = getNav();
            if (!nav) return;
            const resolved = resolveForNative(target, params, options);
            if (!resolved) return;
            nav.dispatch(
              CommonActions.navigate({
                name: resolved.name,
                params: resolved.payload,
              }),
            );
          },
          [getNav, resolveForNative],
        );

        const push = useCallback(
          (
            target: NavigationTarget<TName>,
            params?: RouteParams,
            options?: NavigationOptions,
          ) => {
            const nav = getNav();
            if (!nav) return;
            const resolved = resolveForNative(target, params, options);
            if (!resolved) return;

            const state = nav.getState?.();
            if (!state || state.type === 'stack') {
              nav.dispatch(StackActions.push(resolved.name, resolved.payload));
            } else {
              nav.dispatch(
                CommonActions.navigate({
                  name: resolved.name,
                  params: resolved.payload,
                }),
              );
            }
          },
          [getNav, resolveForNative],
        );

        const replace = useCallback(
          (
            target: NavigationTarget<TName>,
            params?: RouteParams,
            options?: NavigationOptions,
          ) => {
            const nav = getNav();
            if (!nav) return;
            const resolved = resolveForNative(target, params, options);
            if (!resolved) return;

            const state = nav.getState?.();
            if (!state || state.type === 'stack') {
              nav.dispatch(StackActions.replace(resolved.name, resolved.payload));
            } else {
              nav.dispatch(
                CommonActions.navigate({
                  name: resolved.name,
                  params: resolved.payload,
                }),
              );
            }
          },
          [getNav, resolveForNative],
        );

        const canGoBack = useCallback(() => {
          const nav = getNav();
          return nav ? nav.canGoBack() : false;
        }, [getNav]);

        const goBack = useCallback(() => {
          const nav = getNav();
          if (nav && nav.canGoBack()) {
            nav.goBack();
          }
        }, [getNav]);

        const reset = useCallback(
          (targets: ResetTarget<TName>[], index?: number) => {
            const nav = getNav();
            if (!nav || !targets || targets.length === 0) return;

            const mappedRoutes = targets
              .map((entry) => {
                if (typeof entry === 'string') {
                  return resolveForNative(entry);
                }
                return resolveForNative(entry.name, entry.params, {
                  query: entry.query,
                  hash: entry.hash,
                  state: entry.state,
                });
              })
              .filter(
                (item): item is { name: TName; payload: Record<string, unknown> } =>
                  item !== null,
              )
              .map((item) => ({
                name: item.name,
                params: item.payload,
              }));

            if (mappedRoutes.length === 0) return;

            const targetIndex =
              index === undefined
                ? mappedRoutes.length - 1
                : Math.max(0, Math.min(index, mappedRoutes.length - 1));

            nav.dispatch(
              CommonActions.reset({
                index: targetIndex,
                routes: mappedRoutes,
              }),
            );
          },
          [getNav, resolveForNative],
        );

        const setParams = useCallback(
          (partialParams: RouteParams) => {
            const nav = getNav();
            if (!nav) return;
            if ('setParams' in nav && typeof nav.setParams === 'function') {
              nav.setParams(partialParams as never);
            } else {
              nav.dispatch(CommonActions.setParams(partialParams));
            }
          },
          [getNav],
        );

        const setQuery = useCallback(
          (queryInput: QueryInput, options?: SetQueryOptions) => {
            const nav = getNav();
            if (!nav) return;
            const shouldMerge = options?.merge ?? true;

            const nextQuery: QueryParams = shouldMerge ? { ...route.query } : {};
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

            const nextMeta: NativeRouteMeta = {
              ...(Object.keys(nextQuery).length > 0 ? { query: nextQuery } : {}),
              ...(route.hash ? { hash: route.hash } : {}),
              ...(route.state !== undefined ? { state: route.state } : {}),
            };

            const patch = { [META_KEY]: nextMeta };
            if ('setParams' in nav && typeof nav.setParams === 'function') {
              nav.setParams(patch as never);
            } else {
              nav.dispatch(CommonActions.setParams(patch));
            }
          },
          [getNav, route],
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
            platform: 'native',
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

      useIsFocused: () => {
        const nav = useContext(NavigationContext);
        if (!nav) return true;
        // eslint-disable-next-line react-hooks/rules-of-hooks
        return useRNIsFocused();
      },

      useFocusEffect: (effect: () => void | (() => void)) => {
        const nav = useContext(NavigationContext);
        if (nav) {
          // eslint-disable-next-line react-hooks/rules-of-hooks
          useRNFocusEffect(effect);
        } else {
          // eslint-disable-next-line react-hooks/rules-of-hooks
          useEffect(() => {
            const cleanup = effect();
            return () => {
              if (typeof cleanup === 'function') cleanup();
            };
          }, [effect]);
        }
      },

      useNavigationGuard: (
        when: boolean,
        messageOrHandler?: string | NavigationGuardCallback,
      ) => {
        const screenNavigation = useContext(NavigationContext);
        const handlerRef = useRef(messageOrHandler);
        handlerRef.current = messageOrHandler;
        const bypassOnceRef = useRef(false);

        useEffect(() => {
          if (!when || !screenNavigation) return;

          const unsubscribe = screenNavigation.addListener(
            'beforeRemove',
            (e: any) => {
              if (bypassOnceRef.current) {
                bypassOnceRef.current = false;
                return;
              }

              const currentHandler = handlerRef.current;
              const action = mapReactNavActionType(e?.data?.action?.type ?? '');

              if (typeof currentHandler === 'function') {
                let prevented = false;
                let proceeded = false;

                const proceed = () => {
                  proceeded = true;
                  bypassOnceRef.current = true;
                  screenNavigation.dispatch(e.data.action);
                };

                const result = currentHandler({
                  action,
                  proceed,
                  preventDefault: () => {
                    prevented = true;
                    e.preventDefault();
                  },
                });

                if (proceeded) {
                  e.preventDefault();
                  return;
                }

                if (prevented || result === false || typeof result === 'string') {
                  e.preventDefault();
                }
                return;
              }

              // String prompt or unconditional block prevents removal on native
              e.preventDefault();
            },
          );

          return unsubscribe;
        }, [when, screenNavigation]);
      },
    }),
    [routes],
  );

  const contextValue = useMemo(
    () => ({ registry: routes, adapter }),
    [routes, adapter],
  );

  return (
    <NativeInternalContext.Provider value={internalValue}>
      <UniversalRouterContext.Provider value={contextValue}>
        {children}
      </UniversalRouterContext.Provider>
    </NativeInternalContext.Provider>
  );
}

/**
 * Native `<RouterProvider>` backed by React Navigation.
 */
export function NativeRouterProvider<TName extends string = string>({
  routes,
  children,
  linkingPrefixes,
  linking,
  navigationRef: externalRef,
  initialState,
  onStateChange,
  onReady,
  theme,
  independent,
  useExistingContainer,
  onUnmatchedUrl,
}: NativeRouterProviderProps<TName>) {
  const internalRef = useRef<NavigationContainerRefWithCurrent<RNParamListBase> | null>(
    null,
  );
  if (!internalRef.current) {
    internalRef.current = createNavigationContainerRef<RNParamListBase>();
  }
  const containerRef = externalRef ?? internalRef.current;

  const existingNav = useContext(NavigationContext);
  const shouldReuseExisting =
    useExistingContainer === true ||
    (useExistingContainer === undefined && existingNav != null && !independent);

  const [currentLeafRoute, setCurrentLeafRoute] = useState<
    RNRoute<string> | undefined
  >(() => getActiveLeafRoute(initialState));

  const resolvedLinking = useMemo(() => {
    if (linking !== undefined) return linking;
    if (linkingPrefixes && linkingPrefixes.length > 0) {
      return routes.toLinkingConfig(linkingPrefixes) as RNNavigationContainerProps['linking'];
    }
    return undefined;
  }, [linking, linkingPrefixes, routes]);

  const handleReady = useCallback(() => {
    if (containerRef.isReady()) {
      setCurrentLeafRoute(getActiveLeafRoute(containerRef.getRootState()));
    }
    onReady?.();
  }, [containerRef, onReady]);

  const handleStateChange = useCallback(
    (state: NavigationState | undefined) => {
      setCurrentLeafRoute(getActiveLeafRoute(state));
      onStateChange?.(state);
    },
    [onStateChange],
  );

  const bridge = (
    <NativeRouterBridge
      routes={routes}
      containerRef={containerRef}
      currentLeafRoute={currentLeafRoute}
      onUnmatchedUrl={onUnmatchedUrl}
    >
      {children}
    </NativeRouterBridge>
  );

  if (shouldReuseExisting) {
    return bridge;
  }

  return (
    <NavigationContainer
      ref={containerRef}
      linking={resolvedLinking}
      initialState={initialState}
      onStateChange={handleStateChange}
      onReady={handleReady}
      theme={theme}
      independent={independent}
    >
      {bridge}
    </NavigationContainer>
  );
}
