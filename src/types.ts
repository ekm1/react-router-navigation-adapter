import type { ComponentType, ReactNode } from 'react';

export type PlatformKind = 'web' | 'native';

export type RouteParams = Record<string, unknown>;

export type QueryValue = string | string[] | undefined;
export type QueryParams = Record<string, QueryValue>;

export type QueryInputValue =
  | string
  | number
  | boolean
  | Array<string | number | boolean>
  | null
  | undefined;

export type QueryInput = Record<string, QueryInputValue>;

export interface RouteConfigInput {
  /** URL path pattern used on web (React Router v5) and for deep-link matching on native. E.g. "/users/:id" */
  path: string;
  /** Whether the path must match exactly on web (defaults to true). */
  exact?: boolean;
  /** Strict trailing slash matching on web (defaults to false). */
  strict?: boolean;
  /** Case-sensitive matching (defaults to false). */
  sensitive?: boolean;
  /** Optional screen component used by <RouterView>. */
  component?: ComponentType<any>;
  /** Optional screen options forwarded to React Navigation screens (e.g., { title: 'Profile' }). */
  options?: Record<string, unknown>;
  /** Custom parsers converting URL string segments into typed route params. */
  parse?: Record<string, (raw: string) => any>;
  /** Custom serializers converting typed route params into URL string segments. */
  stringify?: Record<string, (value: any) => string>;
}

export interface RouteDefinition<TName extends string = string>
  extends RouteConfigInput {
  /** Canonical screen name used by React Navigation and target-by-name navigation. */
  name: TName;
  exact: boolean;
}

export type RouteConfigMap = Record<string, RouteConfigInput>;

/**
 * Optional map of route names to their parameter shapes for compile-time typed routing.
 * Example:
 * ```ts
 * type AppParams = {
 *   Home: undefined;
 *   UserProfile: { id: number };
 * };
 * ```
 */
export type ParamListBase = Record<string, RouteParams | undefined>;

export interface NavigationOptions {
  /** Query string parameters appended to the URL (web) or stored in route metadata (native). */
  query?: QueryInput;
  /** URL hash fragment (with or without leading "#"). */
  hash?: string;
  /** Ephemeral navigation state not encoded into the URL path. */
  state?: unknown;
}

export interface NavigationTargetObject<
  TName extends string = string,
  TParams extends RouteParams = RouteParams,
> extends NavigationOptions {
  name: TName;
  params?: TParams;
}

/**
 * Target accepted by navigate/push/replace/<Link>/<Redirect>:
 * - A registered route name (e.g. "UserProfile")
 * - A relative URL path string starting with "/" (e.g. "/users/42?tab=posts#bio")
 * - An object specifying route name, params, query, hash, and state
 */
export type NavigationTarget<TName extends string = string> =
  | TName
  | (string & {})
  | NavigationTargetObject<TName>;

export interface ResetRouteEntry<TName extends string = string> {
  name: TName;
  params?: RouteParams;
  query?: QueryInput;
  hash?: string;
  state?: unknown;
}

export type ResetTarget<TName extends string = string> =
  | TName
  | (string & {})
  | ResetRouteEntry<TName>;

export interface UnifiedRoute<
  TName extends string = string,
  TParams extends RouteParams = RouteParams,
> {
  /** Matched route name from the RouteRegistry, or null if unmatched (e.g. 404 on web). */
  name: TName | null;
  /** Full relative URL including pathname, query string, and hash (e.g. "/users/42?tab=posts#top"). */
  path: string;
  /** Pathname portion only (e.g. "/users/42"). */
  pathname: string;
  /** Path parameters parsed according to the route's `parse` config. */
  params: TParams;
  /** Parsed query string parameters. */
  query: QueryParams;
  /** Hash fragment without leading "#" (empty string if absent). */
  hash: string;
  /** Ephemeral state associated with this navigation entry. */
  state: unknown;
  /** Underlying entry/route key when available. */
  key?: string;
  /** Matched route path pattern (e.g. "/users/:id"), or null if unmatched. */
  matchedPattern: string | null;
}

export interface SetQueryOptions {
  /** Use replace instead of push (defaults to true). */
  replace?: boolean;
  /** Merge with existing query params instead of replacing all query params (defaults to true). */
  merge?: boolean;
}

export type NavigationGuardAction =
  | 'navigate'
  | 'push'
  | 'replace'
  | 'goBack'
  | 'reset'
  | 'pop'
  | 'unknown';

export interface NavigationGuardContext {
  action: NavigationGuardAction;
  /** Call to allow the blocked navigation to continue asynchronously (e.g. after custom modal confirm). */
  proceed: () => void;
  /** Call to prevent the navigation from occurring. */
  preventDefault: () => void;
}

/**
 * Guard callback invoked before leaving the current screen.
 * Return `false` or call `context.preventDefault()` to block navigation.
 * Returning a non-empty string uses it as a confirmation prompt on web and blocks on native.
 */
export type NavigationGuardCallback = (
  context: NavigationGuardContext,
) => boolean | string | void;

export interface RouterController<TName extends string = string> {
  /** Navigate to a route or URL (web: history.push, native: navigation.navigate). */
  navigate: (
    target: NavigationTarget<TName>,
    params?: RouteParams,
    options?: NavigationOptions,
  ) => void;
  /** Push a new route entry onto the stack even if already on the same route. */
  push: (
    target: NavigationTarget<TName>,
    params?: RouteParams,
    options?: NavigationOptions,
  ) => void;
  /** Replace the current route entry without adding to back history. */
  replace: (
    target: NavigationTarget<TName>,
    params?: RouteParams,
    options?: NavigationOptions,
  ) => void;
  /** Go back one step in navigation history if possible. */
  goBack: () => void;
  /** Returns true when there is a previous route to go back to. */
  canGoBack: () => boolean;
  /** Reset the navigation stack to the provided routes (defaults index to last route). */
  reset: (routes: ResetTarget<TName>[], index?: number) => void;
  /** Merge updated path params into the currently active route. */
  setParams: (params: RouteParams) => void;
  /** Update query parameters on the currently active route. */
  setQuery: (query: QueryInput, options?: SetQueryOptions) => void;
  /** Build a canonical relative URL for any navigation target. */
  buildUrl: (
    target: NavigationTarget<TName>,
    params?: RouteParams,
    options?: NavigationOptions,
  ) => string;
  /** Snapshot of the currently active route. */
  route: UnifiedRoute<TName>;
  /** Active platform implementation ("web" or "native"). */
  platform: PlatformKind;
}

export interface RouteMatchResult<TName extends string = string> {
  name: TName;
  pattern: string;
  pathname: string;
  path: string;
  params: RouteParams;
  query: QueryParams;
  hash: string;
}

export interface ResolvedNavigationIntent<TName extends string = string> {
  name: TName | null;
  params: RouteParams;
  query: QueryParams;
  hash: string;
  state: unknown;
  pathname: string;
  path: string;
}

export interface ReactNavigationLinkingConfig {
  prefixes: string[];
  config: {
    screens: Record<
      string,
      {
        path: string;
        exact?: boolean;
        parse?: Record<string, (value: string) => any>;
        stringify?: Record<string, (value: any) => string>;
      }
    >;
  };
}

export interface RouteRegistry<TName extends string = string> {
  readonly routes: ReadonlyArray<RouteDefinition<TName>>;
  getRoute: (name: string) => RouteDefinition<TName> | undefined;
  hasRoute: (name: string) => boolean;
  getParamNames: (name: string) => string[];
  buildPath: (
    name: TName,
    params?: RouteParams,
    options?: Omit<NavigationOptions, 'state'>,
  ) => string;
  matchUrl: (url: string) => RouteMatchResult<TName> | null;
  resolveTarget: (
    target: NavigationTarget<TName>,
    params?: RouteParams,
    options?: NavigationOptions,
  ) => ResolvedNavigationIntent<TName>;
  toLinkingConfig: (prefixes?: string[]) => ReactNavigationLinkingConfig;
}

/**
 * Internal adapter contract implemented by both Web (React Router v5)
 * and Native (React Navigation) providers.
 */
export interface RouterAdapter<TName extends string = string> {
  platform: PlatformKind;
  useRoute: () => UnifiedRoute<TName>;
  useController: () => RouterController<TName>;
  useIsFocused: () => boolean;
  useFocusEffect: (effect: () => void | (() => void)) => void;
  useNavigationGuard: (
    when: boolean,
    messageOrHandler?: string | NavigationGuardCallback,
  ) => void;
}

export interface CommonLinkProps<TName extends string = string> {
  to: NavigationTarget<TName>;
  params?: RouteParams;
  query?: QueryInput;
  hash?: string;
  state?: unknown;
  replace?: boolean;
  push?: boolean;
  children?: ReactNode;
  className?: string;
  style?: any;
  testID?: string;
  accessibilityLabel?: string;
  disabled?: boolean;
  onPress?: (event?: any) => void;
  onClick?: (event?: any) => void;
  target?: string;
  rel?: string;
}

export interface RedirectProps<TName extends string = string> {
  to: NavigationTarget<TName>;
  params?: RouteParams;
  query?: QueryInput;
  hash?: string;
  state?: unknown;
  /** Whether to push instead of replace (defaults to false, matching React Router v5 <Redirect>). */
  push?: boolean;
}
