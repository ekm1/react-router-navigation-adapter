import React from 'react';
import { TabRouter, createNavigatorFactory, useNavigationBuilder } from '@react-navigation/native';

/**
 * Lightweight real tab navigator on `useNavigationBuilder` + `TabRouter`.
 * Like bottom-tabs, a tab mounts lazily the first time it is focused and stays mounted.
 */
function TestTabView({ state, descriptors }: { state: any; descriptors: any }) {
  const visited = React.useRef(new Set<string>());
  visited.current.add(state.routes[state.index].key);
  return (
    <div data-testid="rn-tab-navigator">
      {state.routes.map((route: any, idx: number) => {
        if (!visited.current.has(route.key)) return null;
        const isFocused = idx === state.index;
        return (
          <div
            key={route.key}
            data-testid={`rn-tab-${route.name}`}
            data-focused={String(isFocused)}
            style={{ display: isFocused ? 'block' : 'none' }}
          >
            {descriptors[route.key].render()}
          </div>
        );
      })}
    </div>
  );
}

function TestTabNavigator({
  initialRouteName,
  children,
  screenOptions,
  ...rest
}: {
  initialRouteName?: string;
  children: React.ReactNode;
  screenOptions?: any;
  backBehavior?: 'firstRoute' | 'initialRoute' | 'order' | 'history' | 'none';
  [key: string]: any;
}) {
  const { state, descriptors, NavigationContent } = useNavigationBuilder(TabRouter, {
    initialRouteName,
    children,
    screenOptions,
    ...rest,
  });
  return (
    <NavigationContent>
      <TestTabView state={state} descriptors={descriptors} />
    </NavigationContent>
  );
}

export const createTestTabNavigator = createNavigatorFactory(TestTabNavigator);
