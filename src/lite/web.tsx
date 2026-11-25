import React, { useEffect, useMemo, useRef } from 'react';
import {
  Link as RRLink,
  useHistory,
  useLocation as useRRLocation,
  useParams as useRRParams,
} from 'react-router-dom';
import type { Action, History, Location } from 'history';
import { formatRelativeUrl } from '../pathUtils';
import { mergeQuery, runGuard } from '../shared';
import type { GetUserConfirmation, NavigationGuardAction } from '../types';
import {
  resolveTo,
  toLiteLocation,
  useLiteConfig,
  type LiteGuard,
  type LiteLinkProps,
  type LiteLocation,
  type LiteRouter,
} from './shared';

const GUARD_ACTIONS: Record<Action, NavigationGuardAction> = { PUSH: 'push', REPLACE: 'replace', POP: 'goBack' };

const defaultConfirm: GetUserConfirmation = (message, callback) =>
  callback(typeof window !== 'undefined' && typeof window.confirm === 'function' ? window.confirm(message) : false);

/**
 * history v4 allows one prompt at a time, so all guards on a history share one `block`.
 * Replays after an async confirmation bypass it.
 */
interface GuardRegistry {
  guards: Set<{ handler: React.MutableRefObject<LiteGuard | undefined>; confirm: () => GetUserConfirmation }>;
  unblock?: () => void;
  bypass: boolean;
  bypassPop: boolean;
}
const registries = new WeakMap<History, GuardRegistry>();

function registryFor(history: History): GuardRegistry {
  let registry = registries.get(history);
  if (!registry) {
    registry = { guards: new Set(), bypass: false, bypassPop: false };
    registries.set(history, registry);
  }
  return registry;
}

/** Runs every guard on `history`; true when navigation may continue now. */
function runGuards(history: History, action: NavigationGuardAction, proceed: () => void, nextPath?: string) {
  const registry = registryFor(history);
  for (const { handler, confirm } of Array.from(registry.guards).reverse()) {
    if (!runGuard(handler.current, action, proceed, confirm(), nextPath)) return false;
  }
  return true;
}

function syncBlock(history: History) {
  const registry = registryFor(history);
  if (registry.guards.size > 0 && !registry.unblock) {
    registry.unblock = history.block(((location: Location, action: Action) => {
      if (registry.bypass) return undefined;
      if (action === 'POP' && registry.bypassPop) {
        registry.bypassPop = false;
        return undefined;
      }
      // Query/hash-only changes do not leave the screen.
      if (location.pathname === history.location.pathname) return undefined;
      const replay = () => {
        if (action === 'POP') {
          // The direction of a blocked POP is unknown here; it is replayed as "back".
          registry.bypassPop = true;
          history.goBack();
          return;
        }
        registry.bypass = true;
        try {
          if (action === 'PUSH') history.push(location);
          else history.replace(location);
        } finally {
          registry.bypass = false;
        }
      };
      const nextPath = `${location.pathname}${location.search}${location.hash}`;
      return runGuards(history, GUARD_ACTIONS[action], replay, nextPath) ? undefined : false;
    }) as any);
  } else if (registry.guards.size === 0 && registry.unblock) {
    registry.unblock();
    registry.unblock = undefined;
  }
}

export function useLocation(): LiteLocation {
  const location = useRRLocation();
  return useMemo(() => toLiteLocation(`${location.pathname}${location.search}${location.hash}`), [location]);
}

export const useQuery = () => useLocation().query;

/** Path params of the closest React Router `<Route>` (strings). Same signature on both platforms. */
export const useParams = <T extends Record<string, unknown> = Record<string, string | undefined>>(): T =>
  useRRParams() as T;

function canGoBackIn(history: History): boolean {
  const index = (history as History & { index?: number }).index;
  if (typeof index === 'number') return index > 0; // memory history
  // Browser history exposes no index: any earlier entry counts (it may belong to another site).
  return typeof window !== 'undefined' && window.history.length > 1;
}

export function useRouter(): LiteRouter {
  const history = useHistory();
  const location = useLocation();
  const config = useLiteConfig();

  return useMemo<LiteRouter>(() => {
    const router: LiteRouter = {
      platform: 'web',
      location,
      navigate: (to) => {
        const url = resolveTo(to, location);
        if (url === location.path) history.replace(url);
        else history.push(url);
      },
      push: (to) => history.push(resolveTo(to, location)),
      replace: (to) => history.replace(resolveTo(to, location)),
      canGoBack: () => canGoBackIn(history),
      goBack: (fallback) => {
        if (canGoBackIn(history)) history.goBack();
        else if (config.onBackAtRoot) {
          const leave = config.onBackAtRoot;
          if (runGuards(history, 'goBack', leave)) leave();
        } else if (fallback) router.replace(fallback);
      },
      setQuery: (query, options) => {
        const next = mergeQuery(location.query, query, options?.merge ?? true);
        const url = formatRelativeUrl(location.pathname, next, location.hash);
        if (options?.replace ?? true) history.replace(url);
        else history.push(url);
      },
    };
    return router;
  }, [history, location, config]);
}

/** Blocks leaving the current pathname while `when` is true (query-only changes pass). */
export function useNavigationGuard(when: boolean, messageOrHandler?: LiteGuard): void {
  const history = useHistory();
  const config = useLiteConfig();
  const handler = useRef(messageOrHandler);
  handler.current = messageOrHandler;
  const confirmRef = useRef(config.getUserConfirmation);
  confirmRef.current = config.getUserConfirmation;

  useEffect(() => {
    if (!when) return undefined;
    const registry = registryFor(history);
    const entry = { handler, confirm: () => confirmRef.current ?? defaultConfirm };
    registry.guards.add(entry);
    syncBlock(history);
    return () => {
      registry.guards.delete(entry);
      syncBlock(history);
    };
  }, [when, history]);
}

/** Calls `listener(location)` after every location change (e.g. analytics). */
export function useNavigationListener(listener: (location: LiteLocation) => void): void {
  const history = useHistory();
  const listenerRef = useRef(listener);
  listenerRef.current = listener;
  useEffect(
    () => history.listen((location) => listenerRef.current(toLiteLocation(`${location.pathname}${location.search}${location.hash}`))),
    [history],
  );
}

export const useIsFocused = () => true;

export function useFocusEffect(effect: () => void | (() => void)): void {
  useEffect(() => {
    const cleanup = effect();
    return () => {
      if (typeof cleanup === 'function') cleanup();
    };
  }, [effect]);
}

/** React Router `<Link>` (real `<a href>`, basename and modifier clicks handled by React Router). */
export function Link({ to, replace, push: _push, children, style, className, testID, accessibilityLabel }: LiteLinkProps) {
  const location = useLocation();
  return (
    <RRLink
      to={resolveTo(to, location)}
      replace={replace}
      style={style}
      className={className}
      data-testid={testID}
      aria-label={accessibilityLabel}
    >
      {children}
    </RRLink>
  );
}
