import React from 'react';
import { Route, Switch } from 'react-router-dom';
import { useRouteRegistry } from '../hooks';
import type { RouteRegistry } from '../types';

export interface WebRouterViewProps<TName extends string = string> {
  /** Optional explicit route registry (defaults to the registry from `<RouterProvider>`). */
  routes?: RouteRegistry<TName>;
  /** Optional fallback / 404 component rendered when no route matches on web. */
  fallback?: React.ComponentType<any>;
  /** Accepted for API symmetry with native `<RouterView>`; ignored on web. */
  navigator?: {
    Navigator: React.ComponentType<any>;
    Screen: React.ComponentType<any>;
  };
  /** Accepted for API symmetry with native `<RouterView>`; ignored on web. */
  initialRouteName?: TName | (string & {});
  /** Accepted for API symmetry with native `<RouterView>`; ignored on web. */
  scope?: string[];
  /** Accepted for API symmetry with native `<RouterView>`; ignored on web. */
  children?: React.ReactNode;
  /** Accepted for API symmetry with native `<RouterView>`; ignored on web. */
  screenOptions?: Record<string, unknown> | ((props: any) => Record<string, unknown>);
  /** Accepted for API symmetry with native `<RouterView>`; ignored on web. */
  navigatorProps?: Record<string, unknown>;
}

/**
 * Declarative `<RouterView>` for Web — renders a React Router v5 `<Switch>` + `<Route>` tree
 * from the shared route definitions.
 */
export function RouterView<TName extends string = string>({
  routes: explicitRoutes,
  fallback: Fallback,
}: WebRouterViewProps<TName>) {
  const contextRoutes = useRouteRegistry<TName>();
  const registry = explicitRoutes ?? contextRoutes;

  return (
    <Switch>
      {registry.routes.map((route) => {
        if (!route.component) return null;
        return (
          <Route
            key={route.name}
            path={route.path}
            exact={route.exact}
            strict={route.strict}
            sensitive={route.sensitive}
            component={route.component}
          />
        );
      })}
      {Fallback ? <Route component={Fallback} /> : null}
    </Switch>
  );
}
