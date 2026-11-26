import { createContext, useContext } from 'react';
import type { RouteRegistry, RouterAdapter } from './types';

export interface UniversalRouterContextValue {
  registry: RouteRegistry<any>;
  adapter: RouterAdapter<any>;
  routeContext?: unknown;
}

export const UniversalRouterContext =
  createContext<UniversalRouterContextValue | null>(null);

export function useUniversalRouterContext(): UniversalRouterContextValue {
  const ctx = useContext(UniversalRouterContext);
  if (!ctx) {
    throw new Error(
      '[react-router-navigation-adapter] Hooks and components must be used inside a <RouterProvider>.',
    );
  }
  return ctx;
}
