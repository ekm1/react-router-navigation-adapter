import React from 'react';
import {
  StackRouter,
  createNavigatorFactory,
  useNavigationBuilder,
  usePreventRemoveContext,
} from '@react-navigation/native';

/**
 * Lightweight real React Navigation stack navigator built on `useNavigationBuilder` + `StackRouter`.
 * Renders the active screen on top while keeping previous screens mounted (like a real stack).
 * Like native-stack (NativeStackView.native.tsx), its view reads `preventedRoutes` to decide
 * `preventNativeDismiss` (iOS swipe-back) and exposes it as `data-prevent-native-dismiss`.
 */
function TestStackView({ state, descriptors }: { state: any; descriptors: any }) {
  const { preventedRoutes } = usePreventRemoveContext();
  return (
    <div data-testid="rn-stack-navigator">
      {state.routes.map((route: any, idx: number) => {
        const isFocused = idx === state.index;
        return (
          <div
            key={route.key}
            data-testid={`rn-screen-${route.name}`}
            data-focused={String(isFocused)}
            data-prevent-native-dismiss={String(Boolean(preventedRoutes[route.key]?.preventRemove))}
            style={{ display: isFocused ? 'block' : 'none' }}
          >
            {descriptors[route.key].render()}
          </div>
        );
      })}
    </div>
  );
}

function TestStackNavigator({
  initialRouteName,
  children,
  screenOptions,
}: {
  initialRouteName?: string;
  children: React.ReactNode;
  screenOptions?: any;
}) {
  const { state, descriptors, NavigationContent } = useNavigationBuilder(StackRouter, {
    initialRouteName,
    children,
    screenOptions,
  });

  return (
    <NavigationContent>
      <TestStackView state={state} descriptors={descriptors} />
    </NavigationContent>
  );
}

export const createTestStackNavigator = createNavigatorFactory(TestStackNavigator);
