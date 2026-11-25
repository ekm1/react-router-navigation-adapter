import {
  compilePathPattern,
  extractParamNames,
  formatRelativeUrl,
  generatePathFromPattern,
  normalizeHash,
  normalizePathname,
  normalizeQueryInput,
  parseRelativeUrl,
  safeDecode,
} from './pathUtils';
import type {
  NavigationOptions,
  NavigationTarget,
  QueryParams,
  ReactNavigationLinkingConfig,
  QueryInput,
  ResolvedNavigationIntent,
  RouteConfigMap,
  RouteDefinition,
  RouteMatchResult,
  RouteParams,
  RouteRegistry,
  UnifiedRoute,
} from './types';

const SEGMENT = /^(?:[^:*?()+]+|:\w+\??|\*)$/;

/** Only `/static`, `/:param`, `/:param?` and a trailing `/*` are supported, identically on both platforms. */
function validatePattern(name: string, path: string): void {
  const segments = path.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
  segments.forEach((segment, idx) => {
    if (!SEGMENT.test(segment) || (segment === '*' && idx !== segments.length - 1)) {
      throw new Error(
        `[react-router-navigation-adapter] Route "${name}" has unsupported path segment "${segment}" in "${path}". Use "/static", "/:param", "/:param?" or a trailing "/*".`,
      );
    }
  });
}

interface CompiledRouteEntry<TName extends string> {
  definition: RouteDefinition<TName>;
  paramNames: string[];
  regex: RegExp;
}

function applyParsers(
  rawParams: Record<string, string | undefined>,
  parse?: Record<string, (raw: string) => unknown>,
): RouteParams {
  const result: RouteParams = {};
  for (const [key, value] of Object.entries(rawParams)) {
    if (value === undefined) continue;
    result[key] = parse?.[key] ? parse[key](value) : value;
  }
  return result;
}

function toReactNavigationPath(path: string): string {
  if (!path || path === '/') return '';
  return path.startsWith('/') ? path.slice(1) : path;
}

/**
 * Define the shared route registry used by both Web (React Router v5)
 * and Native (React Navigation).
 */
export function defineRoutes<TMap extends RouteConfigMap>(
  config: TMap,
): RouteRegistry<Extract<keyof TMap, string>> {
  type TName = Extract<keyof TMap, string>;

  const entries: CompiledRouteEntry<TName>[] = [];
  const byName = new Map<string, CompiledRouteEntry<TName>>();

  for (const [name, routeConfig] of Object.entries(config)) {
    validatePattern(name, routeConfig.path);
    const definition: RouteDefinition<TName> = {
      ...routeConfig,
      name: name as TName,
      exact: routeConfig.exact ?? true,
    };
    const compiled = compilePathPattern(definition.path, {
      exact: definition.exact,
      strict: definition.strict,
      sensitive: definition.sensitive,
    });
    const entry: CompiledRouteEntry<TName> = {
      definition,
      paramNames: extractParamNames(definition.path),
      regex: compiled.regex,
    };
    // Matching is first-match in declaration order (like React Router's <Switch>).
    // Warn when a static route can never match because an earlier route already does.
    if (entry.paramNames.length === 0) {
      const shadowing = entries.find((e) => e.regex.test(normalizePathname(definition.path)));
      if (shadowing && typeof console !== 'undefined') {
        console.warn(
          `[react-router-navigation-adapter] Route "${name}" (${definition.path}) is unreachable: "${shadowing.definition.name}" (${shadowing.definition.path}) is declared earlier and matches first. Declare "${name}" before it.`,
        );
      }
    }
    entries.push(entry);
    byName.set(name, entry);
  }

  const routes = entries.map((e) => e.definition);

  const getRoute = (name: string): RouteDefinition<TName> | undefined =>
    byName.get(name)?.definition;

  const hasRoute = (name: string): boolean => byName.has(name);

  const getParamNames = (name: string): string[] =>
    byName.get(name)?.paramNames ?? [];

  const buildPath = (
    name: TName,
    params: RouteParams = {},
    options?: Omit<NavigationOptions, 'state'>,
  ): string => {
    const entry = byName.get(name);
    if (!entry) {
      throw new Error(
        `[react-router-navigation-adapter] Unknown route name "${String(name)}". Registered routes: ${routes
          .map((r) => r.name)
          .join(', ')}`,
      );
    }
    const pathname = generatePathFromPattern(
      entry.definition.path,
      params,
      entry.definition.stringify,
    );
    return formatRelativeUrl(pathname, options?.query, options?.hash);
  };

  const matchUrl = (url: string): RouteMatchResult<TName> | null => {
    const parsed = parseRelativeUrl(url);
    const targetPathname = parsed.pathname;

    for (const entry of entries) {
      const match = entry.regex.exec(targetPathname);
      if (!match) continue;

      const rawParams: Record<string, string | undefined> = {};
      entry.paramNames.forEach((paramName, idx) => {
        const raw = match[idx + 1];
        rawParams[paramName] = raw === undefined ? undefined : safeDecode(raw);
      });

      const params = applyParsers(rawParams, entry.definition.parse);
      return {
        name: entry.definition.name,
        pattern: entry.definition.path,
        pathname: targetPathname,
        path: formatRelativeUrl(targetPathname, parsed.query, parsed.hash),
        params,
        query: parsed.query,
        hash: parsed.hash,
      };
    }

    return null;
  };

  /** Params that are not path params of the route become query params (same on both platforms). */
  const splitParams = (
    entry: CompiledRouteEntry<TName>,
    params: RouteParams,
  ): { pathParams: RouteParams; extraQuery: QueryParams } => {
    const pathParams: RouteParams = {};
    const extra: QueryInput = {};
    for (const [key, value] of Object.entries(params)) {
      if (entry.paramNames.includes(key)) pathParams[key] = value;
      else extra[key] = value as QueryInput[string];
    }
    return { pathParams, extraQuery: normalizeQueryInput(extra) };
  };

  const fromEntry = (
    entry: CompiledRouteEntry<TName>,
    params: RouteParams,
    query: QueryParams,
    hash: string,
    state: unknown,
  ): ResolvedNavigationIntent<TName> => {
    const { pathParams, extraQuery } = splitParams(entry, params);
    const mergedQuery = { ...extraQuery, ...query };
    const pathname = generatePathFromPattern(
      entry.definition.path,
      pathParams,
      entry.definition.stringify,
    );
    return {
      name: entry.definition.name,
      params: pathParams,
      query: mergedQuery,
      hash,
      state,
      pathname,
      path: formatRelativeUrl(pathname, mergedQuery, hash),
    };
  };

  const resolveTarget = (
    target: NavigationTarget<TName>,
    params?: RouteParams,
    options?: NavigationOptions,
  ): ResolvedNavigationIntent<TName> => {
    // Case 1: Object target { name, params, query, hash, state }
    if (typeof target === 'object' && target !== null) {
      const entry = byName.get(target.name);
      if (!entry) {
        throw new Error(
          `[react-router-navigation-adapter] Unknown route name "${String(target.name)}".`,
        );
      }
      return fromEntry(
        entry,
        { ...(target.params ?? {}), ...(params ?? {}) },
        { ...normalizeQueryInput(target.query), ...normalizeQueryInput(options?.query) },
        normalizeHash(options?.hash ?? target.hash),
        options?.state !== undefined ? options.state : target.state,
      );
    }

    // Case 2: Registered route name string (e.g. "UserProfile")
    const named = byName.get(target);
    if (named) {
      return fromEntry(
        named,
        params ?? {},
        normalizeQueryInput(options?.query),
        normalizeHash(options?.hash),
        options?.state,
      );
    }

    // Case 3: Relative URL path string (e.g. "/users/42?tab=posts#bio")
    if (target.startsWith('/') || /^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(target)) {
      const parsed = parseRelativeUrl(target);
      const mergedQuery: QueryParams = {
        ...parsed.query,
        ...normalizeQueryInput(options?.query),
      };
      const hash = normalizeHash(options?.hash ?? parsed.hash);
      const fullUrl = formatRelativeUrl(parsed.pathname, mergedQuery, hash);
      const matched = matchUrl(fullUrl);

      if (matched) {
        return fromEntry(
          byName.get(matched.name)!,
          { ...matched.params, ...(params ?? {}) },
          matched.query,
          matched.hash,
          options?.state,
        );
      }

      return {
        name: null,
        params: params ?? {},
        query: mergedQuery,
        hash,
        state: options?.state,
        pathname: parsed.pathname,
        path: fullUrl,
      };
    }

    throw new Error(
      `[react-router-navigation-adapter] Target "${target}" is neither a registered route name nor a relative URL starting with "/".`,
    );
  };

  const resolveParent = (
    route: UnifiedRoute<TName>,
  ): ResolvedNavigationIntent<TName> | null => {
    const parent = route.name ? byName.get(route.name)?.definition.parent : undefined;
    if (!parent) return null;
    return resolveTarget((typeof parent === 'function' ? parent(route) : parent) as NavigationTarget<TName>);
  };

  const toLinkingConfig = (prefixes: string[] = []): ReactNavigationLinkingConfig => {
    const screens: ReactNavigationLinkingConfig['config']['screens'] = {};
    for (const entry of entries) {
      const { definition } = entry;
      if (!definition.native) continue;
      screens[definition.name] = {
        path: toReactNavigationPath(definition.path),
        ...(definition.exact !== undefined ? { exact: definition.exact } : {}),
        ...(definition.parse ? { parse: definition.parse } : {}),
        ...(definition.stringify ? { stringify: definition.stringify } : {}),
      };
    }
    return {
      prefixes,
      config: { screens },
    };
  };

  return {
    routes,
    getRoute,
    hasRoute,
    getParamNames,
    buildPath,
    matchUrl,
    resolveParent,
    resolveTarget,
    toLinkingConfig,
  };
}
