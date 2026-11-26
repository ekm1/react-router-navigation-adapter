import React, { useEffect, useMemo, useRef } from 'react';
import {
  Link as RRLink,
  useHistory,
  useLocation as useRRLocation,
  useParams as useRRParams,
} from 'react-router-dom';
import type { Action, History, Location } from 'history';
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

const LISTENER_ACTIONS: Record<Action, LiteNavigationAction> = { PUSH: 'push', REPLACE: 'replace', POP: 'goBack' };
const GUARD_ACTIONS: Record<Action, NavigationGuardAction> = LISTENER_ACTIONS;

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
        else if (fallback) router.replace(fallback);
        else if (config.onBackAtRoot) {
          const leave = config.onBackAtRoot;
          if (runGuards(history, 'goBack', leave)) leave();
        }
      },
      setQuery: (query, options) => {
        const next = mergeQuery(location.query, query, options?.merge ?? true);
        const url = formatRelativeUrl(location.pathname, next, location.hash);
        if (options?.replace ?? true) history.replace(url);
        else history.push(url);
      },
      openExternal: (url, options) => {
        const perform = () => {
          if (config.onExternal) {
            config.onExternal(url);
          } else if (typeof window !== 'undefined' && window.location) {
            if (options?.replace) window.location.replace(url);
            else window.location.assign(url);
          }
        };
        if (runGuards(history, 'navigate', perform, url)) perform();
      },
      reload: () => {
        const perform = () => {
          if (config.onReload) {
            config.onReload();
          } else if (typeof window !== 'undefined' && window.location) {
            window.location.reload();
          }
        };
        if (runGuards(history, 'replace', perform, location.path)) perform();
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

/** Calls `listener(location, action)` after every location change (e.g. analytics, host stack mirroring). */
export function useNavigationListener(listener: LiteNavigationListener): void {
  const history = useHistory();
  const listenerRef = useRef(listener);
  listenerRef.current = listener;
  useEffect(
    () =>
      history.listen((location, action) =>
        listenerRef.current(
          toLiteLocation(`${location.pathname}${location.search}${location.hash}`),
          LISTENER_ACTIONS[action] ?? 'replace',
        ),
      ),
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

/** React Router `<Link>` (real `<a href>` or custom `component`, with `NavLink` active-state props). */
export function Link({
  to,
  replace,
  push: _push,
  children,
  style,
  className,
  activeClassName,
  activeStyle,
  exact,
  strict,
  sensitive,
  isActive: isActiveProp,
  component: CustomComponent,
  disabled,
  onClick,
  onPress,
  target,
  rel,
  testID,
  accessibilityLabel,
}: LiteLinkProps) {
  const location = useLocation();
  const targetUrl = resolveTo(to, location);
  const targetLoc = toLiteLocation(targetUrl);
  const active = resolveLinkActive(
    targetLoc.pathname,
    { pathname: location.pathname, search: location.search, hash: location.hash },
    { exact, strict, sensitive, isActive: isActiveProp },
  );
  const resolvedClassName = [className, active && activeClassName].filter(Boolean).join(' ') || undefined;
  const resolvedStyle = active && activeStyle ? { ...style, ...activeStyle } : style;

  return (
    <RRLink
      to={targetUrl}
      replace={replace}
      component={CustomComponent}
      style={resolvedStyle}
      className={resolvedClassName}
      aria-current={active ? 'page' : undefined}
      aria-disabled={disabled || undefined}
      target={target}
      rel={rel}
      onClick={
        disabled
          ? (e: React.MouseEvent<HTMLAnchorElement>) => e.preventDefault()
          : onClick || onPress
            ? (e: React.MouseEvent<HTMLAnchorElement>) => {
                onClick?.(e);
                onPress?.(e);
              }
            : undefined
      }
      data-testid={testID}
      aria-label={accessibilityLabel}
    >
      {children}
    </RRLink>
  );
}
