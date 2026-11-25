import React, { useMemo } from 'react';
import { useUniversalRouterContext } from './context';
import { useRoute, useRouter } from './hooks';
import { normalizeHash, stringifyQueryParams } from './pathUtils';
import type { HistoryAction, UnifiedRoute } from './types';

/**
 * React Router v5 compatibility for native: `useHistory`, `useLocation` and `withRouter`
 * implemented on the common interface. On web the same names are React Router's own.
 * Lets existing call sites such as `props.history.replace({ search })` run unchanged.
 */

export interface CompatLocation {
  pathname: string;
  search: string;
  hash: string;
  state: unknown;
  key?: string;
}

export type CompatLocationDescriptor =
  | string
  | { pathname?: string; search?: string; hash?: string; state?: unknown };

export interface CompatHistory {
  readonly action: HistoryAction;
  readonly location: CompatLocation;
  push: (to: CompatLocationDescriptor, state?: unknown) => void;
  replace: (to: CompatLocationDescriptor, state?: unknown) => void;
  go: (delta: number) => void;
  goBack: () => void;
  /** No forward history on native; does nothing. */
  goForward: () => void;
  listen: (listener: (location: CompatLocation, action: HistoryAction) => void) => () => void;
  createHref: (to: CompatLocationDescriptor) => string;
}

export interface CompatMatch {
  params: Record<string, string | undefined>;
  path: string;
  url: string;
  isExact: boolean;
}

export interface RouteComponentProps {
  history: CompatHistory;
  location: CompatLocation;
  match: CompatMatch;
}

function toLocation(route: UnifiedRoute): CompatLocation {
  return {
    pathname: route.pathname,
    search: stringifyQueryParams(route.query),
    hash: route.hash ? `#${route.hash}` : '',
    state: route.state,
    key: route.key,
  };
}

/** Same rules as history v4: a missing pathname means the current one; search/hash are not inherited. */
function toUrl(to: CompatLocationDescriptor, current: CompatLocation): string {
  if (typeof to === 'string') {
    if (to.startsWith('?')) return `${current.pathname}${to}`;
    if (to.startsWith('#')) return `${current.pathname}${current.search}${to}`;
    return to;
  }
  const search = to.search ? (to.search.startsWith('?') ? to.search : `?${to.search}`) : '';
  const hash = to.hash ? `#${normalizeHash(to.hash)}` : '';
  return `${to.pathname ?? current.pathname}${search}${hash}`;
}

export function useLocation(): CompatLocation {
  const route = useRoute();
  return useMemo(() => toLocation(route), [route]);
}

export function useHistory(): CompatHistory {
  const { adapter } = useUniversalRouterContext();
  const router = useRouter();
  const action = adapter.useLastAction();
  const listen = adapter.useListen();
  const location = useLocation();

  return useMemo<CompatHistory>(() => {
    const go = (method: 'push' | 'replace') => (to: CompatLocationDescriptor, state?: unknown) => {
      const resolvedState = state ?? (typeof to === 'object' ? to.state : undefined);
      router[method](toUrl(to, location), undefined, { state: resolvedState });
    };
    return {
      action,
      location,
      push: go('push'),
      replace: go('replace'),
      go: (delta) => {
        for (let i = 0; i < -delta; i += 1) router.goBack();
      },
      goBack: () => router.goBack(),
      goForward: () => {},
      listen: (listener) => listen((route, nextAction) => listener(toLocation(route), nextAction)),
      createHref: (to) => toUrl(to, location),
    };
  }, [router, action, listen, location]);
}

/** `match.params` holds the raw URL strings, as in React Router. */
function useMatch(): CompatMatch {
  const { registry } = useUniversalRouterContext();
  const route = useRoute();
  return useMemo(() => {
    const stringify = route.name ? registry.getRoute(route.name)?.stringify : undefined;
    const params: Record<string, string | undefined> = {};
    for (const [key, value] of Object.entries(route.params)) {
      params[key] = value == null ? undefined : stringify?.[key] ? stringify[key](value) : String(value);
    }
    return { params, path: route.matchedPattern ?? route.pathname, url: route.pathname, isExact: true };
  }, [registry, route]);
}

export function withRouter<P extends RouteComponentProps>(
  Component: React.ComponentType<P>,
): React.ComponentType<Omit<P, keyof RouteComponentProps>> {
  function WithRouter(props: Omit<P, keyof RouteComponentProps>) {
    const history = useHistory();
    const location = useLocation();
    const match = useMatch();
    return <Component {...(props as P)} history={history} location={location} match={match} />;
  }
  WithRouter.displayName = `withRouter(${Component.displayName || Component.name || 'Component'})`;
  return WithRouter;
}
