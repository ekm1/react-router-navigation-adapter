import {
  compilePathPattern,
  extractParamNames,
  formatRelativeUrl,
  generatePathFromPattern,
  normalizeHash,
  normalizeQueryInput,
  parseRelativeUrl,
  safeDecode,
} from './pathUtils';
import type {
  NavigationOptions,
  NavigationTarget,
  QueryParams,
  ReactNavigationLinkingConfig,
  ResolvedNavigationIntent,
  RouteConfigMap,
  RouteDefinition,
  RouteMatchResult,
  RouteParams,
  RouteRegistry,
} from './types';

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

  const resolveTarget = (
    target: NavigationTarget<TName>,
    params?: RouteParams,
    options?: NavigationOptions,
  ): ResolvedNavigationIntent<TName> => {
    // Case 1: Object target { name, params, query, hash, state }
    if (typeof target === 'object' && target !== null) {
      const mergedParams: RouteParams = {
        ...(target.params ?? {}),
        ...(params ?? {}),
      };
      const mergedQuery: QueryParams = {
        ...normalizeQueryInput(target.query),
        ...normalizeQueryInput(options?.query),
      };
      const hash = normalizeHash(options?.hash ?? target.hash);
      const state = options?.state !== undefined ? options.state : target.state;

      const entry = byName.get(target.name);
      if (!entry) {
        throw new Error(
          `[react-router-navigation-adapter] Unknown route name "${String(target.name)}".`,
        );
      }

      const pathname = generatePathFromPattern(
        entry.definition.path,
        mergedParams,
        entry.definition.stringify,
      );
      const path = formatRelativeUrl(pathname, mergedQuery, hash);

      return {
        name: entry.definition.name,
        params: mergedParams,
        query: mergedQuery,
        hash,
        state,
        pathname,
        path,
      };
    }

    // Case 2: Registered route name string (e.g. "UserProfile")
    if (byName.has(target)) {
      const entry = byName.get(target)!;
      const resolvedParams = params ?? {};
      const resolvedQuery = normalizeQueryInput(options?.query);
      const hash = normalizeHash(options?.hash);
      const pathname = generatePathFromPattern(
        entry.definition.path,
        resolvedParams,
        entry.definition.stringify,
      );
      const path = formatRelativeUrl(pathname, resolvedQuery, hash);
      return {
        name: entry.definition.name,
        params: resolvedParams,
        query: resolvedQuery,
        hash,
        state: options?.state,
        pathname,
        path,
      };
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
        return {
          name: matched.name,
          params: { ...matched.params, ...(params ?? {}) },
          query: matched.query,
          hash: matched.hash,
          state: options?.state,
          pathname: matched.pathname,
          path: matched.path,
        };
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

  const toLinkingConfig = (prefixes: string[] = []): ReactNavigationLinkingConfig => {
    const screens: ReactNavigationLinkingConfig['config']['screens'] = {};
    for (const entry of entries) {
      const { definition } = entry;
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
    resolveTarget,
    toLinkingConfig,
  };
}
