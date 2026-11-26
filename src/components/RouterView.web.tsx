import React, { useEffect, useMemo } from 'react';
import { Redirect as RRRedirect, Route, Switch, useLocation } from 'react-router-dom';
import { WebRouteOverrideContext, useWebBypassNextPath } from '../adapters/web';
import { useUniversalRouterContext } from '../context';
import {
  formatRelativeUrl,
  normalizeHash,
  parseQueryString,
  toLocationDescriptor,
} from '../pathUtils';
import { evaluateEntryGuard } from '../shared';
import type { ResolvedNavigationIntent, RouteRegistry, UnifiedRoute } from '../types';

export interface WebRouterViewProps<TName extends string = string> {
  /** Optional explicit route registry (defaults to the registry from `<RouterProvider>`). */
  routes?: RouteRegistry<TName>;
  /** Optional fallback / 404 component rendered when no route matches on web. */
  fallback?: React.ComponentType<any>;
  /** Accepted for API symmetry with native `<RouterView>`; ignored on web. */
  navigator?: {
    Navigator: React.ComponentType<any>;
    Screen: React.ComponentType<any>;
  };
  /** Accepted for API symmetry with native `<RouterView>`; ignored on web. */
  initialRouteName?: TName | (string & {});
  /** Accepted for API symmetry with native `<RouterView>`; ignored on web. */
  scope?: string[];
  /** Accepted for API symmetry with native `<RouterView>`; ignored on web. */
  children?: React.ReactNode;
  /** Accepted for API symmetry with native `<RouterView>`; ignored on web. */
  screenOptions?: Record<string, unknown> | ((props: any) => Record<string, unknown>);
  /** Accepted for API symmetry with native `<RouterView>`; ignored on web. */
  navigatorProps?: Record<string, unknown>;
}

function EntryGuardRedirect({ intent }: { intent: ResolvedNavigationIntent<any> }) {
  const [bypassNextPath, clearBypassNextPath] = useWebBypassNextPath();
  bypassNextPath(intent.path);
  // <Redirect> navigates in its mount (layout) phase, before this passive effect: if no leave
  // guard consumed the bypass by then, drop it so it cannot skip a later navigation's guards.
  useEffect(() => clearBypassNextPath(intent.path));
  return (
    <RRRedirect
      to={toLocationDescriptor(intent)}
    />
  );
}

/**
 * Declarative `<RouterView>` for Web — renders a React Router v5 `<Switch>` + `<Route>` tree
 * from the shared route definitions. Supports overlay routes, runtime `enabled` predicates,
 * and route-level entry `guard` hooks.
 */
export function RouterView<TName extends string = string>({
  routes: explicitRoutes,
  fallback: Fallback,
}: WebRouterViewProps<TName>) {
  const { registry: contextRoutes, routeContext } = useUniversalRouterContext();
  const registry = (explicitRoutes ?? contextRoutes) as RouteRegistry<TName>;
  const location = useLocation();

  const query = useMemo(() => parseQueryString(location.search), [location.search]);
  const hash = normalizeHash(location.hash);
  const fullPath = formatRelativeUrl(location.pathname, query, hash);
  const overlayMatch = useMemo(
    () => registry.matchOverlayUrl(fullPath, routeContext),
    [registry, fullPath, routeContext],
  );

  const baseLocation = useMemo(
    () => (overlayMatch ? { ...location, pathname: overlayMatch.basePathname } : location),
    [location, overlayMatch],
  );

  const baseOverride = useMemo(() => {
    const basePathname = overlayMatch ? overlayMatch.basePathname : location.pathname || '/';
    const baseMatch = overlayMatch ? overlayMatch.base : registry.matchUrl(fullPath, routeContext);
    const route: UnifiedRoute<TName> = {
      name: baseMatch ? baseMatch.name : null,
      path: formatRelativeUrl(basePathname, query, hash),
      pathname: basePathname,
      params: baseMatch ? baseMatch.params : {},
      query,
      hash,
      state: location.state,
      key: location.key,
      matchedPattern: baseMatch ? baseMatch.pattern : null,
    };
    return { route, isFocused: !overlayMatch, scope: 'base' as const };
  }, [overlayMatch, location, registry, fullPath, query, hash, routeContext]);

  const overlayOverride = useMemo(() => {
    if (!overlayMatch) return null;
    const { overlay } = overlayMatch;
    const route: UnifiedRoute<TName> = {
      name: overlay.name,
      path: overlay.path,
      pathname: overlay.pathname,
      params: overlay.params,
      query: overlay.query,
      hash: overlay.hash,
      state: location.state,
      key: location.key,
      matchedPattern: overlay.pattern,
      isOverlay: true,
      basePathname: overlay.basePathname,
    };
    return { route, isFocused: true, scope: 'overlay' as const };
  }, [overlayMatch, location.state, location.key]);

  const baseGuard = evaluateEntryGuard(registry, baseOverride.route, routeContext);
  const overlayGuard = overlayOverride
    ? evaluateEntryGuard(registry, overlayOverride.route, routeContext)
    : null;

  // If the active overlay guard redirects, perform the redirect immediately.
  if (overlayGuard?.kind === 'redirect') {
    return <EntryGuardRedirect intent={overlayGuard.intent} />;
  }
  // If the base route guard redirects, redirect, also under an overlay: otherwise a URL such as
  // `/admin/preview/1` would render the guarded base screen beneath the overlay.
  if (baseGuard.kind === 'redirect') {
    return <EntryGuardRedirect intent={baseGuard.intent} />;
  }

  const OverlayComponent = overlayMatch
    ? registry.getRoute(overlayMatch.overlay.name)?.component
    : undefined;

  let baseContent: React.ReactNode;
  if (baseGuard.kind === 'element') {
    baseContent = baseGuard.element;
  } else {
    baseContent = (
      <Switch location={baseLocation}>
        {registry.routes.map((route) => {
          if (route.overlay || !route.component || !registry.isRouteEnabled(route.name, routeContext)) {
            return null;
          }
          return (
            <Route
              key={route.name}
              path={route.paths.length === 1 ? route.paths[0] : [...route.paths]}
              exact={route.exact}
              strict={route.strict}
              sensitive={route.sensitive}
              component={route.component}
            />
          );
        })}
        {Fallback ? <Route component={Fallback} /> : null}
      </Switch>
    );
  }

  let overlayContent: React.ReactNode = null;
  if (overlayOverride) {
    if (overlayGuard?.kind === 'element') {
      overlayContent = (
        <WebRouteOverrideContext.Provider value={overlayOverride}>
          {overlayGuard.element}
        </WebRouteOverrideContext.Provider>
      );
    } else if (OverlayComponent) {
      overlayContent = (
        <WebRouteOverrideContext.Provider value={overlayOverride}>
          <OverlayComponent key={overlayOverride.route.name} />
        </WebRouteOverrideContext.Provider>
      );
    }
  }

  return (
    <>
      <WebRouteOverrideContext.Provider value={baseOverride}>
        {baseContent}
      </WebRouteOverrideContext.Provider>
      {overlayContent}
    </>
  );
}
