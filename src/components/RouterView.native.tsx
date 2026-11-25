import React from 'react';
import { useRouteRegistry } from '../hooks';
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
   * (e.g. `['Tabs', 'MyBetsTab']`). Defaults to `[]`, the routes without `nestedIn`.
   */
  scope?: string[];
  /** Extra screens, e.g. the screens that render nested navigators: `<Stack.Screen name="Tabs" component={Tabs} />`. */
  children?: React.ReactNode;
  /** Default screen options passed to `<Navigator screenOptions={...}>`. */
  screenOptions?: Record<string, unknown> | ((props: any) => Record<string, unknown>);
  /** Additional props forwarded directly to `<Navigator>`. */
  navigatorProps?: Record<string, unknown>;
  /** Accepted for API symmetry with web `<RouterView>`; unused on native. */
  fallback?: React.ComponentType<any>;
}

/**
 * Declarative `<RouterView>` for Native — binds the shared route definitions
 * into any React Navigation navigator (`Stack`, `NativeStack`, `Tab`, `Drawer`, etc.).
 */
export function RouterView<TName extends string = string>({
  navigator,
  routes: explicitRoutes,
  initialRouteName,
  screenOptions,
  navigatorProps,
  scope = [],
  children,
}: NativeRouterViewProps<TName>) {
  const contextRoutes = useRouteRegistry<TName>();
  const registry = explicitRoutes ?? contextRoutes;
  const { Navigator, Screen } = navigator;

  // Only `native: true` routes get screens; everything else goes through `openWeb`.
  const scopeKey = scope.join('/');
  const screenRoutes = registry.routes.filter(
    (r) => r.native && r.component && (r.nestedIn ?? []).join('/') === scopeKey,
  );
  const resolvedInitial = initialRouteName ?? screenRoutes[0]?.name;

  return (
    <Navigator
      initialRouteName={resolvedInitial}
      screenOptions={screenOptions}
      {...navigatorProps}
    >
      {screenRoutes.map((route) => (
        <Screen
          key={route.name}
          name={route.name}
          component={route.component!}
          options={route.options}
        />
      ))}
      {children}
    </Navigator>
  );
}
