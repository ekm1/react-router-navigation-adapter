import React from 'react';
import {
  StackRouter,
  createNavigatorFactory,
  useNavigationBuilder,
} from '@react-navigation/native';

/**
 * Lightweight real React Navigation Stack Navigator built on @react-navigation/native's
 * official `useNavigationBuilder` + `StackRouter`. Renders the active screen on top while
 * keeping previous screens mounted (just like a real React Native Stack Navigator).
 */
function TestStackNavigator({
  initialRouteName,
  children,
  screenOptions,
}: {
  initialRouteName?: string;
  children: React.ReactNode;
  screenOptions?: any;
}) {
  const { state, descriptors, NavigationContent } = useNavigationBuilder(
    StackRouter,
    {
      initialRouteName,
      children,
      screenOptions,
    },
  );

  return (
    <NavigationContent>
      <div data-testid="rn-stack-navigator">
        {state.routes.map((route, idx) => {
          const isFocused = idx === state.index;
          return (
            <div
              key={route.key}
              data-testid={`rn-screen-${route.name}`}
              data-focused={String(isFocused)}
              style={{ display: isFocused ? 'block' : 'none' }}
            >
              {descriptors[route.key].render()}
            </div>
          );
        })}
      </div>
    </NavigationContent>
  );
}

export const createTestStackNavigator = createNavigatorFactory(TestStackNavigator);
