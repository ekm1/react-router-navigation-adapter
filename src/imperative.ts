import { toLinkLocation } from './shared';
import type {
  HistoryAction,
  ImperativeLocation,
  ImperativeRouter,
  PlatformKind,
  RouterController,
  RouterHandle,
  UnifiedRoute,
} from './types';

const activeRouters: ImperativeRouter<any>[] = [];

/** Converts a `UnifiedRoute` into the imperative location snapshot returned by `getLocation()` / `subscribe()`. */
export function toImperativeLocation(route: UnifiedRoute<any>): ImperativeLocation {
  return { ...toLinkLocation(route), query: route.query, path: route.path };
}

/**
 * Builds the imperative router for a provider: every call reads the provider's current route
 * and forwards to a controller created for it, so the handle never goes stale.
 */
export function createImperativeRouter<TName extends string>(
  platform: PlatformKind,
  getRoute: () => UnifiedRoute<TName>,
  getController: () => RouterController<TName>,
  subscribe: (listener: (route: UnifiedRoute<any>, action: HistoryAction) => void) => () => void,
): ImperativeRouter<TName> {
  const c = getController;
  return {
    platform,
    getLocation: () => toImperativeLocation(getRoute()),
    getRoute,
    subscribe: (listener) => subscribe((route, action) => listener(toImperativeLocation(route), action)),
    navigate: (...args) => c().navigate(...args),
    push: (...args) => c().push(...args),
    replace: (...args) => c().replace(...args),
    goBack: () => c().goBack(),
    go: (delta) => c().go(delta),
    canGoBack: () => c().canGoBack(),
    getLength: () => c().getLength(),
    reset: (...args) => c().reset(...args),
    setParams: (partial) => c().setParams(partial),
    setQuery: (...args) => c().setQuery(...args),
    buildUrl: (...args) => c().buildUrl(...args),
    openExternal: (...args) => c().openExternal(...args),
    reload: () => c().reload(),
  };
}

/**
 * Creates an explicit ref handle to pass as `<RouterProvider routerRef={ref}>`.
 * Prefer `createRouterRef()` over `getRouter()` when multiple providers may be mounted
 * concurrently (e.g. multiple micro-frontends or React Native islands).
 */
export function createRouterRef<TName extends string = string>(): RouterHandle<TName> {
  return { current: null };
}

/** Internal: registers a mounted provider's imperative router handle and returns a cleanup callback. */
export function registerImperativeRouter<TName extends string>(
  router: ImperativeRouter<TName>,
  routerRef?: RouterHandle<TName>,
): () => void {
  if (routerRef) {
    routerRef.current = router;
  }
  activeRouters.push(router);
  return () => {
    const idx = activeRouters.lastIndexOf(router);
    if (idx !== -1) activeRouters.splice(idx, 1);
    if (routerRef && routerRef.current === router) {
      routerRef.current = null;
    }
  };
}

/**
 * Returns the active imperative router handle for non-React code (middleware, URL utilities,
 * store effects). Throws if no `<RouterProvider>` is currently mounted.
 */
export function getRouter<TName extends string = string>(): ImperativeRouter<TName> {
  const active = activeRouters[activeRouters.length - 1];
  if (!active) {
    throw new Error(
      '[react-router-navigation-adapter] No active RouterProvider is mounted. Mount <RouterProvider> before calling getRouter(), or use createRouterRef().',
    );
  }
  return active as ImperativeRouter<TName>;
}
