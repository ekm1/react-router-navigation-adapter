import React, { useMemo } from 'react';
import { useUniversalRouterContext } from './context';
import { useRoute, useRouter } from './hooks';
import { useGuardRegistration } from './adapters/native';
import { compilePathPattern, generatePathFromPattern, normalizeHash, safeDecode, stringifyQueryParams } from './pathUtils';
import { promptToGuard, type PromptMessage } from './shared';
import type { HistoryAction, RouteParams, UnifiedRoute } from './types';

/**
 * React Router v5 compatibility for native, implemented on the common interface:
 * `useHistory`, `useLocation`, `useRouteMatch`, `withRouter`, `matchPath`, `generatePath`.
 * On web the same names are React Router's own. Lets existing call sites such as
 * `props.history.replace({ search })` run unchanged.
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
  /** Entries in the current screen's stack. */
  readonly length: number;
  push: (to: CompatLocationDescriptor, state?: unknown) => void;
  replace: (to: CompatLocationDescriptor, state?: unknown) => void;
  /** `go(-n)` pops n screens in one action; positive deltas do nothing (no forward history). */
  go: (delta: number) => void;
  goBack: () => void;
  /** No forward history on native; does nothing. */
  goForward: () => void;
  /** Like React Router: applies globally until unblocked. Prefer `<Prompt>` in screens (also blocks iOS swipe-back). */
  block: (prompt?: PromptMessage | boolean) => () => void;
  listen: (listener: (location: CompatLocation, action: HistoryAction) => void) => () => void;
  createHref: (to: CompatLocationDescriptor) => string;
}

export interface CompatMatch<Params extends Record<string, string | undefined> = Record<string, string | undefined>> {
  params: Params;
  path: string;
  url: string;
  isExact: boolean;
}

export interface RouteComponentProps {
  history: CompatHistory;
  location: CompatLocation;
  match: CompatMatch;
}

export interface MatchPathOptions {
  path?: string | string[];
  exact?: boolean;
  strict?: boolean;
  sensitive?: boolean;
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

/** `resolve-pathname` semantics used by history v4: relative to the current directory. */
function resolvePathname(to: string, from: string): string {
  if (to.startsWith('/')) return to;
  const base = from.split('/');
  base.pop(); // drop the last segment ("file"), keep the directory
  for (const part of to.split('/')) {
    if (part === '..') {
      if (base.length > 1) base.pop();
    } else if (part !== '.') {
      base.push(part);
    }
  }
  if (to.endsWith('/.') || to.endsWith('/..') || to === '.' || to === '..') base.push('');
  const joined = base.join('/');
  return joined.startsWith('/') ? joined : `/${joined}`;
}

/** Same rules as history v4: a missing pathname means the current one; search/hash are not inherited. */
function toUrl(to: CompatLocationDescriptor, current: CompatLocation): string {
  if (typeof to === 'string') {
    if (to.startsWith('?')) return `${current.pathname}${to}`;
    if (to.startsWith('#')) return `${current.pathname}${current.search}${to}`;
    if (/^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(to)) return to;
    const idx = to.search(/[?#]/);
    const path = idx === -1 ? to : to.slice(0, idx);
    return `${resolvePathname(path, current.pathname)}${idx === -1 ? '' : to.slice(idx)}`;
  }
  const search = to.search ? (to.search.startsWith('?') ? to.search : `?${to.search}`) : '';
  const hash = to.hash ? `#${normalizeHash(to.hash)}` : '';
  const pathname = to.pathname ? resolvePathname(to.pathname, current.pathname) : current.pathname;
  return `${pathname}${search}${hash}`;
}

/** React Router v5 `matchPath` (defaults to `exact: false`) for the adapter's path syntax. */
export function matchPath<Params extends Record<string, string | undefined> = Record<string, string | undefined>>(
  pathname: string,
  options: string | string[] | MatchPathOptions = {},
): CompatMatch<Params> | null {
  const opts = typeof options === 'string' || Array.isArray(options) ? { path: options } : options;
  const { exact = false, strict = false, sensitive = false } = opts;
  const paths = opts.path === undefined ? [] : ([] as string[]).concat(opts.path);
  for (const path of paths) {
    if (!path && path !== '') continue;
    const compiled = compilePathPattern(path, { exact, strict, sensitive });
    const match = compiled.regex.exec(pathname);
    if (!match) continue;
    const url = path === '/' && match[0] === '' ? '/' : match[0];
    const params: Record<string, string | undefined> = {};
    compiled.paramNames.forEach((name, idx) => {
      const raw = match[idx + 1];
      params[name] = raw === undefined ? undefined : safeDecode(raw);
    });
    return { path, url, isExact: pathname === url, params: params as Params };
  }
  return null;
}

/** React Router v5 `generatePath` for the adapter's path syntax. */
export function generatePath(pattern: string = '/', params: RouteParams = {}): string {
  return generatePathFromPattern(pattern, params);
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
  const register = useGuardRegistration();
  const location = useLocation();

  return useMemo<CompatHistory>(() => {
    const go = (method: 'push' | 'replace') => (to: CompatLocationDescriptor, state?: unknown) => {
      const resolvedState = state ?? (typeof to === 'object' ? to.state : undefined);
      router[method](toUrl(to, location), undefined, { state: resolvedState });
    };
    return {
      action,
      location,
      get length() {
        return router.getLength();
      },
      push: go('push'),
      replace: go('replace'),
      go: (delta) => router.go(delta),
      goBack: () => router.goBack(),
      goForward: () => {},
      block: (prompt = false) =>
        register(promptToGuard(typeof prompt === 'boolean' ? (() => prompt) : prompt)),
      listen: (listener) => listen((route, nextAction) => listener(toLocation(route), nextAction)),
      createHref: (to) => toUrl(to, location),
    };
  }, [router, action, listen, register, location]);
}

/** Current match (`match.params` holds the raw URL strings, as in React Router). */
function useCurrentMatch(): CompatMatch {
  const { registry } = useUniversalRouterContext();
  const route = useRoute();
  return useMemo(() => {
    const def = route.name ? registry.getRoute(route.name) : undefined;
    const stringify = def?.stringify;
    const params: Record<string, string | undefined> = {};
    for (const [key, value] of Object.entries(route.params)) {
      params[key] = value == null ? undefined : stringify?.[key] ? stringify[key](value) : String(value);
    }
    const matched = route.matchedPattern
      ? matchPath(route.pathname, {
          path: route.matchedPattern,
          exact: def?.exact,
          strict: def?.strict,
          sensitive: def?.sensitive,
        })
      : null;
    return {
      params,
      path: route.matchedPattern ?? route.pathname,
      url: matched ? matched.url : route.pathname,
      isExact: matched ? matched.isExact : true,
    };
  }, [registry, route]);
}

/** React Router v5 `useRouteMatch()`: the current match, or `matchPath(location.pathname, arg)`. */
export function useRouteMatch<Params extends Record<string, string | undefined> = Record<string, string | undefined>>(
  path?: string | string[] | MatchPathOptions,
): CompatMatch<Params> | null {
  const current = useCurrentMatch();
  const { pathname } = useRoute();
  return useMemo(
    () => (path === undefined ? (current as CompatMatch<Params>) : matchPath<Params>(pathname, path)),
    [current, pathname, path],
  );
}

// Static members React manages itself; everything else is hoisted (like hoist-non-react-statics).
const REACT_STATICS = new Set([
  'childContextTypes', 'contextType', 'contextTypes', 'defaultProps', 'displayName',
  'getDefaultProps', 'getDerivedStateFromError', 'getDerivedStateFromProps', 'mixins',
  'propTypes', 'type', '$$typeof', 'render', 'compare',
  'name', 'length', 'prototype', 'caller', 'callee', 'arguments', 'arity',
]);

export type WithRouterProps<P> = Omit<P, keyof RouteComponentProps> & {
  /** Ref to the wrapped component (React Router v5 API). */
  wrappedComponentRef?: React.Ref<any>;
};

export function withRouter<P extends RouteComponentProps, C extends React.ComponentType<P>>(
  Component: C & React.ComponentType<P>,
): React.ComponentType<WithRouterProps<P>> & { WrappedComponent: C } {
  function WithRouter({ wrappedComponentRef, ...props }: WithRouterProps<P>) {
    const history = useHistory();
    const location = useLocation();
    const match = useCurrentMatch();
    const Wrapped = Component as React.ComponentType<any>;
    return <Wrapped {...props} history={history} location={location} match={match} ref={wrappedComponentRef} />;
  }
  WithRouter.displayName = `withRouter(${Component.displayName || Component.name || 'Component'})`;
  for (const key of Object.getOwnPropertyNames(Component)) {
    if (!REACT_STATICS.has(key) && !(key in WithRouter)) {
      Object.defineProperty(WithRouter, key, Object.getOwnPropertyDescriptor(Component, key)!);
    }
  }
  return Object.assign(WithRouter, { WrappedComponent: Component });
}
