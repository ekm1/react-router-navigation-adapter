import { normalizeHash, stringifyQueryParams } from './pathUtils';
import type { ImperativeLocation, ImperativeRouter, RouterHandle, UnifiedRoute } from './types';

const activeRouters: ImperativeRouter<any>[] = [];

/** Converts a `UnifiedRoute` into the imperative location snapshot returned by `getLocation()` / `subscribe()`. */
export function toImperativeLocation(route: UnifiedRoute<any>): ImperativeLocation {
  return {
    pathname: route.pathname,
    search: stringifyQueryParams(route.query),
    hash: route.hash ? `#${normalizeHash(route.hash)}` : '',
    query: route.query,
    path: route.path,
    state: route.state,
    key: route.key,
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
