import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { Alert, BackHandler } from 'react-native';
import {
  CommonActions,
  NavigationContainer,
  NavigationContainerRefContext,
  NavigationContext,
  NavigationIndependentTree,
  NavigationRouteContext,
  StackActions,
  createNavigationContainerRef,
  useFocusEffect as useRNFocusEffect,
  useIsFocused as useRNIsFocused,
  usePreventRemove,
} from '@react-navigation/native';
import type {
  LinkingOptions,
  NavigationAction,
  NavigationContainerRef,
  NavigationState,
  ParamListBase as RNParamListBase,
  PartialState,
  Route as RNRoute,
} from '@react-navigation/native';
import { UniversalRouterContext } from '../context';
import { formatRelativeUrl, normalizeHash } from '../pathUtils';
import { backAtRoot, mergeQuery, runGuard } from '../shared';
import type {
  BackAtRootContext,
  GetUserConfirmation,
  HistoryAction,
  NavigationGuardAction,
  NavigationListener,
  NavigationOptions,
  NavigationTarget,
  QueryParams,
  ResolvedNavigationIntent,
  RouteParams,
  RouteRegistry,
  RouterAdapter,
  RouterController,
  UnifiedRoute,
} from '../types';

type ContainerProps = React.ComponentProps<typeof NavigationContainer>;
type ContainerRef = NavigationContainerRef<RNParamListBase>;
type AnyState = NavigationState | PartialState<NavigationState>;

/** Route param holding query/hash/state set through this adapter. */
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
  /** Open the container at this URL (e.g. `/myBets/42?type=million`). Ignored when reusing a container. */
  initialUrl?: string;
  /** Deep-link prefixes (e.g. `['myapp://']`). Enables the generated `linking` config. */
  linkingPrefixes?: string[];
  /** Custom React Navigation `linking` config (overrides the generated one). See `createLinking`. */
  linking?: ContainerProps['linking'];
  /**
   * WebView boundary: called with the URL of any target that is not a `native: true` route
   * with a mounted screen (unregistered URLs included). Without it such navigation throws.
   */
  openWeb?: (url: string) => void;
  /** Called by `goBack()` when there is nothing to go back to (e.g. close the host). Defaults to the route's `parent`. */
  onBackAtRoot?: (ctx: BackAtRootContext) => void;
  /** Confirmation for string guard prompts. Defaults to `Alert.alert` with Cancel/Leave buttons. */
  getUserConfirmation?: GetUserConfirmation;
  /** Optional navigation container ref for imperative navigation outside React. */
  navigationRef?: ReturnType<typeof createNavigationContainerRef<RNParamListBase>>;
  initialState?: ContainerProps['initialState'];
  onStateChange?: ContainerProps['onStateChange'];
  onReady?: ContainerProps['onReady'];
  theme?: ContainerProps['theme'];
  /** Render the container inside `<NavigationIndependentTree>` (React Navigation 7 replacement for `independent`). */
  independent?: boolean;
  /**
   * Attach to an ancestor `<NavigationContainer>` instead of mounting one.
   * Defaults to true when one exists and `independent` is not set.
   */
  useExistingContainer?: boolean;
}

interface Snapshot {
  leaf: RNRoute<string> | undefined;
  action: HistoryAction;
}

interface NativeInternal {
  containerRef: ContainerRef;
  getSnapshot: () => Snapshot;
  subscribeSnapshot: (onChange: () => void) => () => void;
  subscribe: (listener: NavigationListener) => () => void;
  openWeb?: (url: string) => void;
  onBackAtRoot?: (ctx: BackAtRootContext) => void;
  confirm: GetUserConfirmation;
}

const NativeInternalContext = createContext<NativeInternal | null>(null);

const noSubscription = () => () => {};

/** The screen's own route inside a screen; otherwise the focused route (re-renders on change). */
function useActiveRoute(ctx: NativeInternal): RNRoute<string> | undefined {
  const screenRoute = useContext(NavigationRouteContext) as RNRoute<string> | undefined;
  const focused = useSyncExternalStore(
    screenRoute ? noSubscription : ctx.subscribeSnapshot,
    () => (screenRoute ? undefined : ctx.getSnapshot().leaf),
  );
  return screenRoute ?? focused;
}

const defaultConfirm: GetUserConfirmation = (message, callback) =>
  Alert.alert(
    message,
    undefined,
    [
      { text: 'Cancel', style: 'cancel', onPress: () => callback(false) },
      { text: 'Leave', style: 'destructive', onPress: () => callback(true) },
    ],
    { cancelable: true, onDismiss: () => callback(false) },
  );

const GUARD_ACTIONS: Record<string, NavigationGuardAction> = {
  NAVIGATE: 'navigate',
  PUSH: 'push',
  REPLACE: 'replace',
  GO_BACK: 'goBack',
  POP: 'pop',
  POP_TO: 'pop',
  POP_TO_TOP: 'pop',
  RESET: 'reset',
};

/** Focused leaf route plus the keys of its navigator's routes. */
function getFocusedLeaf(
  state: AnyState | undefined,
): { route: RNRoute<string>; siblings: string[] } | undefined {
  if (!state?.routes?.length) return undefined;
  const route = state.routes[state.index ?? state.routes.length - 1] as RNRoute<string> & {
    state?: AnyState;
  };
  if (!route) return undefined;
  return (
    getFocusedLeaf(route.state) ?? {
      route,
      siblings: state.routes.map((r) => r.key ?? ''),
    }
  );
}

/** Deepest navigator on the focused path that has a screen called `name`. */
function findNavigatorFor(root: NavigationState | undefined, name: string): NavigationState | undefined {
  let found: NavigationState | undefined;
  let state: any = root;
  while (state) {
    if (state.routeNames?.includes(name)) found = state;
    state = state.routes?.[state.index ?? 0]?.state;
  }
  return found;
}

/** Navigator whose routes contain the route with `key`. */
function findNavigatorOf(state: any, key: string): NavigationState | undefined {
  if (!state?.routes) return undefined;
  if (state.routes.some((r: any) => r.key === key)) return state;
  for (const r of state.routes) {
    const found = findNavigatorOf(r.state, key);
    if (found) return found;
  }
  return undefined;
}

function packParams(resolved: Pick<ResolvedNavigationIntent, 'params' | 'query' | 'hash' | 'state'>) {
  const meta: NativeRouteMeta = {};
  if (Object.keys(resolved.query).length > 0) meta.query = resolved.query;
  if (resolved.hash) meta.hash = resolved.hash;
  if (resolved.state !== undefined) meta.state = resolved.state;
  return Object.keys(meta).length > 0 ? { ...resolved.params, [META_KEY]: meta } : { ...resolved.params };
}

/**
 * Converts a React Navigation route into the unified route. Params that are not path params of
 * the route are query params: React Navigation linking puts `?type=million` flat into params.
 */
export function unpackNativeRoute<TName extends string>(
  rnRoute: RNRoute<string> | undefined,
  registry: RouteRegistry<TName>,
): UnifiedRoute<TName> {
  if (!rnRoute) {
    return { name: null, path: '/', pathname: '/', params: {}, query: {}, hash: '', state: undefined, matchedPattern: null };
  }
  const definition = registry.getRoute(rnRoute.name);
  const pathParamNames = registry.getParamNames(rnRoute.name);
  const raw = (rnRoute.params ?? {}) as Record<string, unknown>;
  const meta = (raw[META_KEY] ?? {}) as NativeRouteMeta;

  const params: RouteParams = {};
  const flatQuery: QueryParams = {};
  for (const [key, value] of Object.entries(raw)) {
    if (key === META_KEY || value === undefined) continue;
    if (definition && !pathParamNames.includes(key)) {
      flatQuery[key] = Array.isArray(value) ? value.map(String) : String(value);
    } else {
      const parse = definition?.parse?.[key];
      params[key] = typeof value === 'string' && parse ? parse(value) : value;
    }
  }

  const query = { ...flatQuery, ...meta.query };
  const hash = normalizeHash(meta.hash);
  let pathname = `/${rnRoute.name}`;
  if (definition) {
    try {
      pathname = registry.buildPath(definition.name, params);
    } catch {
      pathname = definition.path; // required params not set yet
    }
  }
  return {
    name: definition ? definition.name : null,
    path: formatRelativeUrl(pathname, query, hash),
    pathname,
    params,
    query,
    hash,
    state: meta.state,
    key: rnRoute.key,
    matchedPattern: definition ? definition.path : null,
  };
}

/**
 * React Navigation state for a URL, or undefined when it is not a native route.
 * Assumes the route registry's screens are in the root navigator (as rendered by `<RouterView>`).
 */
export function getStateFromUrl(
  registry: RouteRegistry<any>,
  url: string,
): PartialState<NavigationState> | undefined {
  const resolved = registry.resolveTarget(/^\/|:\/\//.test(url) ? url : `/${url}`);
  if (!resolved.name || !registry.getRoute(resolved.name)?.native) return undefined;
  return { routes: [{ name: resolved.name, params: packParams(resolved) }] };
}

/**
 * `linking` config for `<NavigationContainer>` that parses query and hash the same way as web and
 * never leaks adapter metadata into URLs. Use it when you mount your own container.
 */
export function createLinking(
  registry: RouteRegistry<any>,
  prefixes: string[],
  openWeb?: (url: string) => void,
): LinkingOptions<RNParamListBase> {
  return {
    prefixes,
    config: registry.toLinkingConfig(prefixes).config as LinkingOptions<RNParamListBase>['config'],
    getStateFromPath: (path) => {
      const state = getStateFromUrl(registry, path);
      if (!state) openWeb?.(registry.resolveTarget(path.startsWith('/') ? path : `/${path}`).path);
      return state as any;
    },
    getPathFromState: (state) => unpackNativeRoute(getFocusedLeaf(state as AnyState)?.route, registry).path,
  };
}

function createNativeController<TName extends string>(
  registry: RouteRegistry<TName>,
  internal: NativeInternal,
  screenNavigation: any,
  rnRoute: RNRoute<string> | undefined,
  route: UnifiedRoute<TName>,
): RouterController<TName> {
  const ref = internal.containerRef;

  const openWeb = (url: string) => {
    if (!internal.openWeb) {
      throw new Error(
        `[react-router-navigation-adapter] "${url}" has no native screen. Mark the route \`native: true\` and render it in <RouterView>, or pass \`openWeb\` to <RouterProvider>.`,
      );
    }
    internal.openWeb(url);
  };

  /** Resolve a target to a native screen and the navigator that owns it, or open it on web. */
  const resolve = (
    target: NavigationTarget<TName>,
    params?: RouteParams,
    options?: NavigationOptions,
    allowWeb = true,
  ) => {
    const resolved = registry.resolveTarget(target, params, options);
    if (!ref.isReady()) {
      console.warn('[react-router-navigation-adapter] Navigation ignored: the navigation container is not ready.');
      return null;
    }
    const isNative = resolved.name != null && registry.getRoute(resolved.name)?.native === true;
    const navigator = isNative ? findNavigatorFor(ref.getRootState(), resolved.name!) : undefined;
    if (!navigator) {
      if (allowWeb) openWeb(resolved.path);
      else console.warn(`[react-router-navigation-adapter] Skipping "${resolved.path}": no native screen.`);
      return null;
    }
    return { resolved, name: resolved.name!, payload: packParams(resolved), navigator };
  };

  const dispatch = (action: NavigationAction, navigator: NavigationState, source?: string) =>
    ref.dispatch({ ...action, target: navigator.key, ...(source ? { source } : {}) } as NavigationAction);

  /** Replace the params of the current screen without remounting it. */
  const replaceInPlace = (payload: object) => {
    if (!rnRoute) return;
    const owner = findNavigatorOf(ref.getRootState(), rnRoute.key);
    if (owner) dispatch(CommonActions.replaceParams(payload), owner, rnRoute.key);
  };

  const isCurrentScreen = (name: string) => rnRoute != null && rnRoute.name === name;

  const pushOrNavigate = (r: NonNullable<ReturnType<typeof resolve>>) =>
    dispatch(
      r.navigator.type === 'stack'
        ? StackActions.push(r.name, r.payload)
        : CommonActions.navigate(r.name, r.payload),
      r.navigator,
    );

  const controller: RouterController<TName> = {
    platform: 'native',
    route,
    buildUrl: (target, params, options) => registry.resolveTarget(target, params, options).path,
    navigate: (target, params, options) => {
      const r = resolve(target, params, options);
      if (!r) return;
      // Same location: update in place. Otherwise add an entry, like `history.push` on web
      // (React Navigation's NAVIGATE would reuse a same-name screen instead).
      if (isCurrentScreen(r.name) && r.resolved.path === route.path) replaceInPlace(r.payload);
      else pushOrNavigate(r);
    },
    push: (target, params, options) => {
      const r = resolve(target, params, options);
      if (r) pushOrNavigate(r);
    },
    replace: (target, params, options) => {
      const r = resolve(target, params, options);
      if (!r) return;
      if (isCurrentScreen(r.name)) replaceInPlace(r.payload);
      else if (r.navigator.type === 'stack') dispatch(StackActions.replace(r.name, r.payload), r.navigator, rnRoute?.key);
      else dispatch(CommonActions.navigate(r.name, r.payload), r.navigator);
    },
    canGoBack: () =>
      screenNavigation ? screenNavigation.canGoBack() : ref.isReady() && ref.canGoBack(),
    goBack: () => {
      if (controller.canGoBack()) (screenNavigation ?? ref).goBack();
      else backAtRoot(registry, route, controller, internal.onBackAtRoot);
    },
    reset: (targets, index) => {
      const resolved = (targets ?? [])
        .map((entry) =>
          typeof entry === 'string'
            ? resolve(entry, undefined, undefined, false)
            : resolve(entry.name, entry.params, entry, false),
        )
        .filter((r): r is NonNullable<typeof r> => r !== null);
      if (resolved.length === 0) return;
      const navigator = resolved[0].navigator;
      const routes = resolved
        .filter((r) => r.navigator.key === navigator.key)
        .map((r) => ({ name: r.name, params: r.payload }));
      const last = index === undefined ? routes.length - 1 : Math.max(0, Math.min(index, routes.length - 1));
      dispatch(CommonActions.reset({ index: last, routes }), navigator);
    },
    setParams: (partial) => {
      if (!rnRoute) return;
      const owner = findNavigatorOf(ref.getRootState(), rnRoute.key);
      if (owner) dispatch(CommonActions.setParams(partial), owner, rnRoute.key);
    },
    setQuery: (input, options) => {
      const next = { ...route, query: mergeQuery(route.query, input, options?.merge ?? true) };
      if (options?.replace ?? true) replaceInPlace(packParams(next));
      else if (route.name) controller.push(route.name, route.params, next);
    },
  };
  return controller;
}

function NativeRouterBridge<TName extends string>({
  routes,
  internal,
  children,
}: {
  routes: RouteRegistry<TName>;
  internal: NativeInternal;
  children: React.ReactNode;
}) {
  const adapter = useMemo<RouterAdapter<TName>>(
    () => ({
      platform: 'native',

      useRoute: () => {
        const active = useActiveRoute(useContext(NativeInternalContext)!);
        return useMemo(() => unpackNativeRoute(active, routes), [active]);
      },

      useController: () => {
        const screenNavigation = useContext(NavigationContext);
        const ctx = useContext(NativeInternalContext)!;
        const active = useActiveRoute(ctx);
        return useMemo(
          () => createNativeController(routes, ctx, screenNavigation, active, unpackNativeRoute(active, routes)),
          [ctx, screenNavigation, active],
        );
      },

      // Whether a screen context exists never changes for a mounted component,
      // so the conditional hook calls below are stable.
      useIsFocused: () => {
        const nav = useContext(NavigationContext);
        // eslint-disable-next-line react-hooks/rules-of-hooks
        return nav ? useRNIsFocused() : true;
      },

      useFocusEffect: (effect) => {
        const nav = useContext(NavigationContext);
        if (nav) {
          // eslint-disable-next-line react-hooks/rules-of-hooks
          useRNFocusEffect(effect);
          return;
        }
        // eslint-disable-next-line react-hooks/rules-of-hooks
        useEffect(() => {
          const cleanup = effect();
          return () => {
            if (typeof cleanup === 'function') cleanup();
          };
        }, [effect]);
      },

      // usePreventRemove (not a bare `beforeRemove` listener) so native-stack also sets
      // `preventNativeDismiss` and blocks the iOS swipe-back gesture.
      useNavigationGuard: (when, messageOrHandler) => {
        const nav = useContext(NavigationContext);
        const ctx = useContext(NativeInternalContext)!;
        const handlerRef = useRef(messageOrHandler);
        handlerRef.current = messageOrHandler;
        if (!nav) return;
        // eslint-disable-next-line react-hooks/rules-of-hooks
        usePreventRemove(when, ({ data }) => {
          const proceed = () => nav.dispatch(data.action);
          const action = GUARD_ACTIONS[data.action.type] ?? 'unknown';
          if (runGuard(handlerRef.current, action, proceed, ctx.confirm)) proceed();
        });
      },

      useListen: () => useContext(NativeInternalContext)!.subscribe,

      useLastAction: () => {
        const ctx = useContext(NativeInternalContext)!;
        return useSyncExternalStore(ctx.subscribeSnapshot, () => ctx.getSnapshot().action);
      },
    }),
    [routes],
  );

  const contextValue = useMemo(() => ({ registry: routes, adapter }), [routes, adapter]);

  return (
    <NativeInternalContext.Provider value={internal}>
      <UniversalRouterContext.Provider value={contextValue}>{children}</UniversalRouterContext.Provider>
    </NativeInternalContext.Provider>
  );
}

/**
 * Native `<RouterProvider>` backed by React Navigation 7.
 */
export function NativeRouterProvider<TName extends string = string>({
  routes,
  children,
  initialUrl,
  linkingPrefixes,
  linking,
  openWeb,
  onBackAtRoot,
  getUserConfirmation,
  navigationRef,
  initialState,
  onStateChange,
  onReady,
  theme,
  independent,
  useExistingContainer,
}: NativeRouterProviderProps<TName>) {
  const parentContainer = useContext(NavigationContainerRefContext) as ContainerRef | undefined;
  const reuse = useExistingContainer ?? (parentContainer != null && !independent);

  const [ownRef] = useState(() => navigationRef ?? createNavigationContainerRef<RNParamListBase>());
  const containerRef: ContainerRef = (reuse && parentContainer) || ownRef;

  // Opening from a path: resolve once; non-native URLs go to the WebView instead.
  const [initial] = useState(() => {
    if (initialState || !initialUrl || reuse) return { state: initialState, webUrl: undefined };
    const state = getStateFromUrl(routes, initialUrl);
    return { state, webUrl: state ? undefined : initialUrl };
  });
  useEffect(() => {
    if (initial.webUrl) openWeb?.(initial.webUrl);
  }, [initial.webUrl, openWeb]);

  const snapshotRef = useRef<Snapshot>({ leaf: getFocusedLeaf(initial.state)?.route, action: 'POP' });
  const snapshotListenersRef = useRef(new Set<() => void>());
  const listenersRef = useRef(new Set<NavigationListener>());
  const lastRef = useRef<{ route?: RNRoute<string>; siblings: string[] }>({ siblings: [] });

  // Track the focused route for hooks used outside screens and for `listen()`.
  const syncState = useRef(() => {});
  syncState.current = () => {
    if (!containerRef.isReady()) return;
    const leaf = getFocusedLeaf(containerRef.getRootState());
    const last = lastRef.current;
    if (!leaf || leaf.route === last.route) return;
    let action: HistoryAction = 'REPLACE';
    if (last.route && leaf.route.key !== last.route.key) {
      if (last.siblings.includes(leaf.route.key)) action = 'POP';
      else if (leaf.siblings.includes(last.route.key)) action = 'PUSH';
    }
    const isInitial = !last.route;
    lastRef.current = { route: leaf.route, siblings: leaf.siblings };
    snapshotRef.current = { leaf: leaf.route, action: isInitial ? 'POP' : action };
    snapshotListenersRef.current.forEach((onChange) => onChange());
    if (!isInitial) {
      const unified = unpackNativeRoute(leaf.route, routes);
      listenersRef.current.forEach((listener) => listener(unified, action));
    }
  };
  useEffect(() => {
    const unsubscribe = containerRef.addListener('state', () => syncState.current());
    syncState.current();
    return unsubscribe;
  }, [containerRef]);

  // Host callbacks are often inline arrows: read them through a ref so context stays stable.
  const callbacksRef = useRef({ openWeb, onBackAtRoot, getUserConfirmation });
  callbacksRef.current = { openWeb, onBackAtRoot, getUserConfirmation };

  const internal = useMemo<NativeInternal>(
    () => ({
      containerRef,
      getSnapshot: () => snapshotRef.current,
      subscribeSnapshot: (onChange) => {
        snapshotListenersRef.current.add(onChange);
        return () => {
          snapshotListenersRef.current.delete(onChange);
        };
      },
      subscribe: (listener) => {
        listenersRef.current.add(listener);
        return () => {
          listenersRef.current.delete(listener);
        };
      },
      get openWeb() {
        return callbacksRef.current.openWeb;
      },
      get onBackAtRoot() {
        return callbacksRef.current.onBackAtRoot;
      },
      confirm: (message, callback) =>
        (callbacksRef.current.getUserConfirmation ?? defaultConfirm)(message, callback),
    }),
    [containerRef],
  );

  // Android hardware back with nothing to go back to: same fallback as `goBack()`.
  // Registered after the container's own handler, so it runs first and defers to it when possible.
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!containerRef.isReady() || containerRef.canGoBack()) return false;
      const leaf = snapshotRef.current.leaf;
      const route = unpackNativeRoute(leaf, routes);
      if (!internal.onBackAtRoot && !routes.resolveParent(route)) return false;
      const router = createNativeController(routes, internal, undefined, leaf, route);
      backAtRoot(routes, route, router, internal.onBackAtRoot);
      return true;
    });
    return () => subscription.remove();
  }, [containerRef, internal, routes]);

  const resolvedLinking = useMemo(
    () => linking ?? (linkingPrefixes?.length ? createLinking(routes, linkingPrefixes, openWeb) : undefined),
    [linking, linkingPrefixes, routes, openWeb],
  );

  const bridge = (
    <NativeRouterBridge routes={routes} internal={internal}>
      {children}
    </NativeRouterBridge>
  );
  if (reuse) return bridge;

  const container = (
    <NavigationContainer
      ref={ownRef as any}
      linking={resolvedLinking as any}
      initialState={initial.state as any}
      onStateChange={onStateChange}
      onReady={() => {
        syncState.current();
        onReady?.();
      }}
      theme={theme}
    >
      {bridge}
    </NavigationContainer>
  );
  return independent ? <NavigationIndependentTree>{container}</NavigationIndependentTree> : container;
}
