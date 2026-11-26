import type {
  Action,
  History,
  Location,
  LocationDescriptor,
  LocationDescriptorObject,
  LocationListener,
  TransitionPromptHook,
} from 'history';
import { formatRelativeUrl, normalizeHash, parseRelativeUrl } from '../pathUtils';

export type ControlledLocation =
  | string
  | {
      /** Full relative URL (alternative to `pathname` + `search` + `hash`). */
      path?: string;
      pathname?: string;
      search?: string;
      hash?: string;
      state?: unknown;
      key?: string;
    };

export type ControlledNavigateAction = 'push' | 'replace' | 'back';

export interface ControlledNavigateIntent {
  /** Target relative URL (`pathname + search + hash`). `undefined` when `action === 'back'`. */
  path?: string;
  action: ControlledNavigateAction;
  /** Location state to round-trip through the host. */
  state?: unknown;
  /** Positive step count when triggered by `go(-n)` with `n > 1`. */
  delta?: number;
}

export interface ControlledHistory extends History {
  readonly __isControlled: true;
  syncFromHost: (next: ControlledLocation, fallbackState?: unknown) => void;
  setOptions: (options: {
    onNavigate?: (intent: ControlledNavigateIntent) => void;
    basename?: string;
  }) => void;
  getDepth: () => number;
  resetDepth: () => void;
}

let keySeq = 0;
function nextKey(): string {
  keySeq += 1;
  return `ctrl_${keySeq}`;
}

export function normalizeControlledLocation(
  input: ControlledLocation,
  fallbackState?: unknown,
  existingKey?: string,
): Location {
  if (typeof input === 'string') {
    const parsed = parseRelativeUrl(input);
    return {
      pathname: parsed.pathname,
      search: parsed.search && parsed.search !== '?' ? parsed.search : '',
      hash: parsed.hash ? `#${parsed.hash}` : '',
      state: fallbackState,
      key: existingKey ?? nextKey(),
    };
  }
  const baseParsed = input.path !== undefined ? parseRelativeUrl(input.path) : null;
  const pathname =
    input.pathname !== undefined
      ? input.pathname || '/'
      : baseParsed
        ? baseParsed.pathname
        : '/';
  const rawSearch =
    input.search !== undefined ? input.search : baseParsed ? baseParsed.search : '';
  const search =
    rawSearch && rawSearch !== '?'
      ? rawSearch.startsWith('?')
        ? rawSearch
        : `?${rawSearch}`
      : '';
  const rawHash =
    input.hash !== undefined ? normalizeHash(input.hash) : baseParsed ? baseParsed.hash : '';
  const hash = rawHash ? `#${rawHash}` : '';
  const state = input.state !== undefined ? input.state : fallbackState;
  return {
    pathname,
    search,
    hash,
    state,
    key: input.key ?? existingKey ?? nextKey(),
  };
}

function descriptorToLocation(
  to: LocationDescriptor,
  current: Location,
  explicitState?: unknown,
): Location {
  if (typeof to === 'string') {
    if (to.startsWith('?')) {
      const parsed = parseRelativeUrl(`${current.pathname}${to}`);
      return {
        pathname: parsed.pathname,
        search: parsed.search,
        hash: parsed.hash ? `#${parsed.hash}` : '',
        state: explicitState,
        key: nextKey(),
      };
    }
    if (to.startsWith('#')) {
      return {
        pathname: current.pathname,
        search: current.search,
        hash: to.length > 1 ? to : '',
        state: explicitState,
        key: nextKey(),
      };
    }
    const parsed = parseRelativeUrl(to);
    return {
      pathname: parsed.pathname,
      search: parsed.search,
      hash: parsed.hash ? `#${parsed.hash}` : '',
      state: explicitState,
      key: nextKey(),
    };
  }
  const obj = to as LocationDescriptorObject;
  const pathname = obj.pathname !== undefined ? obj.pathname || '/' : current.pathname;
  const search =
    obj.search && obj.search !== '?'
      ? obj.search.startsWith('?')
        ? obj.search
        : `?${obj.search}`
      : '';
  const cleanHash = normalizeHash(obj.hash);
  const hash = cleanHash ? `#${cleanHash}` : '';
  return {
    pathname,
    search,
    hash,
    state: explicitState !== undefined ? explicitState : obj.state,
    key: obj.key ?? nextKey(),
  };
}

function locationToPath(loc: Pick<Location, 'pathname' | 'search' | 'hash'>): string {
  const parsed = parseRelativeUrl(`${loc.pathname}${loc.search}${loc.hash}`);
  return formatRelativeUrl(parsed.pathname, parsed.query, parsed.hash);
}

function stripTrailingSlash(value?: string): string {
  if (!value || value === '/') return '';
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

/**
 * Virtual history v4 implementation for controlled (host-owned URL) mode on web.
 * Never reads or writes `window.history`. Emits intents through `onNavigate` and
 * updates its location solely when the host updates the `location` prop.
 */
export function createControlledHistory(
  initialLocation: ControlledLocation,
  initialState?: unknown,
  options: {
    onNavigate?: (intent: ControlledNavigateIntent) => void;
    basename?: string;
  } = {},
): ControlledHistory {
  let currentLocation: Location = normalizeControlledLocation(initialLocation, initialState);
  let currentAction: Action = 'POP';
  let observedDepth = 0;
  let lastEmitted: { action: ControlledNavigateAction; path?: string; delta?: number } | null = null;
  let onNavigate = options.onNavigate;
  let basename = stripTrailingSlash(options.basename);

  const listeners = new Set<LocationListener>();
  let promptHook: TransitionPromptHook | boolean | string | null = null;

  const isBlocked = (nextLoc: Location, action: Action): boolean => {
    if (promptHook === null || promptHook === undefined || promptHook === true) return false;
    if (promptHook === false) return true;
    if (typeof promptHook === 'function') {
      const result = promptHook(nextLoc, action);
      return result === false || typeof result === 'string';
    }
    return true;
  };

  const emitPushOrReplace = (
    method: 'push' | 'replace',
    to: LocationDescriptor,
    state?: unknown,
  ) => {
    const nextLoc = descriptorToLocation(to, currentLocation, state);
    const historyAction: Action = method === 'push' ? 'PUSH' : 'REPLACE';
    if (isBlocked(nextLoc, historyAction)) return;
    const path = locationToPath(nextLoc);
    lastEmitted = { action: method, path };
    onNavigate?.({
      path,
      action: method,
      ...(nextLoc.state !== undefined ? { state: nextLoc.state } : {}),
    });
  };

  const emitBack = (delta: number) => {
    if (delta >= 0) return;
    const steps = -delta;
    const targetPlaceholder: Location = {
      pathname: '',
      search: '',
      hash: '',
      state: undefined,
      key: nextKey(),
    };
    if (isBlocked(targetPlaceholder, 'POP')) return;
    lastEmitted = { action: 'back', delta: steps };
    onNavigate?.({
      action: 'back',
      ...(steps > 1 ? { delta: steps } : {}),
    });
  };

  const history: ControlledHistory = {
    __isControlled: true,
    get length() {
      return observedDepth + 1;
    },
    get action() {
      return currentAction;
    },
    get location() {
      return currentLocation;
    },
    push: (to: any, state?: any) => emitPushOrReplace('push', to, state),
    replace: (to: any, state?: any) => emitPushOrReplace('replace', to, state),
    go: (n: number) => emitBack(n),
    goBack: () => emitBack(-1),
    goForward: () => {},
    block: (prompt: any = false) => {
      promptHook = prompt;
      return () => {
        if (promptHook === prompt) promptHook = null;
      };
    },
    listen: (listener: LocationListener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    createHref: (loc: LocationDescriptorObject) => {
      const resolved = descriptorToLocation(loc, currentLocation);
      const href = `${resolved.pathname}${resolved.search}${resolved.hash}`;
      return basename ? `${basename}${href.startsWith('/') ? href : `/${href}`}` : href;
    },
    setOptions: (nextOptions) => {
      onNavigate = nextOptions.onNavigate;
      basename = stripTrailingSlash(nextOptions.basename);
    },
    getDepth: () => observedDepth,
    resetDepth: () => {
      observedDepth = 0;
    },
    syncFromHost: (nextInput: ControlledLocation, fallbackState?: unknown) => {
      const candidate = normalizeControlledLocation(
        nextInput,
        fallbackState,
        currentLocation.key,
      );
      const same =
        candidate.pathname === currentLocation.pathname &&
        candidate.search === currentLocation.search &&
        candidate.hash === currentLocation.hash &&
        Object.is(candidate.state, currentLocation.state) &&
        (typeof nextInput === 'string' || nextInput.key === undefined || nextInput.key === currentLocation.key);
      if (same) return;

      const nextPath = locationToPath(candidate);
      let nextAction: Action = 'POP';
      if (lastEmitted) {
        if (lastEmitted.action === 'push' && lastEmitted.path === nextPath) {
          nextAction = 'PUSH';
          observedDepth += 1;
        } else if (lastEmitted.action === 'replace' && lastEmitted.path === nextPath) {
          nextAction = 'REPLACE';
        } else if (lastEmitted.action === 'back') {
          nextAction = 'POP';
          observedDepth = Math.max(0, observedDepth - (lastEmitted.delta ?? 1));
        }
        lastEmitted = null;
      }

      currentLocation = {
        ...candidate,
        key:
          typeof nextInput === 'object' && nextInput.key !== undefined
            ? nextInput.key
            : nextKey(),
      };
      currentAction = nextAction;
      for (const listener of Array.from(listeners)) {
        listener(currentLocation, currentAction);
      }
    },
  };

  return history;
}
