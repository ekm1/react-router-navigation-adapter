import { normalizeQueryInput } from './pathUtils';
import type {
  BackAtRootContext,
  GetUserConfirmation,
  NavigationGuardAction,
  NavigationGuardCallback,
  QueryInput,
  QueryParams,
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

/** `goBack()` with no history: provider handler first, then the route's `parent`. */
export function backAtRoot(
  registry: RouteRegistry<any>,
  route: UnifiedRoute<any>,
  router: RouterController<any>,
  onBackAtRoot?: (ctx: BackAtRootContext) => void,
): void {
  if (onBackAtRoot) {
    onBackAtRoot({ route, router });
    return;
  }
  const parent = registry.resolveParent(route);
  if (parent) router.replace(parent.path, undefined, { state: parent.state });
}
