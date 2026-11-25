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
import { backAtRoot, mergeQuery, resolveParamsUpdate, runGuard } from '../shared';
import type {
  BackAtRootContext,
  GetUserConfirmation,
  HistoryAction,
  NavigationGuardAction,
  NavigationGuardCallback,
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
  /** Full pathname for non-exact routes. */
  pathname?: string;
}

export interface NativeRouterProviderProps<TName extends string = string> {
  /** Shared route registry created via `defineRoutes(...)`. */
  routes: RouteRegistry<TName>;
  children: React.ReactNode;
  /**
   * Open at this URL (e.g. `/myBets/42?type=million`). With an own container it is the initial
   * state; in a reused (host) container it is navigated to once the screen's navigator mounts.
   */
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
  /** Register a guard; `routeKey` is the screen it is mounted in (null: outside screens). */
  addGuard: (handler: GuardHandlerRef, routeKey: string | null) => () => void;
  /**
   * Runs layout guards and guards of focused screens (plus `include`, minus `exclude`).
   * Returns true when the navigation may continue now; `proceed` is called later otherwise.
   */
  runGuards: (
    action: NavigationGuardAction,
    proceed: () => void,
    options?: { nextPath?: string; include?: string[]; exclude?: string[] },
  ) => boolean;
  hasGuards: () => boolean;
}

type GuardHandlerRef = React.MutableRefObject<string | NavigationGuardCallback | undefined>;

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

/** A mounted navigator state (partial states of unmounted navigators have no `routeNames`). */
const isMounted = (state: any): state is NavigationState =>
  Boolean(state?.key && Array.isArray(state.routeNames));

/** Route keys on the focused path, outermost first. */
function getFocusedKeys(root: NavigationState | undefined): string[] {
  const keys: string[] = [];
  let state: any = root;
  while (state?.routes?.length) {
    const route = state.routes[state.index ?? state.routes.length - 1];
    if (!route) break;
    keys.push(route.key);
    state = route.state;
  }
  return keys;
}

/**
 * Path of mounted navigator states from `root` to a navigator that has a screen `name`:
 * the focused branch first (deepest match wins), then any other mounted branch.
 */
function findPathTo(root: NavigationState, name: string): Array<{ state: NavigationState; via?: string }> | undefined {
  const focused: Array<{ state: NavigationState; via?: string }> = [];
  let best: typeof focused | undefined;
  let state: any = root;
  let via: string | undefined;
  while (isMounted(state)) {
    focused.push({ state, via });
    if (state.routeNames.includes(name)) best = [...focused];
    const route: any = state.routes[state.index];
    via = route?.name;
    state = route?.state;
  }
  if (best) return best;

  const search = (s: NavigationState, path: Array<{ state: NavigationState; via?: string }>): typeof path | undefined => {
    if (s.routeNames.includes(name)) return path;
    for (const route of s.routes as any[]) {
      if (isMounted(route.state)) {
        const found = search(route.state, [...path, { state: route.state, via: route.name }]);
        if (found) return found;
      }
    }
    return undefined;
  };
  return search(root, [{ state: root }]);
}

/** `{ screen, params }` nesting for React Navigation's navigate-to-nested-screen syntax. */
function nestParams(names: string[], params: object): object {
  return names.length === 0 ? params : { screen: names[0], params: nestParams(names.slice(1), params) };
}

/** Partial state for `names` (outer navigator routes first) ending in `leafRoutes`. */
function nestState(names: string[], leafRoutes: Array<{ name: string; params?: object }>, index: number): any {
  if (names.length === 0) return { index, routes: leafRoutes };
  return { routes: [{ name: names[0], state: nestState(names.slice(1), leafRoutes, index) }] };
}

/**
 * Where a native screen lives and how to reach it from the current focus.
 * `navigators[i]` is the mounted navigator that has `names[i]` as a screen.
 */
interface NavigationPlan {
  names: string[];
  navigators: NavigationState[];
  /** Index into `names` of the deepest focused mounted navigator on the way. */
  focusedDepth: number;
  /** Navigator that has the screen itself, when mounted. */
  owner?: NavigationState;
  /** The owner is mounted and on the focused path: plain push/replace apply. */
  ownerFocused: boolean;
}

function planNavigation(root: NavigationState | undefined, registry: RouteRegistry<any>, name: string): NavigationPlan | undefined {
  if (!root) return undefined;
  const chain = [...(registry.getRoute(name)?.nestedIn ?? []), name];
  const prefix = findPathTo(root, chain[0]);
  if (!prefix) return undefined;
  const names = [...prefix.slice(1).map((p) => p.via!), ...chain];
  const navigators: NavigationState[] = prefix.map((p) => p.state);

  // Walk further down the chain through navigators that are already mounted.
  while (navigators.length < names.length) {
    const nav = navigators[navigators.length - 1] as any;
    const routeName = names[navigators.length - 1];
    const focusedRoute = nav.routes[nav.index];
    const route = focusedRoute?.name === routeName ? focusedRoute : [...nav.routes].reverse().find((r: any) => r.name === routeName);
    if (!isMounted(route?.state)) break;
    navigators.push(route.state);
  }

  let focusedDepth = 0;
  while (
    focusedDepth < navigators.length - 1 &&
    (navigators[focusedDepth] as any).routes[navigators[focusedDepth].index]?.state === navigators[focusedDepth + 1]
  ) {
    focusedDepth += 1;
  }
  const owner = navigators.length === names.length ? navigators[names.length - 1] : undefined;
  if (owner && !owner.routeNames.includes(name)) return undefined;
  return { names, navigators, focusedDepth, owner, ownerFocused: Boolean(owner) && focusedDepth === names.length - 1 };
}

function packParams(
  registry: RouteRegistry<any>,
  resolved: Pick<ResolvedNavigationIntent, 'name' | 'params' | 'query' | 'hash' | 'state' | 'pathname'>,
) {
  const meta: NativeRouteMeta = {};
  if (Object.keys(resolved.query).length > 0) meta.query = resolved.query;
  if (resolved.hash) meta.hash = resolved.hash;
  if (resolved.state !== undefined) meta.state = resolved.state;
  // Non-exact routes keep the full URL pathname (e.g. '/bets/123' matched by '/bets').
  if (resolved.name && registry.getRoute(resolved.name)?.exact === false) meta.pathname = resolved.pathname;
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

  const query = { ...meta.query, ...flatQuery };
  const hash = normalizeHash(meta.hash);
  let pathname = `/${rnRoute.name}`;
  if (meta.pathname) {
    pathname = meta.pathname;
  } else if (definition) {
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
 * Screens with `nestedIn` get nested navigator state; the outermost name is a screen of the
 * root `<RouterView>` navigator.
 */
export function getStateFromUrl(
  registry: RouteRegistry<any>,
  url: string,
): PartialState<NavigationState> | undefined {
  const resolved = registry.resolveTarget(/^\/|:\/\//.test(url) ? url : `/${url}`);
  const definition = resolved.name ? registry.getRoute(resolved.name) : undefined;
  if (!definition?.native) return undefined;
  return nestState(definition.nestedIn ?? [], [{ name: resolved.name!, params: packParams(registry, resolved) }], 0);
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
  const root = () => (ref.isReady() ? ref.getRootState() : undefined);

  /**
   * Central guards (layout guards and guards of focused screens) for navigation that React
   * Navigation would not stop with `usePreventRemove`. `removing` lists screens whose own guards
   * already run through `usePreventRemove` for this action.
   */
  const guarded = (
    action: NavigationGuardAction,
    nextPath: string | undefined,
    perform: () => void,
    removing: string[] = [],
  ) => {
    if (internal.runGuards(action, perform, { nextPath, exclude: removing, include: rnRoute ? [rnRoute.key] : [] })) {
      perform();
    }
  };

  const openWeb = (url: string) => {
    if (!internal.openWeb) {
      throw new Error(
        `[react-router-navigation-adapter] "${url}" has no native screen. Mark the route \`native: true\` and render it in <RouterView>, or pass \`openWeb\` to <RouterProvider>.`,
      );
    }
    const open = internal.openWeb;
    guarded('navigate', url, () => open(url));
  };

  /** Resolve a target to a native screen and where it lives, or open it on web. */
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
    const plan = isNative ? planNavigation(root(), registry, resolved.name!) : undefined;
    if (!plan) {
      if (allowWeb) openWeb(resolved.path);
      else console.warn(`[react-router-navigation-adapter] Skipping "${resolved.path}": no native screen.`);
      return null;
    }
    return { resolved, name: resolved.name!, payload: packParams(registry, resolved), plan };
  };
  type Resolution = NonNullable<ReturnType<typeof resolve>>;

  const dispatch = (action: NavigationAction, navigator: NavigationState, source?: string) =>
    ref.dispatch({ ...action, target: navigator.key, ...(source ? { source } : {}) } as NavigationAction);

  /** The screen is in an unfocused or unmounted branch: navigate there from the focused navigator. */
  const navigateNested = (r: Resolution) => {
    const { names, navigators, focusedDepth } = r.plan;
    dispatch(
      CommonActions.navigate(names[focusedDepth], nestParams(names.slice(focusedDepth + 1), r.payload)),
      navigators[focusedDepth],
    );
  };

  const pushOrNavigate = (r: Resolution) => {
    if (!r.plan.ownerFocused) return navigateNested(r);
    const owner = r.plan.owner!;
    dispatch(
      owner.type === 'stack' ? StackActions.push(r.name, r.payload) : CommonActions.navigate(r.name, r.payload),
      owner,
    );
  };

  /** Replace the params of the current screen without remounting it (guarded when the pathname changes). */
  const replaceInPlace = (next: ResolvedNavigationIntent<TName>) => {
    if (!rnRoute) return;
    const owner = findNavigatorOf(root(), rnRoute.key);
    if (!owner) return;
    const perform = () => dispatch(CommonActions.replaceParams(packParams(registry, next)), owner, rnRoute.key);
    if (next.pathname === route.pathname) perform();
    else guarded('replace', next.path, perform);
  };

  const isCurrentScreen = (name: string) => rnRoute != null && rnRoute.name === name;
  const leafKey = () => rnRoute?.key ?? getFocusedKeys(root()).pop();

  const controller: RouterController<TName> = {
    platform: 'native',
    route,
    buildUrl: (target, params, options) => registry.resolveTarget(target, params, options).path,
    navigate: (target, params, options) => {
      const r = resolve(target, params, options);
      if (!r) return;
      // Same location: update in place. Otherwise add an entry, like `history.push` on web
      // (React Navigation's NAVIGATE would reuse a same-name screen instead).
      if (isCurrentScreen(r.name) && r.resolved.path === route.path) replaceInPlace(r.resolved);
      else guarded('navigate', r.resolved.path, () => pushOrNavigate(r));
    },
    push: (target, params, options) => {
      const r = resolve(target, params, options);
      if (r) guarded('push', r.resolved.path, () => pushOrNavigate(r));
    },
    replace: (target, params, options) => {
      const r = resolve(target, params, options);
      if (!r) return;
      if (isCurrentScreen(r.name)) return replaceInPlace(r.resolved);
      if (!r.plan.ownerFocused) return guarded('replace', r.resolved.path, () => navigateNested(r));
      const owner = r.plan.owner!;
      if (owner.type !== 'stack') return guarded('replace', r.resolved.path, () => dispatch(CommonActions.navigate(r.name, r.payload), owner));
      // The replaced screen's own guard runs through usePreventRemove.
      const removed = rnRoute?.key ?? (owner.routes[owner.index]?.key as string);
      guarded('replace', r.resolved.path, () => dispatch(StackActions.replace(r.name, r.payload), owner, rnRoute?.key), [removed]);
    },
    canGoBack: () =>
      screenNavigation ? screenNavigation.canGoBack() : ref.isReady() && ref.canGoBack(),
    getLength: () => {
      const key = leafKey();
      const owner = key ? findNavigatorOf(root(), key) : undefined;
      return owner ? owner.index + 1 : 1;
    },
    go: (delta) => {
      if (delta >= 0) return;
      const n = -delta;
      const key = leafKey();
      const owner = key ? findNavigatorOf(root(), key) : undefined;
      if (owner?.type === 'stack' && n <= owner.index) {
        // One action, so guards run once (popped screens through usePreventRemove).
        const popped = owner.routes.slice(owner.index - n + 1, owner.index + 1).map((r) => r.key);
        guarded('goBack', undefined, () => dispatch(StackActions.pop(n), owner), popped);
      } else if (n === 1 || !owner || owner.index === 0) {
        controller.goBack();
      } else {
        // Further back than this stack: same as going back from its root.
        backAtRoot(registry, route, controller, internal.onBackAtRoot, (proceed) =>
          internal.runGuards('goBack', proceed, { include: rnRoute ? [rnRoute.key] : [] }),
        );
      }
    },
    goBack: () => {
      if (controller.canGoBack()) {
        const key = leafKey();
        guarded('goBack', undefined, () => (screenNavigation ?? ref).goBack(), key ? [key] : []);
      } else {
        backAtRoot(registry, route, controller, internal.onBackAtRoot, (proceed) =>
          internal.runGuards('goBack', proceed, { include: rnRoute ? [rnRoute.key] : [] }),
        );
      }
    },
    reset: (targets, index) => {
      const resolved = (targets ?? [])
        .map((entry) =>
          typeof entry === 'string'
            ? resolve(entry, undefined, undefined, false)
            : resolve(entry.name, entry.params, entry, false),
        )
        .filter((r): r is Resolution => r !== null);
      if (resolved.length === 0) return;
      const { plan } = resolved[0];
      const routes = resolved
        .filter((r) => r.plan.names.join('/') === plan.names.join('/'))
        .map((r) => ({ name: r.name, params: r.payload }));
      const last = index === undefined ? routes.length - 1 : Math.max(0, Math.min(index, routes.length - 1));
      // Reset the owner when focused, else the deepest focused navigator on the way to it.
      const depth = plan.ownerFocused ? plan.names.length - 1 : plan.focusedDepth;
      const navigator = plan.navigators[depth];
      const state =
        depth === plan.names.length - 1
          ? { index: last, routes }
          : { index: 0, routes: [{ name: plan.names[depth], state: nestState(plan.names.slice(depth + 1, -1), routes, last) }] };
      // Screens being removed run their own guards through usePreventRemove.
      const removing = getFocusedKeys(root()).filter((key) => findNavigatorOf(navigator, key));
      guarded('reset', resolved[resolved.length - 1].resolved.path, () => dispatch(CommonActions.reset(state as any), navigator), removing);
    },
    setParams: (partial) => {
      const next = resolveParamsUpdate(registry, route, partial);
      if (next) replaceInPlace(next);
    },
    setQuery: (input, options) => {
      const next = { ...route, query: mergeQuery(route.query, input, options?.merge ?? true) };
      if (options?.replace ?? true) replaceInPlace({ ...next, path: formatRelativeUrl(next.pathname, next.query, next.hash) });
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

      // Every guard is registered centrally: it covers navigation that does not remove its
      // screen (push, tabs, openWeb, in-place param changes, back at the root) and guards
      // outside screens. Inside screens, usePreventRemove covers removal (back, swipe, replace,
      // reset) and makes native-stack set `preventNativeDismiss` (iOS swipe-back).
      useNavigationGuard: (when, messageOrHandler) => {
        const nav = useContext(NavigationContext);
        const screenRoute = useContext(NavigationRouteContext);
        const ctx = useContext(NativeInternalContext)!;
        const handlerRef = useRef(messageOrHandler);
        handlerRef.current = messageOrHandler;
        const routeKey = screenRoute?.key ?? null;
        useEffect(() => (when ? ctx.addGuard(handlerRef, routeKey) : undefined), [when, ctx, routeKey]);
        if (!nav) return;
        // Like web, where a covered screen is unmounted, a guard is active only while its
        // screen is focused: popping several screens asks once, for the visible one.
        // eslint-disable-next-line react-hooks/rules-of-hooks
        const focused = useRNIsFocused();
        // eslint-disable-next-line react-hooks/rules-of-hooks
        usePreventRemove(when && focused, ({ data }) => {
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
  const confirm: GetUserConfirmation = (message, callback) =>
    (callbacksRef.current.getUserConfirmation ?? defaultConfirm)(message, callback);
  const guardsRef = useRef(new Set<{ handler: GuardHandlerRef; routeKey: string | null }>());
  const bypassRef = useRef(false);

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
      confirm,
      addGuard: (handler, routeKey) => {
        const entry = { handler, routeKey };
        guardsRef.current.add(entry);
        return () => {
          guardsRef.current.delete(entry);
        };
      },
      hasGuards: () => guardsRef.current.size > 0,
      runGuards: (action, proceed, options = {}) => {
        if (bypassRef.current || guardsRef.current.size === 0) return true;
        const active = new Set([
          ...getFocusedKeys(containerRef.isReady() ? containerRef.getRootState() : undefined),
          ...(options.include ?? []),
        ]);
        for (const key of options.exclude ?? []) active.delete(key);
        // Replays after an async confirmation skip the central guards (already confirmed).
        const replay = () => {
          bypassRef.current = true;
          try {
            proceed();
          } finally {
            bypassRef.current = false;
          }
        };
        for (const { handler, routeKey } of Array.from(guardsRef.current).reverse()) {
          if (routeKey !== null && !active.has(routeKey)) continue;
          if (!runGuard(handler.current, action, replay, confirm, options.nextPath)) return false;
        }
        return true;
      },
    }),
    [containerRef],
  );

  // Reused (host) container: it has its own state, so open `initialUrl` by navigating to it once
  // the target screen's navigator is mounted (non-native URLs go to openWeb right away).
  const pendingUrlRef = useRef(reuse && !initialState ? initialUrl : undefined);
  useEffect(() => {
    const open = () => {
      const url = pendingUrlRef.current;
      if (!url || !containerRef.isReady()) return;
      const resolved = routes.resolveTarget(/^\/|:\/\//.test(url) ? url : `/${url}`);
      const isNative = resolved.name != null && routes.getRoute(resolved.name)?.native === true;
      if (isNative && !planNavigation(containerRef.getRootState(), routes, resolved.name!)) return;
      pendingUrlRef.current = undefined;
      const leaf = snapshotRef.current.leaf;
      createNativeController(routes, internal, undefined, leaf, unpackNativeRoute(leaf, routes)).navigate(resolved.path);
    };
    open();
    return pendingUrlRef.current ? containerRef.addListener('state', open) : undefined;
  }, [containerRef, internal, routes]);

  // Android hardware back. Registered after the container's own handler, so it runs first:
  // - React Navigation can go back: run layout/ancestor guards (the leaf screen's own guard runs
  //   through usePreventRemove), then let React Navigation handle it.
  // - Nothing to go back to: same guarded fallback as `goBack()`.
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!containerRef.isReady()) return false;
      const leaf = snapshotRef.current.leaf;
      if (containerRef.canGoBack()) {
        if (!internal.hasGuards()) return false;
        const goBack = () => containerRef.goBack();
        return !internal.runGuards('goBack', goBack, { exclude: leaf ? [leaf.key] : [] });
      }
      const route = unpackNativeRoute(leaf, routes);
      if (!internal.onBackAtRoot && !routes.resolveParent(route)) return false;
      createNativeController(routes, internal, undefined, leaf, route).goBack();
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

/**
 * Registers a guard from outside `useNavigationGuard` (compat `history.block`). Like
 * React Router's `history.block` it applies globally (not tied to a screen); returns unblock.
 */
export function useGuardRegistration(): (handler: NavigationGuardCallback) => () => void {
  const ctx = useContext(NativeInternalContext)!;
  return useMemo(() => (handler) => ctx.addGuard({ current: handler }, null), [ctx]);
}
