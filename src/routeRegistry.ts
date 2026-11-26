import {
  compileOverlaySuffixPattern,
  compilePathPattern,
  extractParamNames,
  extractRequiredParamNames,
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
  OverlayMatchResult,
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
function validatePattern(name: string, path: string, overlay?: boolean): void {
  const segments = path.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
  if (overlay && segments.length === 0) {
    throw new Error(
      `[react-router-navigation-adapter] Overlay route "${name}" cannot use root path "${path}". Specify a suffix path such as "/preview/:previewId".`,
    );
  }
  segments.forEach((segment, idx) => {
    if (!SEGMENT.test(segment) || (segment === '*' && idx !== segments.length - 1)) {
      const hint =
        segment === '*' && idx === 0 && segments.length > 1
          ? ` For overlay routes matching under any prefix, use \`overlay: true\` with path "/${segments.slice(1).join('/')}" instead.`
          : '';
      throw new Error(
        `[react-router-navigation-adapter] Route "${name}" has unsupported path segment "${segment}" in "${path}". Use "/static", "/:param", "/:param?" or a trailing "/*".${hint}`,
      );
    }
  });
}

interface CompiledPatternEntry {
  pattern: string;
  paramNames: string[];
  requiredParamNames: string[];
  regex: RegExp;
}

interface CompiledRouteEntry<TName extends string> {
  definition: RouteDefinition<TName>;
  patterns: CompiledPatternEntry[];
  /** Deduplicated union of param names across all patterns of this route. */
  paramNames: string[];
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

function hasParamValue(params: RouteParams, key: string): boolean {
  const value = params[key];
  return value !== undefined && value !== null;
}

/**
 * Selects the best path pattern for `params`:
 * 1. Filters to patterns whose required params are all provided in `params`.
 * 2. Prefers the pattern that consumes the most provided params.
 * 3. On ties, prefers `preferredPattern` if present, otherwise first in declaration order.
 */
function selectPattern(
  entry: CompiledRouteEntry<any>,
  params: RouteParams,
  preferredPattern?: string,
): CompiledPatternEntry {
  if (entry.patterns.length === 1) return entry.patterns[0];

  const satisfied = entry.patterns.filter((p) =>
    p.requiredParamNames.every((name) => hasParamValue(params, name)),
  );
  if (satisfied.length === 0) return entry.patterns[0];

  let bestCount = -1;
  let bestMatches: CompiledPatternEntry[] = [];
  for (const candidate of satisfied) {
    let consumed = 0;
    for (const name of candidate.paramNames) {
      if (hasParamValue(params, name)) consumed += 1;
    }
    if (consumed > bestCount) {
      bestCount = consumed;
      bestMatches = [candidate];
    } else if (consumed === bestCount) {
      bestMatches.push(candidate);
    }
  }

  if (preferredPattern) {
    const preferred = bestMatches.find((p) => p.pattern === preferredPattern);
    if (preferred) return preferred;
  }
  return bestMatches[0];
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
  const baseEntries: CompiledRouteEntry<TName>[] = [];
  const overlayEntries: CompiledRouteEntry<TName>[] = [];
  const byName = new Map<string, CompiledRouteEntry<TName>>();
  const allCompiled: Array<{ name: TName; pattern: string; regex: RegExp }> = [];

  for (const [name, routeConfig] of Object.entries(config)) {
    const paths = Array.isArray(routeConfig.path) ? [...routeConfig.path] : [routeConfig.path];
    if (paths.length === 0) {
      throw new Error(
        `[react-router-navigation-adapter] Route "${name}" must specify at least one path pattern.`,
      );
    }
    for (const pattern of paths) {
      validatePattern(name, pattern, routeConfig.overlay);
    }

    const { path: _rawPath, ...restConfig } = routeConfig;
    const definition: RouteDefinition<TName> = {
      ...restConfig,
      name: name as TName,
      path: paths[0],
      paths,
      exact: routeConfig.exact ?? true,
    };

    const compiledPatterns: CompiledPatternEntry[] = [];
    const paramNameSet = new Set<string>();

    for (const pattern of paths) {
      const compiled = definition.overlay
        ? compileOverlaySuffixPattern(pattern, {
            exact: definition.exact,
            strict: definition.strict,
            sensitive: definition.sensitive,
          })
        : compilePathPattern(pattern, {
            exact: definition.exact,
            strict: definition.strict,
            sensitive: definition.sensitive,
          });
      const paramNames = extractParamNames(pattern);
      for (const p of paramNames) paramNameSet.add(p);

      // Matching is first-match in declaration order (like React Router's <Switch>).
      // Warn when a static pattern can never match because an earlier always-enabled pattern already does.
      if (!definition.overlay && paramNames.length === 0) {
        const shadowing = allCompiled.find((e) => e.regex.test(normalizePathname(pattern)));
        if (shadowing && typeof console !== 'undefined') {
          console.warn(
            `[react-router-navigation-adapter] Route "${name}" (${pattern}) is unreachable: "${shadowing.name}" (${shadowing.pattern}) is declared earlier and matches first. Declare "${name}" before it.`,
          );
        }
      }

      compiledPatterns.push({
        pattern,
        paramNames,
        requiredParamNames: extractRequiredParamNames(pattern),
        regex: compiled.regex,
      });
      if (!definition.overlay && definition.enabled === undefined) {
        allCompiled.push({ name: name as TName, pattern, regex: compiled.regex });
      }
    }

    const entry: CompiledRouteEntry<TName> = {
      definition,
      patterns: compiledPatterns,
      paramNames: Array.from(paramNameSet),
    };
    entries.push(entry);
    if (definition.overlay) overlayEntries.push(entry);
    else baseEntries.push(entry);
    byName.set(name, entry);
  }

  const routes = entries.map((e) => e.definition);

  const getRoute = (name: string): RouteDefinition<TName> | undefined =>
    byName.get(name)?.definition;

  const hasRoute = (name: string): boolean => byName.has(name);

  const isRouteEnabled = (name: string, context?: unknown): boolean => {
    const entry = byName.get(name);
    if (!entry) return false;
    const { enabled } = entry.definition;
    if (enabled === undefined) return true;
    return typeof enabled === 'function' ? Boolean(enabled(context)) : Boolean(enabled);
  };

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
    const selected = selectPattern(entry, params);
    const pathname = generatePathFromPattern(
      selected.pattern,
      params,
      entry.definition.stringify,
    );
    return formatRelativeUrl(pathname, options?.query, options?.hash);
  };

  const matchBasePathname = (
    targetPathname: string,
    query: QueryParams,
    hash: string,
    context?: unknown,
  ): RouteMatchResult<TName> | null => {
    for (const entry of baseEntries) {
      if (!isRouteEnabled(entry.definition.name, context)) continue;
      for (const compiled of entry.patterns) {
        const match = compiled.regex.exec(targetPathname);
        if (!match) continue;

        const rawParams: Record<string, string | undefined> = {};
        compiled.paramNames.forEach((paramName, idx) => {
          const raw = match[idx + 1];
          rawParams[paramName] = raw === undefined ? undefined : safeDecode(raw);
        });

        const params = applyParsers(rawParams, entry.definition.parse);
        return {
          name: entry.definition.name,
          pattern: compiled.pattern,
          pathname: targetPathname,
          path: formatRelativeUrl(targetPathname, query, hash),
          params,
          query,
          hash,
        };
      }
    }
    return null;
  };

  const matchOverlayUrl = (url: string, context?: unknown): OverlayMatchResult<TName> | null => {
    if (overlayEntries.length === 0) return null;
    const parsed = parseRelativeUrl(url);
    const targetPathname = parsed.pathname;

    for (const entry of overlayEntries) {
      if (!isRouteEnabled(entry.definition.name, context)) continue;
      for (const compiled of entry.patterns) {
        const match = compiled.regex.exec(targetPathname);
        if (!match) continue;

        const rawPrefix = match[1] ?? '';
        const basePathname = rawPrefix ? normalizePathname(rawPrefix) : '/';
        const rawParams: Record<string, string | undefined> = {};
        compiled.paramNames.forEach((paramName, idx) => {
          const raw = match[idx + 2];
          rawParams[paramName] = raw === undefined ? undefined : safeDecode(raw);
        });

        const params = applyParsers(rawParams, entry.definition.parse);
        const overlay: RouteMatchResult<TName> = {
          name: entry.definition.name,
          pattern: compiled.pattern,
          pathname: targetPathname,
          path: formatRelativeUrl(targetPathname, parsed.query, parsed.hash),
          params,
          query: parsed.query,
          hash: parsed.hash,
          isOverlay: true,
          basePathname,
        };
        const base = matchBasePathname(basePathname, parsed.query, parsed.hash, context);
        return { overlay, base, basePathname };
      }
    }

    return null;
  };

  const matchUrl = (url: string, context?: unknown): RouteMatchResult<TName> | null => {
    const overlayMatch = matchOverlayUrl(url, context);
    if (overlayMatch) return overlayMatch.overlay;
    const parsed = parseRelativeUrl(url);
    return matchBasePathname(parsed.pathname, parsed.query, parsed.hash, context);
  };

  /** Params that are not path params of the selected pattern become query params (same on both platforms). */
  const splitParams = (
    paramNames: string[],
    params: RouteParams,
  ): { pathParams: RouteParams; extraQuery: QueryParams } => {
    const pathParams: RouteParams = {};
    const extra: QueryInput = {};
    for (const [key, value] of Object.entries(params)) {
      if (paramNames.includes(key)) pathParams[key] = value;
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
    /** Keep this pathname (non-exact routes matched by a longer URL, or overlay URLs). */
    keepPathname?: string,
    /** Preferred pattern (e.g. the alias pattern that matched a URL or current route). */
    preferredPattern?: string,
    /** Base pathname beneath an overlay route when known. */
    basePathname?: string,
    /** When false, target route is disabled and resolves as unmatched (`name: null`). */
    enabled = true,
  ): ResolvedNavigationIntent<TName> => {
    const selected = selectPattern(entry, params, preferredPattern);
    const { pathParams, extraQuery } = splitParams(selected.paramNames, params);
    const mergedQuery = { ...extraQuery, ...query };
    const pathname =
      keepPathname ??
      generatePathFromPattern(selected.pattern, pathParams, entry.definition.stringify);
    return {
      name: enabled ? entry.definition.name : null,
      params: pathParams,
      query: mergedQuery,
      hash,
      state,
      pathname,
      path: formatRelativeUrl(pathname, mergedQuery, hash),
      matchedPattern: enabled ? selected.pattern : undefined,
      ...(enabled && entry.definition.overlay
        ? { isOverlay: true, ...(basePathname ? { basePathname } : {}) }
        : {}),
    };
  };

  const resolveTarget = (
    target: NavigationTarget<TName>,
    params?: RouteParams,
    options?: NavigationOptions,
    context?: unknown,
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
        undefined,
        undefined,
        undefined,
        isRouteEnabled(entry.definition.name, context),
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
        undefined,
        undefined,
        undefined,
        isRouteEnabled(named.definition.name, context),
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
      const matched = matchUrl(fullUrl, context);

      if (matched) {
        const entry = byName.get(matched.name)!;
        // `{ path: '/bets', exact: false }` matching '/bets/123' must not truncate to '/bets'.
        // Overlay routes also keep their full prefixed pathname (e.g. '/projects/42/preview/123').
        const overridesPath = Object.keys(params ?? {}).some((k) => entry.paramNames.includes(k));
        const keepPathname =
          (entry.definition.exact === false || matched.isOverlay) && !overridesPath
            ? matched.pathname
            : undefined;
        return fromEntry(
          entry,
          { ...matched.params, ...(params ?? {}) },
          matched.query,
          matched.hash,
          options?.state,
          keepPathname,
          matched.pattern,
          matched.basePathname,
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
    context?: unknown,
  ): ResolvedNavigationIntent<TName> | null => {
    const parent = route.name ? byName.get(route.name)?.definition.parent : undefined;
    if (parent) {
      return resolveTarget(
        (typeof parent === 'function' ? parent(route) : parent) as NavigationTarget<TName>,
        undefined,
        undefined,
        context,
      );
    }
    if (route.isOverlay && route.basePathname) {
      return resolveTarget(route.basePathname, undefined, undefined, context);
    }
    return null;
  };

  const toLinkingConfig = (prefixes: string[] = []): ReactNavigationLinkingConfig => {
    const screens: ReactNavigationLinkingConfig['config']['screens'] = {};
    for (const entry of entries) {
      const { definition } = entry;
      if (!definition.native) continue;
      // Nested navigators: screens: { Tabs: { screens: { MyBetsTab: { screens: { Ticket } } } } }
      let level = screens;
      for (const navigatorRoute of definition.nestedIn ?? []) {
        const parent = (level[navigatorRoute] ??= { screens: {} });
        level = parent.screens ??= {};
      }
      const aliases = definition.paths.slice(1).map((p) => ({
        path: toReactNavigationPath(p),
        ...(definition.exact !== undefined ? { exact: definition.exact } : {}),
        ...(definition.parse ? { parse: definition.parse } : {}),
      }));
      level[definition.name] = {
        path: toReactNavigationPath(definition.paths[0]),
        ...(aliases.length > 0 ? { alias: aliases } : {}),
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
    isRouteEnabled,
    getParamNames,
    buildPath,
    matchUrl,
    matchOverlayUrl,
    resolveParent,
    resolveTarget,
    toLinkingConfig,
  };
}
