import { isValidElement, type ReactElement } from 'react';
import {
  extractParamNames,
  formatHash,
  formatRelativeUrl,
  generatePathFromPattern,
  joinBaseAndOverlay,
  normalizeQueryInput,
  parseRelativeUrl,
  stringifyQueryParams,
} from './pathUtils';
import { pickPattern } from './routeRegistry';
import type {
  BackAtRootContext,
  GetUserConfirmation,
  HistoryAction,
  LinkIsActive,
  LinkLocation,
  LinkMatch,
  NavigationGuardAction,
  NavigationGuardCallback,
  NavigationOptions,
  NavigationTarget,
  QueryInput,
  QueryParams,
  ResolvedNavigationIntent,
  RouteParams,
  RouteRegistry,
  RouterController,
  UnifiedRoute,
} from './types';

/**
 * Evaluates one navigation guard. Returns true when the navigation may continue right now.
 * When it returns false, `proceed` is called later if the user confirms (string prompt) or the
 * handler calls `context.proceed()` asynchronously. A synchronous `proceed()` just allows the
 * navigation, so the caller never replays an action from inside its own interception.
 */
export function runGuard(
  handler: string | NavigationGuardCallback | undefined,
  action: NavigationGuardAction,
  proceed: () => void,
  confirm: GetUserConfirmation,
  nextPath?: string,
): boolean {
  let sync = true;
  let done = false;
  let allowNow = false;
  const proceedOnce = () => {
    if (done) return;
    done = true;
    if (sync) allowNow = true;
    else proceed();
  };
  const ask = (message: string) => confirm(message, (ok) => ok && proceedOnce());

  if (typeof handler === 'function') {
    let prevented = false;
    const result = handler({
      action,
      nextPath,
      proceed: proceedOnce,
      preventDefault: () => {
        prevented = true;
      },
    });
    if (!done) {
      if (typeof result === 'string' && result) ask(result);
      else if (!prevented && result !== false) allowNow = true;
    }
  } else if (typeof handler === 'string' && handler) {
    ask(handler);
  }
  // No handler: block unconditionally.

  sync = false;
  return allowNow;
}

/** React Router v5 `Prompt` / `history.block` message. */
export type PromptMessage =
  | string
  | ((location: PromptLocation, action: HistoryAction) => string | boolean | void);

export interface PromptLocation {
  pathname: string;
  search: string;
  hash: string;
  state: unknown;
}

const PROMPT_ACTIONS: Record<NavigationGuardAction, HistoryAction> = {
  navigate: 'PUSH',
  push: 'PUSH',
  replace: 'REPLACE',
  reset: 'REPLACE',
  goBack: 'POP',
  pop: 'POP',
  unknown: 'POP',
};

/**
 * React Router v5 prompt semantics as a guard: a string asks for confirmation, `false` blocks,
 * `true`/`undefined` allow. The location is the target (empty pathname when unknown, e.g. back).
 */
export function promptToGuard(message: PromptMessage): NavigationGuardCallback {
  return ({ action, nextPath }) => {
    if (typeof message !== 'function') return message;
    const parsed = nextPath ? parseRelativeUrl(nextPath) : undefined;
    const location: PromptLocation = {
      pathname: parsed?.pathname ?? '',
      search: parsed?.search ?? '',
      hash: parsed?.hash ? `#${parsed.hash}` : '',
      state: undefined,
    };
    const result = message(location, PROMPT_ACTIONS[action]);
    return result === undefined ? true : result;
  };
}

/** Applies a `setQuery` input to the current query (null/undefined deletes a key). */
export function mergeQuery(current: QueryParams, input: QueryInput, merge: boolean): QueryParams {
  const next: QueryParams = merge ? { ...current } : {};
  for (const [key, value] of Object.entries(input)) {
    const normalized = normalizeQueryInput({ [key]: value });
    if (key in normalized) next[key] = normalized[key];
    else delete next[key];
  }
  return next;
}

/**
 * Resolves a navigation target relative to the current route.
 * For `overlay: true` routes targeted by name or target object, prepends the current base pathname
 * so `navigate('PreviewOverlay', { previewId: '123' })` on `/projects/42` resolves to `/projects/42/preview/123`.
 */
export function resolveTargetFromRoute<TName extends string>(
  registry: RouteRegistry<TName>,
  currentRoute: UnifiedRoute<TName>,
  target: NavigationTarget<TName>,
  params?: RouteParams,
  options?: NavigationOptions,
  context?: unknown,
): ResolvedNavigationIntent<TName> {
  const resolved = registry.resolveTarget(target, params, options, context);
  const isUrlTarget =
    typeof target === 'string' &&
    (target.startsWith('/') || /^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(target));
  if (resolved.isOverlay && !isUrlTarget) {
    const basePathname = currentRoute.basePathname ?? currentRoute.pathname;
    const pathname = joinBaseAndOverlay(basePathname, resolved.pathname);
    return {
      ...resolved,
      basePathname,
      pathname,
      path: formatRelativeUrl(pathname, resolved.query, resolved.hash),
    };
  }
  return resolved;
}

/**
 * `setParams(partial)` target: path params and extra (query) params merged over the current
 * route, with keys from `partial` winning over the current query. Same on both platforms.
 */
export function resolveParamsUpdate(
  registry: RouteRegistry<any>,
  route: UnifiedRoute<any>,
  partial: RouteParams,
  context?: unknown,
): ResolvedNavigationIntent<any> | null {
  if (!route.name) return null;
  const query = { ...route.query };
  for (const key of Object.keys(partial)) delete query[key];
  const mergedParams = { ...route.params, ...partial };
  const def = registry.getRoute(route.name);
  const applyOverlayPrefix = (intent: ResolvedNavigationIntent<any>): ResolvedNavigationIntent<any> => {
    if (!intent.isOverlay || !route.basePathname) return intent;
    const pathname = joinBaseAndOverlay(route.basePathname, intent.pathname);
    return {
      ...intent,
      basePathname: route.basePathname,
      pathname,
      path: formatRelativeUrl(pathname, intent.query, intent.hash),
    };
  };
  // Multi-path route: stay on the alias the screen was opened with while it still fits best
  // (e.g. `/p/:id/details` keeps that shape when only `id` changes).
  const keptPattern = route.matchedPattern;
  if (
    def &&
    keptPattern &&
    def.paths.length > 1 &&
    def.paths.includes(keptPattern) &&
    pickPattern(def.paths, mergedParams, keptPattern) === keptPattern
  ) {
    const patternParams = extractParamNames(keptPattern);
    const pathParams: RouteParams = {};
    const extra: QueryInput = {};
    for (const [k, v] of Object.entries(mergedParams)) {
      if (patternParams.includes(k)) pathParams[k] = v;
      else extra[k] = v as QueryInput[string];
    }
    const mergedQuery = { ...normalizeQueryInput(extra), ...query };
    const pathname = generatePathFromPattern(keptPattern, pathParams, def.stringify);
    return applyOverlayPrefix({
      name: route.name,
      params: pathParams,
      query: mergedQuery,
      hash: route.hash,
      state: route.state,
      pathname,
      path: formatRelativeUrl(pathname, mergedQuery, route.hash),
      matchedPattern: keptPattern,
      ...(def.overlay ? { isOverlay: true } : {}),
    });
  }
  return applyOverlayPrefix(
    registry.resolveTarget(
      route.name,
      mergedParams,
      {
        query,
        hash: route.hash,
        state: route.state,
      },
      context,
    ),
  );
}

/**
 * `goBack()` with no history: the route's `parent` first, then the provider's `onBackAtRoot`.
 * `guard(proceed)` runs navigation guards before `onBackAtRoot` (the `parent` replace is
 * guarded by the normal navigation path).
 */
export function backAtRoot(
  registry: RouteRegistry<any>,
  route: UnifiedRoute<any>,
  router: RouterController<any>,
  onBackAtRoot?: (ctx: BackAtRootContext) => void,
  guard?: (proceed: () => void) => boolean,
  context?: unknown,
): void {
  const parent = registry.resolveParent(route, context);
  if (parent) {
    router.replace(parent.path, undefined, { state: parent.state });
    return;
  }
  if (onBackAtRoot) {
    const leave = () => onBackAtRoot({ route, router });
    if (!guard || guard(leave)) leave();
  }
}

export type EntryGuardEvaluation<TName extends string = string> =
  | { kind: 'allow'; intent: ResolvedNavigationIntent<TName> }
  | { kind: 'element'; element: ReactElement; intent: ResolvedNavigationIntent<TName> }
  | { kind: 'redirect'; intent: ResolvedNavigationIntent<TName> };

const MAX_GUARD_HOPS = 10;

/**
 * Evaluates route-level entry `guard(route, context)` hooks along any redirect chain.
 * - Returns `{ kind: 'allow', intent }` when allowed.
 * - Returns `{ kind: 'element', element, intent }` when a guard returns an alternative ReactElement.
 * - Returns `{ kind: 'redirect', intent }` when one or more guards redirect to another target.
 */
export function resolveEntryGuardChain<TName extends string>(
  registry: RouteRegistry<TName>,
  initialIntent: ResolvedNavigationIntent<TName>,
  routeContext?: unknown,
): EntryGuardEvaluation<TName> {
  let current = initialIntent;
  let redirected = false;

  for (let hop = 0; hop < MAX_GUARD_HOPS; hop += 1) {
    if (!current.name) {
      return redirected ? { kind: 'redirect', intent: current } : { kind: 'allow', intent: current };
    }
    const def = registry.getRoute(current.name);
    if (!def?.guard) {
      return redirected ? { kind: 'redirect', intent: current } : { kind: 'allow', intent: current };
    }
    const candidate: UnifiedRoute<TName> = {
      name: current.name,
      path: current.path,
      pathname: current.pathname,
      params: current.params,
      query: current.query,
      hash: current.hash,
      state: current.state,
      matchedPattern: current.matchedPattern ?? def.path,
      ...(current.isOverlay ? { isOverlay: true, basePathname: current.basePathname } : {}),
    };
    const result = def.guard(candidate, routeContext);
    if (result === true || result === undefined) {
      return redirected ? { kind: 'redirect', intent: current } : { kind: 'allow', intent: current };
    }
    if (isValidElement(result)) {
      return redirected
        ? { kind: 'redirect', intent: current }
        : { kind: 'element', element: result, intent: current };
    }
    const next = registry.resolveTarget(
      result as NavigationTarget<TName>,
      undefined,
      undefined,
      routeContext,
    );
    if (next.path === current.path && next.name === current.name) {
      throw new Error(
        `[react-router-navigation-adapter] Entry guard on route "${current.name}" redirected to itself ("${current.path}").`,
      );
    }
    current = next;
    redirected = true;
  }

  throw new Error(
    `[react-router-navigation-adapter] Entry guard redirect chain exceeded ${MAX_GUARD_HOPS} hops (possible redirect cycle).`,
  );
}

/**
 * Render-time evaluation of a route's entry guard for `<RouterView>` (covers back/forward,
 * initial loads, SSR, alternative elements, and reactive `routeContext` updates).
 */
export function evaluateEntryGuard<TName extends string>(
  registry: RouteRegistry<TName>,
  route: UnifiedRoute<TName>,
  routeContext?: unknown,
): EntryGuardEvaluation<TName> {
  const intent: ResolvedNavigationIntent<TName> = {
    name: route.name,
    params: route.params,
    query: route.query,
    hash: route.hash,
    state: route.state,
    pathname: route.pathname,
    path: route.path,
    matchedPattern: route.matchedPattern ?? undefined,
    ...(route.isOverlay ? { isOverlay: true, basePathname: route.basePathname } : {}),
  };
  return resolveEntryGuardChain(registry, intent, routeContext);
}

/** Converts a `UnifiedRoute` into the `LinkLocation` shape passed to `Link`'s `isActive(match, location)`. */
export function toLinkLocation(route: UnifiedRoute<any>): LinkLocation {
  return {
    pathname: route.pathname,
    search: stringifyQueryParams(route.query),
    hash: formatHash(route.hash),
    state: route.state,
    key: route.key,
  };
}

/**
 * Computes a React Router v5 `NavLink`-compatible match object for `targetPathname`
 * against `currentPathname` honoring `exact`, `strict`, and `sensitive`.
 */
export function computeLinkMatch(
  targetPathname: string,
  currentPathname: string,
  options: { exact?: boolean; strict?: boolean; sensitive?: boolean } = {},
): LinkMatch | null {
  const { exact = false, strict = false, sensitive = false } = options;
  const trim = (p: string) => (p.length > 1 && p.endsWith('/') ? p.slice(0, -1) : p);
  const rawTarget = strict ? targetPathname : trim(targetPathname);
  const rawCurrent = strict ? currentPathname : trim(currentPathname);
  const cmpTarget = sensitive ? rawTarget : rawTarget.toLowerCase();
  const cmpCurrent = sensitive ? rawCurrent : rawCurrent.toLowerCase();

  if (cmpCurrent === cmpTarget) {
    return {
      params: {},
      isExact: true,
      path: targetPathname,
      url: rawCurrent,
    };
  }

  if (exact) return null;

  if (cmpTarget === '/') {
    if (!cmpCurrent.startsWith('/')) return null;
    return {
      params: {},
      isExact: false,
      path: targetPathname,
      url: '/',
    };
  }

  const prefixWithSlash = cmpTarget.endsWith('/') ? cmpTarget : `${cmpTarget}/`;
  if (cmpCurrent.startsWith(prefixWithSlash)) {
    const matchedUrl = rawCurrent.slice(0, rawTarget.length);
    return {
      params: {},
      isExact: false,
      path: targetPathname,
      url: matchedUrl,
    };
  }

  return null;
}

/** Evaluates whether a link is active using `NavLink` semantics and optional custom `isActive(match, location)`. */
export function resolveLinkActive(
  targetPathname: string,
  location: LinkLocation,
  options: { exact?: boolean; strict?: boolean; sensitive?: boolean; isActive?: LinkIsActive } = {},
): boolean {
  const match = computeLinkMatch(targetPathname, location.pathname, options);
  if (options.isActive) {
    return Boolean(options.isActive(match, location));
  }
  return Boolean(match);
}

