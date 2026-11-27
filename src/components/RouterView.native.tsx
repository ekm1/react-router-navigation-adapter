import React, { createContext, useContext, useEffect, useMemo, useRef } from 'react';
import { useNativeBypass } from '../adapters/native';
import { useUniversalRouterContext } from '../context';
import { useIsFocused, useRoute, useRouter } from '../hooks';
import { evaluateEntryGuard } from '../shared';
import type { RouteRegistry } from '../types';

export interface NativeNavigatorLike {
  Navigator: React.ComponentType<any>;
  Screen: React.ComponentType<any>;
}

export interface NativeRouterViewProps<TName extends string = string> {
  /** A React Navigation navigator created via `createNativeStackNavigator()`, `createStackNavigator()`, `createBottomTabNavigator()`, etc. */
  navigator: NativeNavigatorLike;
  /** Optional explicit route registry (defaults to the registry from `<RouterProvider>`). */
  routes?: RouteRegistry<TName>;
  /** Initial screen name for the navigator (defaults to the first screen). */
  initialRouteName?: TName | (string & {});
  /**
   * Nested navigators: render the routes whose `nestedIn` equals this path
   * (e.g. `['Tabs', 'HomeTab']`). Defaults to `[]`, the routes without `nestedIn`.
   */
  scope?: string[];
  /** Extra screens, e.g. the screens that render nested navigators: `<Stack.Screen name="Tabs" component={Tabs} />`. */
  children?: React.ReactNode;
  /** Default screen options passed to `<Navigator screenOptions={...}>`. */
  screenOptions?: Record<string, unknown> | ((props: any) => Record<string, unknown>);
  /** Additional props forwarded directly to `<Navigator>`. */
  navigatorProps?: Record<string, unknown>;
  /** Rendered if a mounted screen's route becomes disabled at runtime. */
  fallback?: React.ComponentType<any>;
}

interface NativeViewContextValue {
  registry: RouteRegistry<any>;
  routeContext?: unknown;
  fallback?: React.ComponentType<any>;
}

const NativeViewContext = createContext<NativeViewContextValue | null>(null);

/**
 * Declarative `<RouterView>` for Native — binds the shared route definitions
 * into any React Navigation navigator (`Stack`, `NativeStack`, `Tab`, `Drawer`, etc.).
 *
 * All `native: true` routes stay registered as `<Screen>`s regardless of `enabled` so
 * React Navigation stack state remains stable across runtime flag changes; disabled routes
 * are skipped during matching and render `fallback` (or `null`) if already mounted.
 * Route-level entry `guard` hooks are also enforced here for back/forward, alternative
 * elements, and reactive `routeContext` updates.
 */
export function RouterView<TName extends string = string>({
  navigator,
  routes: explicitRoutes,
  initialRouteName,
  screenOptions,
  navigatorProps,
  scope = [],
  children,
  fallback,
}: NativeRouterViewProps<TName>) {
  const { registry: contextRoutes, routeContext } = useUniversalRouterContext();
  const registry = (explicitRoutes ?? contextRoutes) as RouteRegistry<TName>;
  const { Navigator, Screen } = navigator;

  // Cache stable wrapper components by route name so React Navigation never remounts screens.
  const gateCacheRef = useRef(new Map<string, React.ComponentType<any>>());
  const getGate = (name: string) => {
    let Gate = gateCacheRef.current.get(name);
    if (!Gate) {
      Gate = function NativeScreenGate(props: any) {
        const view = useContext(NativeViewContext)!;
        const route = useRoute();
        const focused = useIsFocused();
        const router = useRouter();
        const bypass = useNativeBypass();

        const def = view.registry.getRoute(name);
        const isEnabled = Boolean(def?.component && view.registry.isRouteEnabled(name, view.routeContext));
        const guardEval = isEnabled
          ? evaluateEntryGuard(view.registry, route, view.routeContext)
          : null;

        const redirectTarget = guardEval?.kind === 'redirect' ? guardEval.intent : null;
        useEffect(() => {
          if (!focused || !redirectTarget) return;
          bypass(() => {
            router.replace(redirectTarget.path, undefined, { state: redirectTarget.state });
          });
        }, [focused, redirectTarget?.path, redirectTarget?.state, router, bypass]);

        if (!isEnabled) {
          const Fallback = view.fallback;
          return Fallback ? <Fallback {...props} /> : null;
        }
        if (guardEval?.kind === 'redirect') {
          return null;
        }
        if (guardEval?.kind === 'element') {
          return guardEval.element;
        }
        const ScreenComp = def!.component!;
        return <ScreenComp {...props} />;
      };
      Gate.displayName = `NativeScreenGate(${name})`;
      gateCacheRef.current.set(name, Gate);
    }
    return Gate;
  };

  const viewContextValue = useMemo<NativeViewContextValue>(
    () => ({ registry, routeContext, fallback }),
    [registry, routeContext, fallback],
  );

  // Only `native: true` routes get screens; everything else goes through `openWeb`/`onExternal`.
  const scopeKey = scope.join('/');
  const screenRoutes = registry.routes.filter(
    (r) => r.native && r.component && (r.nestedIn ?? []).join('/') === scopeKey,
  );
  const firstEnabled = screenRoutes.find((r) => registry.isRouteEnabled(r.name, routeContext));
  const resolvedInitial = initialRouteName ?? firstEnabled?.name ?? screenRoutes[0]?.name;

  return (
    <NativeViewContext.Provider value={viewContextValue}>
      <Navigator
        initialRouteName={resolvedInitial}
        screenOptions={screenOptions}
        {...navigatorProps}
      >
        {screenRoutes.map((route) => {
          const screenOpts = route.overlay
            ? { presentation: route.overlayPresentation ?? 'transparentModal', ...route.options }
            : route.options;
          return (
            <Screen
              key={route.name}
              name={route.name}
              component={getGate(route.name)}
              options={screenOpts}
            />
          );
        })}
        {children}
      </Navigator>
    </NativeViewContext.Provider>
  );
}
