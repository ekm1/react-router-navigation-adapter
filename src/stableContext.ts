import { useRef } from 'react';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function shallowEqualPlain(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const aKeys = Object.keys(a);
  if (aKeys.length !== Object.keys(b).length) return false;
  for (const key of aKeys) {
    if (!Object.prototype.hasOwnProperty.call(b, key) || !Object.is(a[key], b[key])) return false;
  }
  return true;
}

/**
 * Keeps the previous `routeContext` reference while a new plain object is shallow-equal to it.
 * Hosts commonly pass `routeContext={{ user, flags }}` inline; without this every host render
 * would rebuild the router context, re-render every hook consumer and re-match every route.
 * Non-plain values (class instances, arrays, primitives) are compared by identity, as before.
 */
export function useStableRouteContext<T>(routeContext: T): T {
  const ref = useRef(routeContext);
  const prev = ref.current;
  if (
    !Object.is(prev, routeContext) &&
    !(isPlainObject(prev) && isPlainObject(routeContext) && shallowEqualPlain(prev, routeContext))
  ) {
    ref.current = routeContext;
  }
  return ref.current;
}
