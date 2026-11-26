import React, { createContext, useContext } from 'react';
import { formatRelativeUrl, normalizeQueryInput, parseRelativeUrl } from '../pathUtils';
import type {
  GetUserConfirmation,
  NavigationGuardCallback,
  QueryInput,
  QueryParams,
  SetQueryOptions,
} from '../types';

/**
 * Compact layer: for apps that define routes the normal way (React Router `<Route>`s on web,
 * React Navigation navigators + `linking.config` on native) and only want one API in shared
 * modules. Everything is URL based; there is no route registry and no provider.
 */

export interface LiteLocation {
  /** e.g. "/myBets/42" */
  pathname: string;
  /** e.g. "?type=million" ('' when empty) */
  search: string;
  /** e.g. "#legs" ('' when empty; native linking has no hash) */
  hash: string;
  query: QueryParams;
  /** Full relative URL: pathname + search + hash. */
  path: string;
}

/** A URL ("/items/42?sort=asc", "?sort=asc", "#section") or its parts. */
export type LiteTo = string | { pathname?: string; query?: QueryInput; hash?: string };

/** Action reported to `useNavigationListener` in the compact layer. */
export type LiteNavigationAction = 'push' | 'replace' | 'goBack';

/** Callback passed to `useNavigationListener` in the compact layer. */
export type LiteNavigationListener = (location: LiteLocation, action: LiteNavigationAction) => void;

export interface LiteRouter {
  /** Adds a history entry (web `history.push`, native stack `push`); the current URL is updated in place. */
  navigate: (to: LiteTo) => void;
  /** Always adds a history entry. */
  push: (to: LiteTo) => void;
  /** Replaces the current entry (the same screen is updated in place). */
  replace: (to: LiteTo) => void;
  /** Goes back; with no history: `replace(fallback)` when given, else `<LiteConfig onBackAtRoot>`. */
  goBack: (fallback?: LiteTo) => void;
  canGoBack: () => boolean;
  /** Updates query params (`null` deletes a key). Defaults: merge, replace. */
  setQuery: (query: QueryInput, options?: SetQueryOptions) => void;
  /** Navigate to an external URL (guarded). Web: `onExternal` else `window.location.assign`/`replace`; Native: `onExternal`/`openWeb`. */
  openExternal: (url: string, options?: import('../types').ExternalNavigationOptions) => void;
  /** Reload the current view (guarded). Web: `onReload` else `window.location.reload()`; Native: `onReload` else warn & no-op. */
  reload: () => void;
  location: LiteLocation;
  platform: 'web' | 'native';
}

export interface LiteConfigValue {
  /** Native: URLs the app's linking config does not match (e.g. open a WebView). Without it they throw. */
  openWeb?: (url: string) => void;
  /** Cross-platform external URL handler (alias for `openWeb` on native). */
  onExternal?: (url: string) => void;
  /** Optional handler invoked by `router.reload()`. */
  onReload?: () => void;
  /** `goBack()` with no history (e.g. close the host). */
  onBackAtRoot?: () => void;
  /** Confirmation for string guards. Web default: `window.confirm`; native default: `Alert.alert`. */
  getUserConfirmation?: GetUserConfirmation;
}

const LiteConfigContext = createContext<LiteConfigValue>({});

/** Optional host-level settings for the compact layer. */
export function LiteConfig({ children, ...value }: LiteConfigValue & { children: React.ReactNode }) {
  return <LiteConfigContext.Provider value={value}>{children}</LiteConfigContext.Provider>;
}

export const useLiteConfig = () => useContext(LiteConfigContext);

export function toLiteLocation(url: string): LiteLocation {
  const parsed = parseRelativeUrl(url);
  return {
    pathname: parsed.pathname,
    search: parsed.search && parsed.search !== '?' ? parsed.search : '',
    hash: parsed.hash ? `#${parsed.hash}` : '',
    query: parsed.query,
    path: formatRelativeUrl(parsed.pathname, parsed.query, parsed.hash),
  };
}

/** Resolves `to` against the current location (query-only and hash-only targets keep the pathname). */
export function resolveTo(to: LiteTo, current: LiteLocation): string {
  if (typeof to === 'string') {
    if (to.startsWith('?')) return toLiteLocation(`${current.pathname}${to}`).path;
    if (to.startsWith('#')) return toLiteLocation(`${current.pathname}${current.search}${to}`).path;
    return toLiteLocation(to).path;
  }
  return formatRelativeUrl(to.pathname ?? current.pathname, normalizeQueryInput(to.query), to.hash);
}

export interface LiteLinkProps {
  to: LiteTo;
  replace?: boolean;
  push?: boolean;
  children?: React.ReactNode;
  style?: any;
  className?: string;
  activeClassName?: string;
  activeStyle?: any;
  exact?: boolean;
  strict?: boolean;
  sensitive?: boolean;
  isActive?: import('../types').LinkIsActive;
  component?: React.ComponentType<any>;
  disabled?: boolean;
  onClick?: (event?: any) => void;
  onPress?: (event?: any) => void;
  target?: string;
  rel?: string;
  testID?: string;
  accessibilityLabel?: string;
}

export type LiteGuard = string | NavigationGuardCallback;
