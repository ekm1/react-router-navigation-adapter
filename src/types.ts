import type { ComponentType, ReactElement, ReactNode } from 'react';

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

export type NativeOverlayPresentation =
  | 'modal'
  | 'transparentModal'
  | 'fullScreenModal'
  | 'containedModal'
  | 'containedTransparentModal';

export type EntryGuardResult<TName extends string = string> =
  | true
  | void
  | NavigationTarget<TName>
  | ReactElement;

export type EntryGuard<TName extends string = string> = (
  route: UnifiedRoute<TName>,
  context?: unknown,
) => EntryGuardResult<TName>;

export interface RouteConfigInput {
  /** One or more URL path patterns used on web (React Router v5) and for deep-link matching on native. E.g. "/users/:id" or ["/items", "/items/:id"] */
  path: string | readonly string[];
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
  /**
   * Native only: the route has a React Navigation screen. Routes without `native: true`
   * are handed to the native provider's `openWeb(url)` instead (WebView boundary).
   * Ignored on web.
   */
  native?: boolean;
  /**
   * Native only: route names of the navigators this screen is nested in, from the outer
   * `<RouterView>` navigator inwards (e.g. `['Tabs', 'HomeTab']`). Used for deep links into
   * nested navigators and for navigating into tabs/stacks that are not mounted yet.
   * Mounted navigators are found without it.
   */
  nestedIn?: string[];
  /**
   * Where `goBack()` goes when there is no history to go back to (e.g. after a deep link).
   */
  parent?: NavigationTarget<any> | ((route: UnifiedRoute<any>) => NavigationTarget<any>);
  /**
   * When true, `path` matches as a segment-aligned suffix of any URL pathname (replacing
   * React Router leading wildcards such as `"*\/preview/:previewId"`). On web, the underlying
   * base route keeps rendering with the overlay on top. On native, it pushes as a modal screen.
   */
  overlay?: boolean;
  /**
   * Native only: modal presentation style for `overlay: true` routes (defaults to `'transparentModal'`).
   */
  overlayPresentation?: NativeOverlayPresentation;
  /**
   * Runtime availability predicate evaluated at match time (with optional `<RouterProvider routeContext>`).
   * Disabled routes are skipped during matching as if unregistered.
   */
  enabled?: boolean | ((context?: any) => boolean);
  /**
   * Route-level entry guard evaluated before entering / rendering the route.
   * - `true` / `undefined`: allow entry and render `component`.
   * - `ReactElement`: stay at the URL and render the returned element in place of `component`.
   * - `NavigationTarget`: redirect (replace) to the target route or URL.
   */
  guard?: EntryGuard<any>;
}

export interface RouteDefinition<TName extends string = string>
  extends Omit<RouteConfigInput, 'path'> {
  /** Canonical screen name used by React Navigation and target-by-name navigation. */
  name: TName;
  /** Primary (first) URL path pattern for this route. */
  path: string;
  /** All URL path patterns for this route in declaration order (always non-empty). */
  paths: readonly string[];
  exact: boolean;
}

export type RouteConfigMap = Record<string, RouteConfigInput>;

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
  /** True when this route is an active `overlay: true` route. */
  isOverlay?: boolean;
  /** Underlying base pathname when `isOverlay` is true (e.g. "/projects/42" or "/"). */
  basePathname?: string;
}

export interface SetQueryOptions {
  /** Use replace instead of push (defaults to true). */
  replace?: boolean;
  /** Merge with existing query params instead of replacing all query params (defaults to true). */
  merge?: boolean;
}

/** Mirrors history v4 `Action`. */
export type HistoryAction = 'PUSH' | 'REPLACE' | 'POP';

/** Called after every location change (web: `history.listen`; native: container state change). */
export type NavigationListener = (route: UnifiedRoute, action: HistoryAction) => void;

export interface BackAtRootContext {
  route: UnifiedRoute<any>;
  router: RouterController<any>;
}

/** Confirmation used for string guard prompts. Web default: `window.confirm`; native default: `Alert.alert`. */
export type GetUserConfirmation = (message: string, callback: (allow: boolean) => void) => void;

/**
 * What a guard is intercepting. The same name is reported on both platforms:
 * `navigate()` → 'navigate', `push()` → 'push', `replace()`/`setParams()` → 'replace',
 * `reset()` → 'reset', and every kind of going back (back button, swipe, `goBack()`,
 * `go(-n)`, native pops) → 'goBack'.
 */
export type NavigationGuardAction =
  | 'navigate'
  | 'push'
  | 'replace'
  | 'goBack'
  | 'reset'
  /** @deprecated No longer reported: pops are reported as 'goBack' on both platforms. */
  | 'pop'
  | 'unknown';

export interface NavigationGuardContext {
  action: NavigationGuardAction;
  /** URL being navigated to, when known (not for back/pop). */
  nextPath?: string;
  /** Call to allow the blocked navigation to continue asynchronously (e.g. after custom modal confirm). */
  proceed: () => void;
  /** Call to prevent the navigation from occurring. */
  preventDefault: () => void;
}

/**
 * Guard callback invoked before leaving the current screen.
 * Return `false` or call `context.preventDefault()` to block navigation.
 * Returning a non-empty string uses it as a confirmation prompt via `getUserConfirmation` (web: `window.confirm`, native: `Alert.alert`).
 */
export type NavigationGuardCallback = (
  context: NavigationGuardContext,
) => boolean | string | void;

export interface ExternalNavigationOptions {
  /** On web without `onExternal`, uses `window.location.replace(url)` instead of `assign(url)`. */
  replace?: boolean;
}

export interface ImperativeLocation {
  pathname: string;
  search: string;
  hash: string;
  query: QueryParams;
  path: string;
  state?: unknown;
  key?: string;
}

export interface ImperativeRouter<TName extends string = string> {
  readonly platform: PlatformKind;
  getLocation: () => ImperativeLocation;
  getRoute: () => UnifiedRoute<TName>;
  subscribe: (listener: (location: ImperativeLocation, action: HistoryAction) => void) => () => void;
  navigate: RouterController<TName>['navigate'];
  push: RouterController<TName>['push'];
  replace: RouterController<TName>['replace'];
  goBack: RouterController<TName>['goBack'];
  go: RouterController<TName>['go'];
  canGoBack: RouterController<TName>['canGoBack'];
  getLength: RouterController<TName>['getLength'];
  reset: RouterController<TName>['reset'];
  setParams: RouterController<TName>['setParams'];
  setQuery: RouterController<TName>['setQuery'];
  buildUrl: RouterController<TName>['buildUrl'];
  openExternal: (url: string, options?: ExternalNavigationOptions) => void;
  reload: () => void;
}

export interface RouterHandle<TName extends string = string> {
  current: ImperativeRouter<TName> | null;
}

export interface RouterController<TName extends string = string> {
  /**
   * Go to a route or URL. Adds a history entry (web: `history.push`, native stack: `push`),
   * except when the target is the current location, which is updated in place.
   */
  navigate: (
    target: NavigationTarget<TName>,
    params?: RouteParams,
    options?: NavigationOptions,
  ) => void;
  /** Always add a new history entry, even for the current location. */
  push: (
    target: NavigationTarget<TName>,
    params?: RouteParams,
    options?: NavigationOptions,
  ) => void;
  /**
   * Replace the current entry. Targeting the current route name updates it in place
   * (the screen stays mounted on both platforms).
   */
  replace: (
    target: NavigationTarget<TName>,
    params?: RouteParams,
    options?: NavigationOptions,
  ) => void;
  /**
   * Go back one entry. With no history (e.g. opened from a deep link) it replaces with the
   * route's `parent` first, or calls the provider's `onBackAtRoot` when there is no `parent`.
   */
  goBack: () => void;
  /**
   * Go back `-delta` entries in one step (native: `StackActions.pop(n)`). Going back further
   * than the history allows behaves like `goBack()` at the root. Positive deltas do nothing.
   */
  go: (delta: number) => void;
  /** Number of entries in the current history stack (web: SPA entries; native: the screen's stack). */
  getLength: () => number;
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
  /**
   * Navigate to an external URL outside the router (runs active leave guards first).
   * - Web: calls `onExternal(url)` if configured, else `window.location.assign(url)` (or `replace(url)` when `options.replace` is true).
   * - Native: calls `onExternal(url)` / `openWeb(url)` (throws if neither is configured).
   */
  openExternal: (url: string, options?: ExternalNavigationOptions) => void;
  /**
   * Reload the current view (runs active leave guards first).
   * - Web: calls `onReload()` if configured, else `window.location.reload()`.
   * - Native: calls `onReload()` if configured, else logs a warning and no-ops.
   */
  reload: () => void;
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
  isOverlay?: boolean;
  basePathname?: string;
}

export interface OverlayMatchResult<TName extends string = string> {
  overlay: RouteMatchResult<TName>;
  base: RouteMatchResult<TName> | null;
  basePathname: string;
}

export interface ResolvedNavigationIntent<TName extends string = string> {
  name: TName | null;
  params: RouteParams;
  query: QueryParams;
  hash: string;
  state: unknown;
  pathname: string;
  path: string;
  /** Specific pattern matched or selected when the route defines multiple paths. */
  matchedPattern?: string;
  /** True when targeting an `overlay: true` route. */
  isOverlay?: boolean;
  /** Base pathname beneath the overlay when known. */
  basePathname?: string;
}

export interface LinkingScreenAlias {
  path: string;
  exact?: boolean;
  parse?: Record<string, (value: string) => any>;
}

export interface LinkingScreenConfig {
  path?: string;
  alias?: Array<string | LinkingScreenAlias>;
  exact?: boolean;
  parse?: Record<string, (value: string) => any>;
  stringify?: Record<string, (value: any) => string>;
  /** Screens of a nested navigator (see `RouteConfigInput.nestedIn`). */
  screens?: Record<string, LinkingScreenConfig>;
}

export interface ReactNavigationLinkingConfig {
  prefixes: string[];
  config: {
    screens: Record<string, LinkingScreenConfig>;
  };
}

export interface RouteRegistry<TName extends string = string> {
  readonly routes: ReadonlyArray<RouteDefinition<TName>>;
  getRoute: (name: string) => RouteDefinition<TName> | undefined;
  hasRoute: (name: string) => boolean;
  /** Returns whether `name` is currently enabled for the given `context`. */
  isRouteEnabled: (name: string, context?: unknown) => boolean;
  getParamNames: (name: string) => string[];
  buildPath: (
    name: TName,
    params?: RouteParams,
    options?: Omit<NavigationOptions, 'state'>,
  ) => string;
  matchUrl: (url: string, context?: unknown) => RouteMatchResult<TName> | null;
  /** Match an `overlay: true` suffix on `url`, returning both the overlay match and the underlying base route match. */
  matchOverlayUrl: (url: string, context?: unknown) => OverlayMatchResult<TName> | null;
  /** Resolve a route's `parent` (see `RouteConfigInput.parent`), or null. */
  resolveParent: (route: UnifiedRoute<TName>, context?: unknown) => ResolvedNavigationIntent<TName> | null;
  resolveTarget: (
    target: NavigationTarget<TName>,
    params?: RouteParams,
    options?: NavigationOptions,
    context?: unknown,
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
  /** Subscribe to location changes. Works outside screens. */
  useListen: () => (listener: NavigationListener) => () => void;
  /** Action of the most recent location change. */
  useLastAction: () => HistoryAction;
}

export interface LinkMatch<
  Params extends Record<string, string | undefined> = Record<string, string | undefined>,
> {
  params: Params;
  isExact: boolean;
  path: string;
  url: string;
}

export interface LinkLocation {
  pathname: string;
  search: string;
  hash: string;
  state?: unknown;
  key?: string;
}

export type LinkIsActive = (match: LinkMatch | null, location: LinkLocation) => boolean;

export interface WebLinkComponentProps {
  href?: string;
  navigate: () => void;
  onClick?: (event?: any) => void;
  className?: string;
  style?: any;
  children?: ReactNode;
  [key: string]: any;
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
  /** Web: class added while the link's target is active (like React Router's `NavLink`). */
  activeClassName?: string;
  /** Style merged in while the link's target is active. */
  activeStyle?: any;
  /** Active only on an exact pathname match (defaults to false: prefix match, like `NavLink`). */
  exact?: boolean;
  /** When true, trailing slashes are significant when matching active state. */
  strict?: boolean;
  /** When true, active pathname matching is case-sensitive. */
  sensitive?: boolean;
  /** Custom active-state predicate matching React Router v5 `NavLink` (`(match, location) => boolean`). */
  isActive?: LinkIsActive;
  /** Web: custom anchor renderer receiving `{ href, navigate, onClick, ...props }` (like React Router v5 `<Link component>`). Ignored on native. */
  component?: ComponentType<any>;
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
