import { normalizeQueryInput, parseRelativeUrl } from './pathUtils';
import type {
  BackAtRootContext,
  GetUserConfirmation,
  HistoryAction,
  NavigationGuardAction,
  NavigationGuardCallback,
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
 * `setParams(partial)` target: path params and extra (query) params merged over the current
 * route, with keys from `partial` winning over the current query. Same on both platforms.
 */
export function resolveParamsUpdate(
  registry: RouteRegistry<any>,
  route: UnifiedRoute<any>,
  partial: RouteParams,
): ResolvedNavigationIntent<any> | null {
  if (!route.name) return null;
  const query = { ...route.query };
  for (const key of Object.keys(partial)) delete query[key];
  return registry.resolveTarget(route.name, { ...route.params, ...partial }, {
    query,
    hash: route.hash,
    state: route.state,
  });
}

/**
 * `goBack()` with no history: provider handler first, then the route's `parent`.
 * `guard(proceed)` runs navigation guards before `onBackAtRoot` (the `parent` replace is
 * guarded by the normal navigation path).
 */
export function backAtRoot(
  registry: RouteRegistry<any>,
  route: UnifiedRoute<any>,
  router: RouterController<any>,
  onBackAtRoot?: (ctx: BackAtRootContext) => void,
  guard?: (proceed: () => void) => boolean,
): void {
  if (onBackAtRoot) {
    const leave = () => onBackAtRoot({ route, router });
    if (!guard || guard(leave)) leave();
    return;
  }
  const parent = registry.resolveParent(route);
  if (parent) router.replace(parent.path, undefined, { state: parent.state });
}
