import { useEffect, useRef } from 'react';
import { useUniversalRouterContext } from './context';
import { resolveLinkActive, resolveTargetFromRoute, toLinkLocation } from './shared';
import type {
  LinkIsActive,
  NavigationGuardCallback,
  NavigationListener,
  NavigationTarget,
  QueryParams,
  RouteParams,
  RouteRegistry,
  RouterController,
  UnifiedRoute,
} from './types';

/**
 * Access the shared RouteRegistry configured on <RouterProvider>.
 */
export function useRouteRegistry<TName extends string = string>(): RouteRegistry<TName> {
  return useUniversalRouterContext().registry as RouteRegistry<TName>;
}

/**
 * Primary navigation controller hook. Works identically on Web (React Router v5)
 * and Native (React Navigation).
 */
export function useRouter<TName extends string = string>(): RouterController<TName> {
  const { adapter } = useUniversalRouterContext();
  return adapter.useController() as RouterController<TName>;
}

/**
 * Returns the unified current route snapshot:
 * `{ name, path, pathname, params, query, hash, state, key, matchedPattern }`.
 */
export function useRoute<
  TName extends string = string,
  TParams extends RouteParams = RouteParams,
>(): UnifiedRoute<TName, TParams> {
  const { adapter } = useUniversalRouterContext();
  return adapter.useRoute() as UnifiedRoute<TName, TParams>;
}

/**
 * Returns the parsed path parameters of the current route.
 */
export function useParams<TParams extends RouteParams = RouteParams>(): TParams {
  return useRoute<string, TParams>().params;
}

/**
 * Returns the parsed query string parameters of the current route.
 */
export function useQuery<TQuery extends QueryParams = QueryParams>(): TQuery {
  return useRoute().query as TQuery;
}

/**
 * Returns whether the current screen is focused.
 * - Native: delegates to React Navigation's `useIsFocused()`.
 * - Web: returns true while the screen is mounted and active.
 */
export function useIsFocused(): boolean {
  const { adapter } = useUniversalRouterContext();
  return adapter.useIsFocused();
}

/**
 * Runs an effect whenever the screen becomes focused and cleans up on blur/unmount.
 * Wrap `effect` in `React.useCallback` just like React Navigation's `useFocusEffect`.
 */
export function useFocusEffect(effect: () => void | (() => void)): void {
  const { adapter } = useUniversalRouterContext();
  adapter.useFocusEffect(effect);
}

/**
 * Prevents leaving the current route when `when` is true.
 * - Web: integrates with React Router v5 `history.block(...)`.
 * - Native: integrates with React Navigation `beforeRemove` listener.
 */
export function useNavigationGuard(
  when: boolean,
  messageOrHandler?: string | NavigationGuardCallback,
): void {
  const { adapter } = useUniversalRouterContext();
  adapter.useNavigationGuard(when, messageOrHandler);
}

/**
 * Calls `listener(route, action)` after every location change, like `history.listen`
 * (e.g. for analytics). Works outside screens.
 */
export function useNavigationListener(listener: NavigationListener): void {
  const { adapter } = useUniversalRouterContext();
  const listen = adapter.useListen();
  const listenerRef = useRef(listener);
  listenerRef.current = listener;
  useEffect(() => listen((route, action) => listenerRef.current(route, action)), [listen]);
}

/**
 * Whether `to` is the current location, like React Router's `NavLink`: a pathname prefix
 * match by default, or an exact one with `{ exact: true }`, with optional `strict`,
 * `sensitive`, and custom `isActive(match, location)`.
 */
export function useIsActive(
  to: NavigationTarget,
  params?: RouteParams,
  options: { exact?: boolean; strict?: boolean; sensitive?: boolean; isActive?: LinkIsActive } = {},
): boolean {
  const { registry, routeContext } = useUniversalRouterContext();
  const currentRoute = useRoute();
  const resolved = resolveTargetFromRoute(registry, currentRoute, to, params, undefined, routeContext);
  return resolveLinkActive(resolved.pathname, toLinkLocation(currentRoute), options);
}

/**
 * Route-name-typed hooks. Pass the registry, or only its type to avoid an import cycle
 * between the routes file and the screens: `createTypedRouterHooks<RouteName>()`.
 */
export function createTypedRouterHooks<TName extends string>(
  _registry?: RouteRegistry<TName>,
) {
  return {
    useRouter: () => useRouter<TName>(),
    useRoute: <TParams extends RouteParams = RouteParams>() =>
      useRoute<TName, TParams>(),
    useParams,
    useQuery,
    useIsFocused,
    useFocusEffect,
    useNavigationGuard,
    useNavigationListener,
    useIsActive,
    useRouteRegistry: () => useRouteRegistry<TName>(),
  };
}
