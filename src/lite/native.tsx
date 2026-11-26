import React, { useContext, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { Alert, Pressable } from 'react-native';
import {
  CommonActions,
  LinkingContext,
  NavigationContainerRefContext,
  NavigationContext,
  NavigationRouteContext,
  StackActions,
  findFocusedRoute,
  getActionFromState,
  getPathFromState,
  getStateFromPath,
  useFocusEffect as useRNFocusEffect,
  useIsFocused as useRNIsFocused,
  usePreventRemove,
  useStateForPath,
} from '@react-navigation/native';
import type { NavigationAction, NavigationContainerRef, ParamListBase } from '@react-navigation/native';
import { formatRelativeUrl } from '../pathUtils';
import { mergeQuery, resolveLinkActive, runGuard } from '../shared';
import type { GetUserConfirmation, NavigationGuardAction } from '../types';
import {
  resolveTo,
  toLiteLocation,
  useLiteConfig,
  type LiteGuard,
  type LiteLinkProps,
  type LiteLocation,
  type LiteNavigationAction,
  type LiteNavigationListener,
  type LiteRouter,
} from './shared';

type ContainerRef = NavigationContainerRef<ParamListBase>;

const GUARD_ACTIONS: Record<string, NavigationGuardAction> = {
  NAVIGATE: 'navigate',
  PUSH: 'push',
  REPLACE: 'replace',
  GO_BACK: 'goBack',
  POP: 'goBack',
  POP_TO: 'goBack',
  POP_TO_TOP: 'goBack',
  RESET: 'reset',
};

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

/** Guards per container, for navigation that does not remove the guarded screen (push, openWeb, back at the root). */
interface GuardEntry {
  handler: React.MutableRefObject<LiteGuard | undefined>;
  isFocused: () => boolean;
  confirm: () => GetUserConfirmation;
}
const registries = new WeakMap<object, Set<GuardEntry>>();
const guardsOf = (container: object) => {
  let guards = registries.get(container);
  if (!guards) registries.set(container, (guards = new Set()));
  return guards;
};

/** Runs the guards of focused screens; true when navigation may continue now. */
function runFocusedGuards(container: object, action: NavigationGuardAction, proceed: () => void, nextPath?: string) {
  for (const { handler, isFocused, confirm } of Array.from(guardsOf(container)).reverse()) {
    if (isFocused() && !runGuard(handler.current, action, proceed, confirm(), nextPath)) return false;
  }
  return true;
}

const LITE_HASH_KEY = '__urHash';

function splitUrlHash(url: string): { withoutHash: string; hash: string } {
  const idx = url.indexOf('#');
  if (idx === -1) return { withoutHash: url, hash: '' };
  return { withoutHash: url.slice(0, idx), hash: url.slice(idx + 1) };
}

function injectLiteHash(state: any, hash: string): any {
  if (!state || !hash || !Array.isArray(state.routes) || state.routes.length === 0) return state;
  const idx = typeof state.index === 'number' ? state.index : state.routes.length - 1;
  const target = state.routes[idx];
  if (!target) return state;
  const nextRoute =
    target.state && Array.isArray(target.state.routes) && target.state.routes.length > 0
      ? { ...target, state: injectLiteHash(target.state, hash) }
      : { ...target, params: { ...(target.params ?? {}), [LITE_HASH_KEY]: hash } };
  const nextRoutes = state.routes.slice();
  nextRoutes[idx] = nextRoute;
  return { ...state, routes: nextRoutes };
}

function extractLiteHash(state: any): { cleanState: any; hash: string } {
  if (!state || !Array.isArray(state.routes) || state.routes.length === 0) {
    return { cleanState: state, hash: '' };
  }
  const idx = typeof state.index === 'number' ? state.index : state.routes.length - 1;
  const target = state.routes[idx];
  if (!target) return { cleanState: state, hash: '' };
  if (target.state && Array.isArray(target.state.routes) && target.state.routes.length > 0) {
    const nested = extractLiteHash(target.state);
    if (!nested.hash) return { cleanState: state, hash: '' };
    const nextRoutes = state.routes.slice();
    nextRoutes[idx] = { ...target, state: nested.cleanState };
    return { cleanState: { ...state, routes: nextRoutes }, hash: nested.hash };
  }
  const params = target.params as Record<string, unknown> | undefined;
  if (!params) return { cleanState: state, hash: '' };
  if (typeof params[LITE_HASH_KEY] === 'string' && params[LITE_HASH_KEY]) {
    const hash = params[LITE_HASH_KEY] as string;
    const nextParams = { ...params };
    delete nextParams[LITE_HASH_KEY];
    const nextRoutes = state.routes.slice();
    nextRoutes[idx] = {
      ...target,
      params: Object.keys(nextParams).length > 0 ? nextParams : undefined,
    };
    return { cleanState: { ...state, routes: nextRoutes }, hash };
  }
  return { cleanState: state, hash: '' };
}

/** The app's own `linking` options (from `<NavigationContainer linking>`), with `#hash` round-tripping. */
function useLinkingHelpers() {
  const { options } = useContext(LinkingContext);
  return useMemo(
    () => ({
      toState: (url: string) => {
        const { withoutHash, hash } = splitUrlHash(url);
        const state = (options?.getStateFromPath ?? getStateFromPath)(withoutHash, options?.config as any);
        return hash ? injectLiteHash(state, hash) : state;
      },
      toPath: (state: any) => {
        const { cleanState, hash } = extractLiteHash(state);
        const path = (options?.getPathFromState ?? getPathFromState)(cleanState, options?.config as any);
        if (hash && typeof path === 'string' && !path.includes('#')) {
          return `${path}#${hash}`;
        }
        return path;
      },
      toAction: (state: any) => (options?.getActionFromState ?? getActionFromState)(state, options?.config as any),
    }),
    [options],
  );
}

function useContainer(): ContainerRef {
  const container = useContext(NavigationContainerRefContext) as ContainerRef | undefined;
  if (!container) {
    throw new Error('[react-router-navigation-adapter/lite] Use inside a React Navigation <NavigationContainer>.');
  }
  return container;
}

const noSubscription = () => () => {};

/** Current URL from the app's linking config: the screen's own inside a screen, else the focused one. */
export function useLocation(): LiteLocation {
  const container = useContainer();
  const { toPath } = useLinkingHelpers();
  const screenState = useStateForPath();
  const rootState = useSyncExternalStore(
    screenState ? noSubscription : (onChange) => container.addListener('state', onChange),
    () => (screenState ? undefined : container.isReady() ? container.getRootState() : undefined),
  );
  const state = screenState ?? rootState;
  return useMemo(() => toLiteLocation(state ? toPath(state) : '/'), [state, toPath]);
}

export const useQuery = () => useLocation().query;

/**
 * Route params that are not query params. Strings, unless the app's linking config `parse`s them.
 * Same signature on both platforms.
 */
export function useParams<T extends Record<string, unknown> = Record<string, string | undefined>>(): T {
  const route = useContext(NavigationRouteContext);
  const { query } = useLocation();
  return useMemo(() => {
    const params: Record<string, unknown> = {};
    for (const [key, value] of Object.entries((route?.params ?? {}) as Record<string, unknown>)) {
      if (key === LITE_HASH_KEY || key in query || value === undefined) continue;
      params[key] = typeof value === 'string' && value.includes('#') ? value.slice(0, value.indexOf('#')) : value;
    }
    return params as T;
  }, [route, query]);
}

export function useRouter(): LiteRouter {
  const container = useContainer();
  const navigation = useContext(NavigationContext);
  const route = useContext(NavigationRouteContext);
  const location = useLocation();
  const helpers = useLinkingHelpers();
  const config = useLiteConfig();

  return useMemo<LiteRouter>(() => {
    const confirmGuards = (action: NavigationGuardAction, nextPath: string | undefined, perform: () => void) => {
      if (runFocusedGuards(container, action, perform, nextPath)) perform();
    };

    const go = (to: Parameters<LiteRouter['navigate']>[0], mode: 'navigate' | 'push' | 'replace') => {
      const url = resolveTo(to, location);
      const state = helpers.toState(url);
      if (!state) {
        const open = config.openWeb ?? config.onExternal;
        if (!open) {
          throw new Error(`[react-router-navigation-adapter/lite] No screen in the linking config matches "${url}". Pass openWeb or onExternal to <LiteConfig>.`);
        }
        return confirmGuards('navigate', url, () => open(url));
      }
      const leaf = findFocusedRoute(state as any) as { name: string; params?: object };
      const own = navigation?.getState();
      const sameScreen = route != null && leaf.name === route.name;
      const leavesPathname = toLiteLocation(url).pathname !== location.pathname;

      // Same screen: update it in place (replace, or navigate to the current URL).
      if (sameScreen && (mode === 'replace' || (mode === 'navigate' && url === location.path))) {
        const perform = () => navigation!.dispatch(CommonActions.replaceParams(leaf.params ?? {}));
        return leavesPathname ? confirmGuards('replace', url, perform) : perform();
      }
      // A screen of this stack: push (like history.push) or replace the current screen.
      if (own?.type === 'stack' && own.routeNames.includes(leaf.name)) {
        if (mode === 'replace') return navigation!.dispatch(StackActions.replace(leaf.name, leaf.params)); // usePreventRemove guards it
        const perform = () => navigation!.dispatch(StackActions.push(leaf.name, leaf.params));
        return leavesPathname ? confirmGuards(mode, url, perform) : perform();
      }
      // Elsewhere (other navigator, outside screens): the app's linking decides, like useLinkTo.
      const action = (helpers.toAction(state) ?? CommonActions.reset(state as any)) as NavigationAction;
      const perform = () => container.dispatch({ target: container.getRootState()?.key, ...action } as NavigationAction);
      return leavesPathname ? confirmGuards(mode, url, perform) : perform();
    };

    const canGoBack = () => (navigation ? navigation.canGoBack() : container.isReady() && container.canGoBack());

    const router: LiteRouter = {
      platform: 'native',
      location,
      navigate: (to) => go(to, 'navigate'),
      push: (to) => go(to, 'push'),
      replace: (to) => go(to, 'replace'),
      canGoBack,
      goBack: (fallback) => {
        if (canGoBack()) (navigation ?? container).goBack();
        else if (fallback) router.replace(fallback);
        else if (config.onBackAtRoot) confirmGuards('goBack', undefined, config.onBackAtRoot);
      },
      setQuery: (query, options) => {
        const next = mergeQuery(location.query, query, options?.merge ?? true);
        const url = formatRelativeUrl(location.pathname, next, location.hash);
        go(url, options?.replace ?? true ? 'replace' : 'push');
      },
      openExternal: (url) => {
        const open = config.onExternal ?? config.openWeb;
        if (!open) {
          throw new Error(
            `[react-router-navigation-adapter/lite] openExternal("${url}") requires onExternal or openWeb on <LiteConfig>.`,
          );
        }
        confirmGuards('navigate', url, () => open(url));
      },
      reload: () => {
        const perform = () => {
          if (config.onReload) {
            config.onReload();
          } else {
            console.warn(
              '[react-router-navigation-adapter/lite] reload() has no default on React Native. Pass onReload to <LiteConfig>.',
            );
          }
        };
        confirmGuards('replace', location.path, perform);
      },
    };
    return router;
  }, [container, navigation, route, location, helpers, config]);
}

/**
 * Blocks leaving the screen while `when` is true and the screen is focused: back, swipe-back
 * (native-stack `preventNativeDismiss`), replace and reset through `usePreventRemove`; pushes,
 * `openWeb` and `goBack()` at the root through this layer. Must be used inside a screen.
 */
export function useNavigationGuard(when: boolean, messageOrHandler?: LiteGuard): void {
  const container = useContainer();
  const navigation = useContext(NavigationContext);
  const config = useLiteConfig();
  const handler = useRef(messageOrHandler);
  handler.current = messageOrHandler;
  const confirmRef = useRef(config.getUserConfirmation);
  confirmRef.current = config.getUserConfirmation;
  const confirm = () => confirmRef.current ?? defaultConfirm;

  useEffect(() => {
    if (!when || !navigation) return undefined;
    const entry: GuardEntry = { handler, isFocused: () => navigation.isFocused(), confirm };
    const guards = guardsOf(container);
    guards.add(entry);
    return () => {
      guards.delete(entry);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [when, navigation, container]);

  if (!navigation) {
    if (when) console.warn('[react-router-navigation-adapter/lite] useNavigationGuard must be used inside a screen on native.');
    return;
  }
  // Inside a screen for the lifetime of the component, so the hook calls below are stable.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const focused = useRNIsFocused();
  // eslint-disable-next-line react-hooks/rules-of-hooks
  usePreventRemove(when && focused, ({ data }) => {
    const proceed = () => navigation.dispatch(data.action);
    if (runGuard(handler.current, GUARD_ACTIONS[data.action.type] ?? 'unknown', proceed, confirm())) proceed();
  });
}

interface LiteLeafSnapshot {
  key: string;
  path: string;
  siblings: string[];
  ownerType?: string;
  historyLength?: number;
}

function getLiteFocusedLeaf(state: any, path: string): LiteLeafSnapshot | undefined {
  if (!state || !Array.isArray(state.routes)) return undefined;
  let current = state;
  while (current && Array.isArray(current.routes) && current.routes.length > 0) {
    const idx = typeof current.index === 'number' ? current.index : current.routes.length - 1;
    const route = current.routes[idx];
    if (!route) return undefined;
    if (route.state && Array.isArray(route.state.routes) && route.state.routes.length > 0) {
      current = route.state;
      continue;
    }
    return {
      key: route.key,
      path,
      siblings: current.routes.map((r: any) => r.key),
      ownerType: current.type,
      historyLength: Array.isArray(current.history) ? current.history.length : undefined,
    };
  }
  return undefined;
}

function inferLiteAction(prev: LiteLeafSnapshot, next: LiteLeafSnapshot): LiteNavigationAction {
  if (next.key === prev.key) return 'replace';
  if (next.ownerType === 'tab' && prev.ownerType === 'tab' && next.historyLength !== undefined && prev.historyLength !== undefined) {
    if (next.historyLength < prev.historyLength) return 'goBack';
    if (next.historyLength > prev.historyLength) return 'push';
    return 'replace';
  }
  if (prev.siblings.includes(next.key)) return 'goBack';
  if (next.siblings.includes(prev.key)) return 'push';
  return 'replace';
}

/** Calls `listener(location, action)` after every URL change (e.g. analytics, host stack mirroring). Works outside screens. */
export function useNavigationListener(listener: LiteNavigationListener): void {
  const container = useContainer();
  const { toPath } = useLinkingHelpers();
  const listenerRef = useRef(listener);
  listenerRef.current = listener;
  useEffect(() => {
    const capture = (): LiteLeafSnapshot | undefined => {
      if (!container.isReady()) return undefined;
      const rootState = container.getRootState();
      if (!rootState) return undefined;
      return getLiteFocusedLeaf(rootState, toPath(rootState));
    };
    // Like history.listen, the initial location is not reported: seed it once ready.
    let last = capture();
    const unsubscribeReady = container.addListener('ready', () => {
      last ??= capture();
    });
    const unsubscribeState = container.addListener('state', () => {
      const next = capture();
      if (!next) return;
      if (!last) {
        last = next;
        return;
      }
      if (next.path !== last.path || next.key !== last.key) {
        const action = inferLiteAction(last, next);
        last = next;
        listenerRef.current(toLiteLocation(next.path), action);
      }
    });
    return () => {
      unsubscribeReady();
      unsubscribeState();
    };
  }, [container, toPath]);
}

export function useIsFocused(): boolean {
  const navigation = useContext(NavigationContext);
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return navigation ? useRNIsFocused() : true;
}

export function useFocusEffect(effect: () => void | (() => void)): void {
  const navigation = useContext(NavigationContext);
  if (navigation) {
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
}

/** `<Pressable accessibilityRole="link">` navigating through the app's linking config. */
export function Link({
  to,
  replace,
  push,
  children,
  style,
  activeStyle,
  exact,
  strict,
  sensitive,
  isActive: isActiveProp,
  disabled,
  onPress,
  onClick,
  testID,
  accessibilityLabel,
  className: _className,
  activeClassName: _activeClassName,
  component: _component,
  target: _target,
  rel: _rel,
}: LiteLinkProps) {
  const router = useRouter();
  const location = useLocation();
  const targetLoc = toLiteLocation(resolveTo(to, location));
  const active = resolveLinkActive(
    targetLoc.pathname,
    { pathname: location.pathname, search: location.search, hash: location.hash },
    { exact, strict, sensitive, isActive: isActiveProp },
  );
  const resolvedStyle =
    active && activeStyle
      ? typeof style === 'function'
        ? (pressable: { pressed: boolean }) => [style(pressable), activeStyle]
        : [style, activeStyle]
      : style;
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={active ? { selected: true } : undefined}
      testID={testID}
      style={resolvedStyle}
      disabled={disabled}
      onPress={(event) => {
        if (disabled) return;
        onPress?.(event);
        onClick?.(event);
        if ((event as any)?.defaultPrevented) return;
        if (replace) router.replace(to);
        else if (push) router.push(to);
        else router.navigate(to);
      }}
    >
      {children}
    </Pressable>
  );
}
