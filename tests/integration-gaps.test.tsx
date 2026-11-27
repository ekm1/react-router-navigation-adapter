import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { BackHandler } from 'react-native';
import { NavigationContainer, getStateFromPath } from '@react-navigation/native';
import { BrowserRouter, MemoryRouter, Route, StaticRouter, Switch } from 'react-router-dom';
import { defineRoutes } from '../src/routeRegistry';
import { useIsFocused, useNavigationGuard, useParams, useQuery, useRoute, useRouter } from '../src/hooks';
import { WebRouterProvider } from '../src/adapters/web';
import { NativeRouterProvider, createLinking, withHashLinking } from '../src/adapters/native';
import { RouterView as WebRouterView } from '../src/components/RouterView.web';
import { RouterView as NativeRouterView } from '../src/components/RouterView.native';
import { Link as WebLink } from '../src/components/Link.web';
import { Link as NativeLink } from '../src/components/Link.native';
import * as LiteWeb from '../src/lite/index.web';
import * as LiteNative from '../src/lite/index.native';
import { createRouterRef, getRouter } from '../src/imperative';
import { createTestStackNavigator } from './helpers/createTestStackNavigator';
import { createTestTabNavigator } from './helpers/createTestTabNavigator';
import type {
  CommonLinkProps,
  GetUserConfirmation,
  LinkIsActive,
  LinkLocation,
  LinkMatch,
  RouteRegistry,
  RouterController,
  RouterHandle,
  WebLinkComponentProps,
} from '../src/types';

export type ParityDriverName = 'web-memory' | 'web-browser' | 'native-stack' | 'native-tabs';

export const ALL_DRIVERS: ParityDriverName[] = [
  'web-memory',
  'web-browser',
  'native-stack',
  'native-tabs',
];

const captured: { router: RouterController | null } = { router: null };

afterEach(() => {
  captured.router = null;
  if (typeof window !== 'undefined') {
    window.history.replaceState(null, '', '/');
  }
});

const isVisible = (el: Element) => {
  for (
    let node: Element | null = el.closest('[data-focused]');
    node;
    node = node.parentElement?.closest('[data-focused]') ?? null
  ) {
    if (node.getAttribute('data-focused') !== 'true') return false;
  }
  return true;
};

const focusedText = (testId: string) =>
  screen.queryAllByTestId(testId).find(isVisible)?.textContent ?? null;

function buildTree(
  driver: ParityDriverName,
  routes: RouteRegistry<any>,
  options: {
    initialUrl?: string;
    openWeb?: (url: string) => void;
    onExternal?: (url: string) => void;
    onReload?: () => void;
    routerRef?: RouterHandle<any>;
    onBackAtRoot?: () => void;
    getUserConfirmation?: GetUserConfirmation;
    fallback?: React.ComponentType<any>;
    routeContext?: unknown;
    navigator?: any;
  } = {},
) {
  const initialUrl = options.initialUrl ?? '/';
  if (driver === 'web-memory') {
    return (
      <WebRouterProvider
        routes={routes}
        routeContext={options.routeContext}
        routerType="memory"
        initialEntries={[initialUrl]}
        onBackAtRoot={options.onBackAtRoot}
        onExternal={options.onExternal}
        onReload={options.onReload}
        routerRef={options.routerRef}
        getUserConfirmation={options.getUserConfirmation}
      >
        <WebRouterView fallback={options.fallback} />
      </WebRouterProvider>
    );
  }
  if (driver === 'web-browser') {
    return (
      <WebRouterProvider
        routes={routes}
        routeContext={options.routeContext}
        routerType="browser"
        onBackAtRoot={options.onBackAtRoot}
        onExternal={options.onExternal}
        onReload={options.onReload}
        routerRef={options.routerRef}
        getUserConfirmation={options.getUserConfirmation}
      >
        <WebRouterView fallback={options.fallback} />
      </WebRouterProvider>
    );
  }
  return (
    <NativeRouterProvider
      routes={routes}
      routeContext={options.routeContext}
      initialUrl={initialUrl}
      openWeb={options.openWeb}
      onExternal={options.onExternal ?? (options.openWeb ? undefined : () => {})}
      onReload={options.onReload}
      routerRef={options.routerRef}
      onBackAtRoot={options.onBackAtRoot}
      getUserConfirmation={options.getUserConfirmation}
    >
      <NativeRouterView
        navigator={options.navigator}
        fallback={options.fallback}
        navigatorProps={driver === 'native-tabs' ? { backBehavior: 'history' } : undefined}
      />
    </NativeRouterProvider>
  );
}

function renderWithDriver(
  driver: ParityDriverName,
  routes: RouteRegistry<any>,
  options: {
    initialUrl?: string;
    openWeb?: (url: string) => void;
    onExternal?: (url: string) => void;
    onReload?: () => void;
    routerRef?: RouterHandle<any>;
    onBackAtRoot?: () => void;
    getUserConfirmation?: GetUserConfirmation;
    fallback?: React.ComponentType<any>;
    routeContext?: unknown;
  } = {},
) {
  if (driver === 'web-browser') {
    window.history.replaceState(null, '', options.initialUrl ?? '/');
  }
  const navigator =
    driver === 'native-stack'
      ? createTestStackNavigator()
      : driver === 'native-tabs'
        ? createTestTabNavigator()
        : undefined;
  const result = render(buildTree(driver, routes, { ...options, navigator }));
  return {
    ...result,
    rerenderWith: (
      nextRoutes: RouteRegistry<any>,
      nextOptions: Partial<typeof options> = {},
    ) => {
      result.rerender(buildTree(driver, nextRoutes, { ...options, ...nextOptions, navigator }));
    },
  };
}

describe('Item 1: Multiple paths per route', () => {
  it('validates empty path arrays and warns on shadowed static aliases', () => {
    expect(() => defineRoutes({ Empty: { path: [] } })).toThrow(/at least one path pattern/);
    expect(() => defineRoutes({ Bad: { path: ['/ok', '/*/bad'] } })).toThrow(/unsupported path segment/);

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    defineRoutes({
      Project: { path: ['/projects/:id', '/projects/featured'] },
    });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('/projects/featured'));
    warn.mockRestore();
  });

  it('selects the first satisfied pattern consuming the most params for buildPath and resolveTarget', () => {
    const routes = defineRoutes({
      Items: { path: ['/items', '/items/:id'], native: true },
      Project: { path: ['/projects/:id', '/projects/:id/details'], native: true },
      Multi: { path: ['/a/:x', '/b/:x/:y'], native: true },
    });

    expect(routes.buildPath('Items')).toBe('/items');
    expect(routes.buildPath('Items', { id: '42' })).toBe('/items/42');
    expect(routes.buildPath('Items', { page: 2 })).toBe('/items');
    expect(routes.resolveTarget('Items', { page: 2 }).path).toBe('/items?page=2');
    expect(routes.resolveTarget('Items', { id: '42', page: 2 }).path).toBe('/items/42?page=2');

    // Equal param consumption ties break by declaration order
    expect(routes.buildPath('Project', { id: '7' })).toBe('/projects/7');
    // Navigating by alias URL preserves the alias
    const aliasIntent = routes.resolveTarget('/projects/7/details?sort=new');
    expect(aliasIntent.name).toBe('Project');
    expect(aliasIntent.pathname).toBe('/projects/7/details');
    expect(aliasIntent.matchedPattern).toBe('/projects/:id/details');
    expect(aliasIntent.path).toBe('/projects/7/details?sort=new');

    expect(routes.buildPath('Multi', { x: '1' })).toBe('/a/1');
    expect(routes.buildPath('Multi', { x: '1', y: '2' })).toBe('/b/1/2');
  });

  it('native toLinkingConfig emits RN7 alias entries and createLinking handles all aliases', () => {
    const routes = defineRoutes({
      Items: { path: ['/items', '/items/:id'], native: true },
      Project: {
        path: ['/projects/:id', '/projects/:id/details'],
        parse: { id: Number },
        stringify: { id: (v: number) => String(v) },
        native: true,
      },
    });

    const linkingCfg = routes.toLinkingConfig(['myapp://']);
    expect(linkingCfg.config.screens.Items.path).toBe('items');
    expect(linkingCfg.config.screens.Items.alias).toEqual([
      { path: 'items/:id', exact: true },
    ]);

    // Stock React Navigation getStateFromPath matches alias entries
    const rnState = getStateFromPath('items/99', linkingCfg.config as any);
    expect(rnState?.routes[0]).toMatchObject({ name: 'Items', params: { id: '99' } });

    const rnProjectState = getStateFromPath('projects/12/details', linkingCfg.config as any);
    expect(rnProjectState?.routes[0]).toMatchObject({ name: 'Project', params: { id: 12 } });

    // Adapter createLinking preserves the exact alias pattern and round-trips it
    const linking = createLinking(routes, ['myapp://']);
    const state = linking.getStateFromPath!('projects/12/details?tab=feed', linking.config as any);
    expect(linking.getPathFromState!(state as any, linking.config as any)).toBe('/projects/12/details?tab=feed');
  });

  describe.each<ParityDriverName>(ALL_DRIVERS)('parity (%s)', (driver) => {
    function ItemsScreen() {
      const router = useRouter();
      const route = useRoute();
      const params = useParams<{ id?: string }>();
      const query = useQuery();
      captured.router = router;
      return (
        <div data-testid="screen-items">
          <span data-testid="route-name">{route.name}</span>
          <span data-testid="route-path">{route.path}</span>
          <span data-testid="route-pattern">{route.matchedPattern}</span>
          <span data-testid="route-params">{JSON.stringify(params)}</span>
          <span data-testid="route-query">{JSON.stringify(query)}</span>
        </div>
      );
    }

    function ProjectScreen() {
      const router = useRouter();
      const route = useRoute();
      const params = useParams<{ id?: number }>();
      captured.router = router;
      return (
        <div data-testid="screen-project">
          <span data-testid="route-name">{route.name}</span>
          <span data-testid="route-path">{route.path}</span>
          <span data-testid="route-pattern">{route.matchedPattern}</span>
          <span data-testid="route-params">{JSON.stringify(params)}</span>
        </div>
      );
    }

    const routes = defineRoutes({
      Items: {
        path: ['/items', '/items/:id'],
        component: ItemsScreen,
        native: true,
      },
      Project: {
        path: ['/projects/:id', '/projects/:id/details'],
        parse: { id: Number },
        stringify: { id: (v: number) => String(v) },
        component: ProjectScreen,
        native: true,
      },
    });

    it('opens from any alias via initialUrl and preserves matchedPattern, setParams, and setQuery', () => {
      renderWithDriver(driver, routes, { initialUrl: '/projects/42/details?filter=all' });

      expect(focusedText('route-name')).toBe('Project');
      expect(focusedText('route-path')).toBe('/projects/42/details?filter=all');
      expect(focusedText('route-pattern')).toBe('/projects/:id/details');
      expect(focusedText('route-params')).toBe('{"id":42}');

      // setQuery preserves the active alias pattern
      act(() => captured.router!.setQuery({ page: 2 }));
      expect(focusedText('route-path')).toBe('/projects/42/details?filter=all&page=2');
      expect(focusedText('route-pattern')).toBe('/projects/:id/details');

      // setParams updates param while preserving the active alias pattern
      act(() => captured.router!.setParams({ id: 99 }));
      expect(focusedText('route-path')).toBe('/projects/99/details?filter=all&page=2');
      expect(focusedText('route-pattern')).toBe('/projects/:id/details');
    });

    it('navigates by name with/without params and by alias URL', () => {
      renderWithDriver(driver, routes, { initialUrl: '/items' });

      expect(focusedText('route-path')).toBe('/items');
      expect(focusedText('route-pattern')).toBe('/items');

      act(() => captured.router!.navigate('Items', { id: '55' }));
      expect(focusedText('route-path')).toBe('/items/55');
      expect(focusedText('route-pattern')).toBe('/items/:id');
      expect(focusedText('route-params')).toBe('{"id":"55"}');

      act(() => captured.router!.navigate('/projects/7/details'));
      expect(focusedText('route-name')).toBe('Project');
      expect(focusedText('route-path')).toBe('/projects/7/details');
      expect(focusedText('route-pattern')).toBe('/projects/:id/details');

      act(() => captured.router!.navigate('Project', { id: 8 }));
      expect(focusedText('route-path')).toBe('/projects/8');
      expect(focusedText('route-pattern')).toBe('/projects/:id');
    });

    it('runs leave guards when transitioning between aliases of the same route', () => {
      const answers = [false, true];
      const confirm = vi.fn<GetUserConfirmation>((_m, cb) => cb(answers.shift() ?? true));
      let block = true;

      function GuardedProject() {
        const router = useRouter();
        const route = useRoute();
        captured.router = router;
        useNavigationGuard(block, 'Leave project view?');
        return <span data-testid="route-path">{route.path}</span>;
      }

      const guardedRoutes = defineRoutes({
        Project: { path: ['/projects/:id', '/projects/:id/details'], component: GuardedProject, native: true },
      });

      renderWithDriver(driver, guardedRoutes, {
        initialUrl: '/projects/1',
        getUserConfirmation: confirm,
      });

      act(() => captured.router!.navigate('/projects/1/details'));
      expect(confirm).toHaveBeenCalledTimes(1);
      expect(focusedText('route-path')).toBe('/projects/1');

      act(() => captured.router!.navigate('/projects/1/details'));
      expect(focusedText('route-path')).toBe('/projects/1/details');
      block = false;
    });
  });
});

describe('Item 2: Overlay routes matching under any prefix', () => {
  it('rejects leading wildcard with hint pointing to overlay: true and rejects root overlay path', () => {
    expect(() => defineRoutes({ Event: { path: '*/preview/:previewId' } })).toThrow(/overlay: true/);
    expect(() => defineRoutes({ BadOverlay: { path: '/', overlay: true } })).toThrow(/cannot use root path/);
  });

  it('matches overlay suffixes under any prefix and splits base vs overlay matches', () => {
    const routes = defineRoutes({
      Home: { path: '/', native: true },
      Project: { path: '/projects/:id', parse: { id: Number }, native: true },
      PreviewOverlay: { path: '/preview/:previewId', overlay: true, native: true },
    });

    const underProject = routes.matchOverlayUrl('/projects/42/preview/99?tab=summary');
    expect(underProject?.basePathname).toBe('/projects/42');
    expect(underProject?.base?.name).toBe('Project');
    expect(underProject?.base?.params).toEqual({ id: 42 });
    expect(underProject?.overlay.name).toBe('PreviewOverlay');
    expect(underProject?.overlay.params).toEqual({ previewId: '99' });
    expect(underProject?.overlay.isOverlay).toBe(true);

    const underRoot = routes.matchOverlayUrl('/preview/7');
    expect(underRoot?.basePathname).toBe('/');
    expect(underRoot?.base?.name).toBe('Home');
    expect(underRoot?.overlay.params).toEqual({ previewId: '7' });

    expect(routes.matchOverlayUrl('/projects/42')).toBeNull();
    expect(routes.matchOverlayUrl('/mypreview/7')).toBeNull();
  });

  describe.each<ParityDriverName>(['web-memory', 'web-browser', 'native-stack'])(
    'overlay parity (%s)',
    (driver) => {
      it('opens overlay over base route, keeps base mounted with isolated route/params/focus, and back closes overlay', async () => {
        let baseMounts = 0;
        let overlayRouter: RouterController | null = null;
        let baseRouter: RouterController | null = null;

        function ProjectScreen() {
          const router = useRouter();
          const route = useRoute();
          const params = useParams<{ id: number }>();
          const focused = useIsFocused();
          baseRouter = router;
          React.useEffect(() => {
            baseMounts += 1;
          }, []);
          return (
            <div data-testid="base-project">
              <span data-testid="base-name">{route.name}</span>
              <span data-testid="base-params">{JSON.stringify(params)}</span>
              <span data-testid="base-focused">{String(focused)}</span>
              <span data-testid="base-pathname">{route.pathname}</span>
            </div>
          );
        }

        function PreviewOverlayScreen() {
          const router = useRouter();
          const route = useRoute();
          const params = useParams<{ previewId: string }>();
          const focused = useIsFocused();
          overlayRouter = router;
          return (
            <div data-testid="overlay-preview">
              <span data-testid="overlay-name">{route.name}</span>
              <span data-testid="overlay-params">{JSON.stringify(params)}</span>
              <span data-testid="overlay-pathname">{route.pathname}</span>
              <span data-testid="overlay-base">{route.basePathname}</span>
              <span data-testid="overlay-focused">{String(focused)}</span>
            </div>
          );
        }

        const routes = defineRoutes({
          Project: { path: '/projects/:id', parse: { id: Number }, component: ProjectScreen, native: true },
          PreviewOverlay: {
            path: '/preview/:previewId',
            overlay: true,
            overlayPresentation: 'transparentModal',
            component: PreviewOverlayScreen,
            native: true,
          },
        });

        renderWithDriver(driver, routes, { initialUrl: '/projects/42' });
        expect(baseMounts).toBe(1);
        expect(screen.getByTestId('base-focused')).toHaveTextContent('true');
        expect(baseRouter!.buildUrl('PreviewOverlay', { previewId: '123' })).toBe('/projects/42/preview/123');

        // Open overlay over /projects/42
        act(() => baseRouter!.navigate('PreviewOverlay', { previewId: '123' }));
        expect(baseMounts).toBe(1); // base screen stayed mounted
        expect(screen.getByTestId('base-name')).toHaveTextContent('Project');
        expect(screen.getByTestId('base-params')).toHaveTextContent('{"id":42}');
        expect(screen.getByTestId('base-pathname')).toHaveTextContent('/projects/42');
        expect(screen.getByTestId('base-focused')).toHaveTextContent('false');

        expect(screen.getByTestId('overlay-name')).toHaveTextContent('PreviewOverlay');
        expect(screen.getByTestId('overlay-params')).toHaveTextContent('{"previewId":"123"}');
        expect(screen.getByTestId('overlay-pathname')).toHaveTextContent('/projects/42/preview/123');
        expect(screen.getByTestId('overlay-base')).toHaveTextContent('/projects/42');
        expect(screen.getByTestId('overlay-focused')).toHaveTextContent('true');

        if (driver === 'native-stack') {
          expect(screen.getByTestId('rn-screen-PreviewOverlay')).toHaveAttribute(
            'data-presentation',
            'transparentModal',
          );
        }

        // Back closes the overlay and restores focus on base screen
        act(() => overlayRouter!.goBack());
        await waitFor(() => expect(screen.queryByTestId('overlay-preview')).toBeNull());
        expect(screen.getByTestId('base-focused')).toHaveTextContent('true');
        expect(baseMounts).toBe(1);
      });

      it('deep-linking directly to an overlay URL mounts base underneath and goBack closes overlay to base', async () => {
        let overlayRouter: RouterController | null = null;
        function ProjectScreen() {
          const params = useParams<{ id: string }>();
          return <div data-testid="base-project">project:{params.id}</div>;
        }
        function PreviewOverlayScreen() {
          overlayRouter = useRouter();
          const params = useParams<{ previewId: string }>();
          return <div data-testid="overlay-preview">preview:{params.previewId}</div>;
        }
        const routes = defineRoutes({
          Project: { path: '/projects/:id', component: ProjectScreen, native: true },
          PreviewOverlay: { path: '/preview/:previewId', overlay: true, component: PreviewOverlayScreen, native: true },
        });

        renderWithDriver(driver, routes, { initialUrl: '/projects/7/preview/55' });
        expect(screen.getByTestId('base-project')).toHaveTextContent('project:7');
        expect(screen.getByTestId('overlay-preview')).toHaveTextContent('preview:55');

        act(() => overlayRouter!.goBack());
        await waitFor(() => expect(screen.queryByTestId('overlay-preview')).toBeNull());
        expect(screen.getByTestId('base-project')).toHaveTextContent('project:7');
      });

      it('opening an overlay skips base-screen leave guard, while closing runs overlay leave guard', async () => {
        const answers = [false, true];
        const confirm = vi.fn<GetUserConfirmation>((_m, cb) => cb(answers.shift() ?? true));
        let baseRouter: RouterController | null = null;
        let overlayRouter: RouterController | null = null;

        function GuardedProject() {
          baseRouter = useRouter();
          useNavigationGuard(true, 'Discard project form?');
          return <div data-testid="base-project">project</div>;
        }
        function GuardedOverlay() {
          overlayRouter = useRouter();
          useNavigationGuard(true, 'Close preview overlay?');
          return <div data-testid="overlay-preview">preview</div>;
        }
        const routes = defineRoutes({
          Project: { path: '/projects/:id', component: GuardedProject, native: true },
          PreviewOverlay: { path: '/preview/:previewId', overlay: true, component: GuardedOverlay, native: true },
        });

        renderWithDriver(driver, routes, { initialUrl: '/projects/1', getUserConfirmation: confirm });

        // Opening overlay over same base does NOT trigger base screen's leave guard
        act(() => baseRouter!.navigate('PreviewOverlay', { previewId: '10' }));
        expect(confirm).not.toHaveBeenCalled();
        expect(screen.getByTestId('overlay-preview')).toBeTruthy();

        // Closing overlay triggers overlay's leave guard (declined, then accepted)
        act(() => overlayRouter!.goBack());
        await waitFor(() =>
          expect(confirm).toHaveBeenCalledWith('Close preview overlay?', expect.any(Function)),
        );
        expect(screen.getByTestId('overlay-preview')).toBeTruthy();

        act(() => overlayRouter!.goBack());
        await waitFor(() => expect(screen.queryByTestId('overlay-preview')).toBeNull());
      });
    },
  );

  it('native tabs + root stack modal overlay: opens over active tab and deep-links cleanly', () => {
    const RootStack = createTestStackNavigator();
    const Tab = createTestTabNavigator();
    const ProjectStack = createTestStackNavigator();
    let activeRouter: RouterController | null = null;

    function ProjectScreen() {
      activeRouter = useRouter();
      const params = useParams<{ id: string }>();
      return <span data-testid="tab-project">project:{params.id}</span>;
    }
    function PreviewOverlayScreen() {
      activeRouter = useRouter();
      const route = useRoute();
      return <span data-testid="tab-overlay">{route.pathname}</span>;
    }

    const routes = defineRoutes({
      Project: { path: '/projects/:id', component: ProjectScreen, native: true, nestedIn: ['Tabs', 'ProjectTab'] },
      PreviewOverlay: { path: '/preview/:previewId', overlay: true, component: PreviewOverlayScreen, native: true },
    });

    const ProjectTab = () => <NativeRouterView navigator={ProjectStack} scope={['Tabs', 'ProjectTab']} />;
    const Tabs = () => (
      <Tab.Navigator>
        <Tab.Screen name="ProjectTab" component={ProjectTab} />
      </Tab.Navigator>
    );

    render(
      <NativeRouterProvider routes={routes} initialUrl="/projects/9/preview/77">
        <NativeRouterView navigator={RootStack} initialRouteName="Tabs">
          <RootStack.Screen name="Tabs" component={Tabs} />
        </NativeRouterView>
      </NativeRouterProvider>,
    );

    expect(screen.getByTestId('tab-overlay')).toHaveTextContent('/projects/9/preview/77');
    act(() => activeRouter!.goBack());
    expect(screen.queryByTestId('tab-overlay')).toBeNull();
    expect(screen.getByTestId('tab-project')).toHaveTextContent('project:9');
  });
});

describe('Item 3: Routes that depend on runtime state', () => {
  it('skips disabled routes at match time and falls through to later matching routes', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const routes = defineRoutes({
      BetaFeature: {
        path: '/feature/:id',
        enabled: (ctx: { beta?: boolean } | undefined) => Boolean(ctx?.beta),
        native: true,
      },
      FallbackFeature: {
        path: '/feature/legacy',
        native: true,
      },
    });
    // Dynamic route does not falsely warn that a later static route is permanently unreachable
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();

    expect(routes.matchUrl('/feature/42', { beta: false })).toBeNull();
    expect(routes.matchUrl('/feature/legacy', { beta: false })?.name).toBe('FallbackFeature');
    expect(routes.matchUrl('/feature/42', { beta: true })?.name).toBe('BetaFeature');
    expect(routes.resolveTarget('BetaFeature', { id: '42' }, undefined, { beta: false }).name).toBeNull();
    expect(routes.resolveTarget('BetaFeature', { id: '42' }, undefined, { beta: true }).name).toBe('BetaFeature');
  });

  describe.each<ParityDriverName>(ALL_DRIVERS)('runtime-conditional parity (%s)', (driver) => {
    it('evaluates enabled(routeContext) on navigation and when flipping a currently active route off', () => {
      const openWeb = vi.fn();
      let activeRouter: RouterController | null = null;

      function HomeScreen() {
        activeRouter = useRouter();
        return <div data-testid="screen-home">home</div>;
      }
      function BetaScreen() {
        activeRouter = useRouter();
        return <div data-testid="screen-beta">beta</div>;
      }
      function FallbackScreen() {
        return <div data-testid="screen-fallback">fallback</div>;
      }

      const routes = defineRoutes({
        Home: { path: '/', component: HomeScreen, native: true },
        Beta: {
          path: '/beta',
          component: BetaScreen,
          native: true,
          enabled: (ctx: { hasBeta?: boolean } | undefined) => Boolean(ctx?.hasBeta),
        },
      });

      const { rerenderWith } = renderWithDriver(driver, routes, {
        initialUrl: '/',
        routeContext: { hasBeta: false },
        openWeb,
        fallback: FallbackScreen,
      });

      // Disabled: navigating to /beta does not enter BetaScreen
      act(() => activeRouter!.navigate('/beta'));
      if (driver.startsWith('native')) {
        expect(openWeb).toHaveBeenCalledWith('/beta');
        expect(screen.queryByTestId('screen-beta')).toBeNull();
      } else {
        expect(screen.getByTestId('screen-fallback')).toBeTruthy();
        expect(screen.queryByTestId('screen-beta')).toBeNull();
      }

      // Enable via routeContext -> now /beta matches and renders BetaScreen
      rerenderWith(routes, { routeContext: { hasBeta: true } });
      if (driver.startsWith('native')) {
        act(() => activeRouter!.navigate('/beta'));
      }
      expect(screen.getByTestId('screen-beta')).toBeTruthy();

      // Disable while mounted -> falls back cleanly without crashing
      rerenderWith(routes, { routeContext: { hasBeta: false } });
      expect(screen.queryByTestId('screen-beta')).toBeNull();
      expect(screen.getByTestId('screen-fallback')).toBeTruthy();
    });

    it('accepts a changing RouteRegistry prop safely without losing history state', () => {
      let activeRouter: RouterController | null = null;
      function HomeScreen() {
        activeRouter = useRouter();
        return <div data-testid="screen-home">home</div>;
      }
      function ReportsScreen() {
        activeRouter = useRouter();
        return <div data-testid="screen-reports">reports</div>;
      }

      const v1 = defineRoutes({
        Home: { path: '/', component: HomeScreen, native: true },
      });
      const v2 = defineRoutes({
        Home: { path: '/', component: HomeScreen, native: true },
        Reports: { path: '/reports', component: ReportsScreen, native: true },
      });

      const { rerenderWith } = renderWithDriver(driver, v1, { initialUrl: '/' });
      expect(screen.getByTestId('screen-home')).toBeTruthy();

      rerenderWith(v2);
      act(() => activeRouter!.navigate('Reports'));
      expect(screen.getByTestId('screen-reports')).toBeTruthy();
      expect(activeRouter!.canGoBack()).toBe(true);
    });
  });
});

describe('Item 4: Entry guards', () => {
  it('detects redirect cycles and self-redirects cleanly', () => {
    const selfLoop = defineRoutes({
      A: { path: '/a', guard: () => 'A', native: true },
    });
    expect(() =>
      renderWithDriver('web-memory', selfLoop, { initialUrl: '/a' }),
    ).toThrow(/redirected to itself/);

    const cycle = defineRoutes({
      A: { path: '/a', guard: () => 'B', native: true },
      B: { path: '/b', guard: () => 'A', native: true },
    });
    expect(() =>
      renderWithDriver('web-memory', cycle, { initialUrl: '/a' }),
    ).toThrow(/exceeded 10 hops/);
  });

  describe.each<ParityDriverName>(ALL_DRIVERS)('entry guard parity (%s)', (driver) => {
    it('supports redirect and alternative ReactElement across navigate, initialUrl, reset, and back after logout', async () => {
      let secretMounts = 0;
      let activeRouter: RouterController | null = null;

      function HomeScreen() {
        activeRouter = useRouter();
        return <div data-testid="screen-home">home</div>;
      }
      function LoginScreen() {
        activeRouter = useRouter();
        const route = useRoute();
        return <div data-testid="screen-login">login:{route.path}</div>;
      }
      function SecretScreen() {
        activeRouter = useRouter();
        React.useEffect(() => {
          secretMounts += 1;
        }, []);
        return <div data-testid="screen-secret">secret</div>;
      }
      function SettingsScreen() {
        activeRouter = useRouter();
        return <div data-testid="screen-settings">settings</div>;
      }
      function PromptScreen() {
        activeRouter = useRouter();
        const route = useRoute();
        return <div data-testid="screen-prompt">prompt:{route.pathname}</div>;
      }

      const routes = defineRoutes({
        Home: { path: '/', component: HomeScreen, native: true },
        Login: { path: '/login', component: LoginScreen, native: true },
        Settings: { path: '/settings', component: SettingsScreen, native: true },
        Secret: {
          path: '/secret',
          component: SecretScreen,
          native: true,
          guard: (route, ctx: any) =>
            ctx?.authed ? true : { name: 'Login', query: { next: route.pathname } },
        },
        PromptGated: {
          path: '/gated',
          component: SecretScreen,
          native: true,
          guard: (_route, ctx: any) => (ctx?.authed ? true : <PromptScreen />),
        },
      });

      // 1. initialUrl redirect: SecretScreen never mounts
      const initial = renderWithDriver(driver, routes, {
        initialUrl: '/secret',
        routeContext: { authed: false },
      });
      await waitFor(() => expect(screen.getByTestId('screen-login')).toHaveTextContent('login:/login?next=%2Fsecret'));
      expect(secretMounts).toBe(0);
      initial.unmount();

      // 2. navigate & reset while logged out
      const app = renderWithDriver(driver, routes, {
        initialUrl: '/',
        routeContext: { authed: false },
      });

      // Redirect via navigate
      act(() => activeRouter!.navigate('Secret'));
      await waitFor(() => expect(screen.getByTestId('screen-login')).toBeTruthy());
      expect(secretMounts).toBe(0);

      // Alternative ReactElement via navigate (stays at /gated, swaps to SecretScreen on login)
      act(() => activeRouter!.navigate('PromptGated'));
      expect(screen.getByTestId('screen-prompt')).toHaveTextContent('prompt:/gated');
      expect(secretMounts).toBe(0);

      app.rerenderWith(routes, { routeContext: { authed: true } });
      expect(screen.queryByTestId('screen-prompt')).toBeNull();
      expect(screen.getByTestId('screen-secret')).toBeTruthy();
      expect(secretMounts).toBe(1);

      // Redirect via reset when logged out
      app.rerenderWith(routes, { routeContext: { authed: false } });
      expect(screen.getByTestId('screen-prompt')).toBeTruthy();
      act(() => activeRouter!.reset(['Home', 'Secret']));
      await waitFor(() => expect(screen.getByTestId('screen-login')).toBeTruthy());

      // 3. Back after logout: visit Secret -> Settings while authed -> log out -> goBack -> redirects to Login
      app.rerenderWith(routes, { routeContext: { authed: true } });
      act(() => activeRouter!.navigate('Secret'));
      expect(focusedText('screen-secret')).toBe('secret');
      act(() => activeRouter!.navigate('Settings'));
      expect(focusedText('screen-settings')).toBe('settings');

      app.rerenderWith(routes, { routeContext: { authed: false } });
      // Still on Settings (unfocused Secret in stack must not hijack navigation)
      expect(focusedText('screen-settings')).toBe('settings');

      act(() => activeRouter!.goBack());
      await waitFor(() => expect(focusedText('screen-login')).toBe('login:/login?next=%2Fsecret'));
    });

    it('runs leave guard on current screen before entry-guard redirect', () => {
      const confirm = vi.fn<GetUserConfirmation>((_m, cb) => cb(false));
      let activeRouter: RouterController | null = null;

      function DirtyHome() {
        activeRouter = useRouter();
        useNavigationGuard(true, 'Unsaved edits?');
        return <div data-testid="screen-home">home</div>;
      }
      function LoginScreen() {
        return <div data-testid="screen-login">login</div>;
      }
      function SecretScreen() {
        return <div data-testid="screen-secret">secret</div>;
      }

      const routes = defineRoutes({
        Home: { path: '/', component: DirtyHome, native: true },
        Login: { path: '/login', component: LoginScreen, native: true },
        Secret: { path: '/secret', component: SecretScreen, native: true, guard: () => 'Login' },
      });

      renderWithDriver(driver, routes, { initialUrl: '/', getUserConfirmation: confirm });
      act(() => activeRouter!.navigate('Secret'));
      expect(confirm).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId('screen-home')).toBeTruthy();
      expect(screen.queryByTestId('screen-login')).toBeNull();
    });
  });
});

describe('Item 5: Controlled (host-owned URL) mode on web', () => {
  it('never writes window.history, renders from location prop, emits intents without echoing, and round-trips state', () => {
    const pushSpy = vi.spyOn(window.history, 'pushState');
    const replaceSpy = vi.spyOn(window.history, 'replaceState');
    const backSpy = vi.spyOn(window.history, 'back');
    const intents: Array<{ path?: string; action: string; state?: unknown; delta?: number }> = [];
    let router: RouterController | null = null;

    function HomeScreen() {
      router = useRouter();
      const route = useRoute();
      return (
        <div data-testid="ctrl-home">
          home:{route.path}:{JSON.stringify(route.state ?? null)}:back={String(router.canGoBack())}
        </div>
      );
    }
    function ItemScreen() {
      router = useRouter();
      const route = useRoute();
      return (
        <div data-testid="ctrl-item">
          item:{route.path}:{JSON.stringify(route.state ?? null)}:back={String(router.canGoBack())}
        </div>
      );
    }

    const routes = defineRoutes({
      Home: { path: '/', component: HomeScreen },
      Item: { path: '/items/:id', component: ItemScreen },
    });

    const onNavigate = vi.fn((intent) => intents.push(intent));

    const { rerender } = render(
      <WebRouterProvider
        routes={routes}
        location="/"
        onNavigate={onNavigate}
        basename="/embed"
      >
        <WebRouterView />
      </WebRouterProvider>,
    );

    expect(screen.getByTestId('ctrl-home')).toHaveTextContent('home:/:null:back=false');

    // Navigate emits push intent with state, without mutating window.history or internal location
    act(() => router!.navigate('Item', { id: '42' }, { query: { tab: 'info' }, state: { from: 'list' } }));
    expect(intents).toEqual([
      { path: '/items/42?tab=info', action: 'push', state: { from: 'list' } },
    ]);
    // Still renders Home until host updates `location` prop
    expect(screen.getByTestId('ctrl-home')).toBeTruthy();

    // Host commits location + state -> MFE renders Item with round-tripped state and DOES NOT echo onNavigate
    rerender(
      <WebRouterProvider
        routes={routes}
        location={{ pathname: '/items/42', search: '?tab=info', state: { from: 'list' } }}
        onNavigate={onNavigate}
        basename="/embed"
      >
        <WebRouterView />
      </WebRouterProvider>,
    );
    expect(screen.getByTestId('ctrl-item')).toHaveTextContent(
      'item:/items/42?tab=info:{"from":"list"}:back=true',
    );
    expect(onNavigate).toHaveBeenCalledTimes(1); // zero echo!

    // Replace intent
    act(() => router!.replace('Item', { id: '99' }, { state: { replaced: true } }));
    expect(intents[1]).toEqual({ path: '/items/99', action: 'replace', state: { replaced: true } });

    // Back intent
    act(() => router!.goBack());
    expect(intents[2]).toEqual({ action: 'back' });

    // Host-driven location change back to Home -> no echo
    rerender(
      <WebRouterProvider
        routes={routes}
        location="/"
        locationState={{ hostTag: 1 }}
        onNavigate={onNavigate}
        canGoBack={true}
      >
        <WebRouterView />
      </WebRouterProvider>,
    );
    expect(screen.getByTestId('ctrl-home')).toHaveTextContent('home:/:{"hostTag":1}:back=true');
    expect(onNavigate).toHaveBeenCalledTimes(3); // no echo on host update!

    expect(pushSpy).not.toHaveBeenCalled();
    expect(replaceSpy).not.toHaveBeenCalled();
    expect(backSpy).not.toHaveBeenCalled();
    pushSpy.mockRestore();
    replaceSpy.mockRestore();
    backSpy.mockRestore();
  });

  it('enforces leave guards (including async proceed) and entry guards in controlled mode', () => {
    const intents: any[] = [];
    let router: RouterController | null = null;
    let pendingProceed: (() => void) | null = null;

    function GuardedHome() {
      router = useRouter();
      useNavigationGuard(true, (ctx) => {
        pendingProceed = ctx.proceed;
        return false;
      });
      return <div data-testid="ctrl-guarded">guarded</div>;
    }

    const routes = defineRoutes({
      Home: { path: '/', component: GuardedHome },
      Login: { path: '/login', component: () => <div data-testid="ctrl-login">login</div> },
      Secret: { path: '/secret', component: () => <div>secret</div>, guard: () => 'Login' },
    });

    const { rerender } = render(
      <WebRouterProvider
        routes={routes}
        location="/"
        canGoBack={true}
        onNavigate={(intent) => intents.push(intent)}
      >
        <WebRouterView />
      </WebRouterProvider>,
    );

    // Outgoing back blocked by leave guard -> no intent emitted until proceed()
    act(() => router!.goBack());
    expect(intents).toEqual([]);
    expect(pendingProceed).not.toBeNull();
    act(() => pendingProceed!());
    expect(intents).toEqual([{ action: 'back' }]);

    // Host pushes /secret -> entry guard emits a replace intent to /login
    rerender(
      <WebRouterProvider
        routes={routes}
        location="/secret"
        canGoBack={true}
        onNavigate={(intent) => intents.push(intent)}
      >
        <WebRouterView />
      </WebRouterProvider>,
    );
    expect(intents[intents.length - 1]).toEqual({ path: '/login', action: 'replace' });
  });
});

describe('Item 6: Targets outside the registry via onExternal', () => {
  describe.each<ParityDriverName>(ALL_DRIVERS)('onExternal parity (%s)', (driver) => {
    it('routes unregistered URLs to onExternal instead of fallback and runs leave guards first', () => {
      const onExternal = vi.fn();
      const answers = [false, true];
      const confirm = vi.fn<GetUserConfirmation>((_m, cb) => cb(answers.shift() ?? true));
      let router: RouterController | null = null;
      let setGuarded: (v: boolean) => void = () => {};

      function HomeScreen() {
        router = useRouter();
        const [guarded, setGuardedState] = React.useState(false);
        setGuarded = setGuardedState;
        useNavigationGuard(guarded, 'Leave app?');
        return <div data-testid="screen-home">home</div>;
      }

      const routes = defineRoutes({
        Home: { path: '/', component: HomeScreen, native: true },
      });

      renderWithDriver(driver, routes, {
        initialUrl: '/',
        onExternal,
        getUserConfirmation: confirm,
        fallback: () => <div data-testid="screen-404">404</div>,
      });

      // Unregistered URL invokes onExternal without rendering 404 fallback
      act(() => router!.navigate('/host-page?ref=nav'));
      expect(onExternal).toHaveBeenCalledWith('/host-page?ref=nav');
      expect(screen.queryByTestId('screen-404')).toBeNull();
      expect(screen.getByTestId('screen-home')).toBeTruthy();

      // With active leave guard: declined -> blocked; accepted -> invokes onExternal
      act(() => setGuarded(true));
      onExternal.mockClear();

      act(() => router!.navigate('/host-other'));
      expect(confirm).toHaveBeenCalledTimes(1);
      expect(onExternal).not.toHaveBeenCalled();

      act(() => router!.navigate('/host-other'));
      expect(onExternal).toHaveBeenCalledWith('/host-other');
      act(() => setGuarded(false));
    });
  });

  it('controlled web mode: unregistered outgoing target calls onExternal instead of onNavigate', () => {
    const onNavigate = vi.fn();
    const onExternal = vi.fn();
    let router: RouterController | null = null;

    function HomeScreen() {
      router = useRouter();
      return <div data-testid="ctrl-home">home</div>;
    }

    const routes = defineRoutes({
      Home: { path: '/', component: HomeScreen },
    });

    render(
      <WebRouterProvider
        routes={routes}
        location="/"
        onNavigate={onNavigate}
        onExternal={onExternal}
      >
        <WebRouterView />
      </WebRouterProvider>,
    );

    act(() => router!.navigate('/host-only/section'));
    expect(onExternal).toHaveBeenCalledWith('/host-only/section');
    expect(onNavigate).not.toHaveBeenCalled();

    act(() => router!.navigate('https://external.example.org/docs'));
    expect(onExternal).toHaveBeenCalledWith('https://external.example.org/docs');
    expect(onNavigate).not.toHaveBeenCalled();
  });
});

describe('Item 7: Back-at-root precedence (parent/fallback first, then onBackAtRoot)', () => {
  describe.each<ParityDriverName>(ALL_DRIVERS)('parent-first precedence (%s)', (driver) => {
    it('deep-linked child replaces to parent first, then root goBack invokes guarded onBackAtRoot', () => {
      const onBackAtRoot = vi.fn();
      const answers = [false, true];
      const confirm = vi.fn<GetUserConfirmation>((_m, cb) => cb(answers.shift() ?? true));
      let router: RouterController | null = null;
      let setRootGuarded: (v: boolean) => void = () => {};

      function ListScreen() {
        router = useRouter();
        const [guarded, setGuarded] = React.useState(false);
        setRootGuarded = setGuarded;
        useNavigationGuard(guarded, 'Close module?');
        return <div data-testid="screen-list">list</div>;
      }

      function DetailScreen() {
        router = useRouter();
        const { id } = useParams<{ id: string }>();
        return <div data-testid="screen-detail">detail:{id}</div>;
      }

      const routes = defineRoutes({
        List: { path: '/items', component: ListScreen, native: true },
        Detail: { path: '/items/:id', component: DetailScreen, native: true, parent: 'List' },
      });

      renderWithDriver(driver, routes, {
        initialUrl: '/items/42',
        onBackAtRoot,
        getUserConfirmation: confirm,
      });

      expect(focusedText('screen-detail')).toBe('detail:42');

      // First goBack at root of deep-linked child resolves parent -> List, does NOT call onBackAtRoot
      act(() => router!.goBack());
      expect(onBackAtRoot).not.toHaveBeenCalled();
      expect(focusedText('screen-list')).toBe('list');

      // Guard armed on root List: declined -> blocks onBackAtRoot; accepted -> calls onBackAtRoot
      act(() => setRootGuarded(true));
      act(() => router!.goBack());
      expect(confirm).toHaveBeenCalledTimes(1);
      expect(onBackAtRoot).not.toHaveBeenCalled();

      act(() => router!.goBack());
      expect(onBackAtRoot).toHaveBeenCalledTimes(1);
      expect(onBackAtRoot.mock.calls[0][0].route.pathname).toBe('/items');
      act(() => setRootGuarded(false));
    });
  });

  it('Android hardware back navigates deep-linked child to parent first, then calls onBackAtRoot at root', () => {
    const onBackAtRoot = vi.fn();

    function ListScreen() {
      return <div data-testid="hw-list">list</div>;
    }
    function DetailScreen() {
      return <div data-testid="hw-detail">detail</div>;
    }

    const routes = defineRoutes({
      List: { path: '/items', component: ListScreen, native: true },
      Detail: { path: '/items/:id', component: DetailScreen, native: true, parent: 'List' },
    });

    const Stack = createTestStackNavigator();
    render(
      <NativeRouterProvider routes={routes} initialUrl="/items/9" onBackAtRoot={onBackAtRoot}>
        <NativeRouterView navigator={Stack} />
      </NativeRouterProvider>,
    );

    expect(focusedText('hw-detail')).toBe('detail');
    act(() => {
      expect((BackHandler as any).pressBack()).toBe(true);
    });
    expect(onBackAtRoot).not.toHaveBeenCalled();
    expect(focusedText('hw-list')).toBe('list');

    act(() => {
      expect((BackHandler as any).pressBack()).toBe(true);
    });
    expect(onBackAtRoot).toHaveBeenCalledTimes(1);
  });
});

describe('Item 8: Lite navigation listener action', () => {
  describe.each<ParityDriverName>(ALL_DRIVERS)('useNavigationListener action (%s)', (driver) => {
    it('reports push, replace, setQuery replace, and goBack actions consistently', async () => {
      const api = driver.startsWith('web') ? LiteWeb : LiteNative;
      const events: Array<[string, LiteWeb.LiteNavigationAction]> = [];
      let liteRouter: LiteWeb.LiteRouter | null = null;

      function Listener() {
        api.useNavigationListener((loc, action) => {
          events.push([loc.path, action]);
        });
        return null;
      }

      function ListScreen() {
        liteRouter = api.useRouter();
        return <div data-testid="lite-list">{api.useLocation().path}</div>;
      }

      function DetailScreen() {
        liteRouter = api.useRouter();
        return <div data-testid="lite-detail">{api.useLocation().path}</div>;
      }

      if (driver === 'web-memory') {
        render(
          <MemoryRouter initialEntries={['/items']}>
            <Listener />
            <Switch>
              <Route path="/items/:id" component={DetailScreen} />
              <Route path="/items" exact component={ListScreen} />
            </Switch>
          </MemoryRouter>,
        );
      } else if (driver === 'web-browser') {
        window.history.replaceState(null, '', '/items');
        render(
          <BrowserRouter>
            <Listener />
            <Switch>
              <Route path="/items/:id" component={DetailScreen} />
              <Route path="/items" exact component={ListScreen} />
            </Switch>
          </BrowserRouter>,
        );
      } else {
        const Nav = driver === 'native-stack' ? createTestStackNavigator() : createTestTabNavigator();
        const linking = {
          prefixes: ['app://'],
          enabled: false,
          config: { screens: { List: 'items', Detail: 'items/:id' } },
        };
        const initialState = getStateFromPath('/items', linking.config);
        render(
          <NavigationContainer linking={linking as any} initialState={initialState as any}>
            <Listener />
            <Nav.Navigator {...(driver === 'native-tabs' ? { backBehavior: 'history' } : {})}>
              <Nav.Screen name="List" component={ListScreen} />
              <Nav.Screen name="Detail" component={DetailScreen} />
            </Nav.Navigator>
          </NavigationContainer>,
        );
      }

      // Initial mount does not emit an event
      expect(events).toEqual([]);

      act(() => liteRouter!.navigate('/items/1'));
      expect(events).toEqual([['/items/1', 'push']]);

      act(() => liteRouter!.setQuery({ sort: 'asc' }));
      expect(events).toEqual([
        ['/items/1', 'push'],
        ['/items/1?sort=asc', 'replace'],
      ]);

      act(() => liteRouter!.replace('/items/2'));
      expect(events).toEqual([
        ['/items/1', 'push'],
        ['/items/1?sort=asc', 'replace'],
        ['/items/2', 'replace'],
      ]);

      act(() => liteRouter!.goBack());
      await waitFor(() => {
        expect(events).toEqual([
          ['/items/1', 'push'],
          ['/items/1?sort=asc', 'replace'],
          ['/items/2', 'replace'],
          ['/items', 'goBack'],
        ]);
      });
    });
  });
});

describe('Item 9: Link parity with React Router v5 NavLink', () => {
  const CustomAnchor = React.forwardRef<HTMLAnchorElement, WebLinkComponentProps>(
    ({ href, navigate, onClick, children, ...rest }, ref) => (
      <a
        {...rest}
        ref={ref}
        href={href}
        data-custom-anchor="true"
        onClick={(e) => {
          onClick?.(e);
          if (!e.defaultPrevented) {
            e.preventDefault();
            navigate();
          }
        }}
      >
        {children}
      </a>
    ),
  );

  // Compile-time & runtime check: one shared design-system wrapper compiles unchanged against both WebLink and NativeLink.
  function createDesignSystemLink(PlatformLink: typeof WebLink | typeof NativeLink) {
    return function DesignSystemLink(
      props: Pick<
        CommonLinkProps,
        'to' | 'exact' | 'strict' | 'sensitive' | 'isActive' | 'activeClassName' | 'activeStyle' | 'testID' | 'children' | 'disabled'
      >,
    ) {
      const LinkComp = PlatformLink as React.ComponentType<CommonLinkProps>;
      return <LinkComp {...props} component={CustomAnchor} />;
    };
  }

  describe.each<ParityDriverName>(ALL_DRIVERS)('isActive & design-system wrapper (%s)', (driver) => {
    it('evaluates isActive(match, location) identically and renders through a shared wrapper', () => {
      const LinkComp = driver.startsWith('web') ? WebLink : NativeLink;
      const DesignSystemLink = createDesignSystemLink(LinkComp);
      const calls: Array<{ match: LinkMatch | null; location: LinkLocation }> = [];

      const activeByQuery: LinkIsActive = (match, location) => {
        calls.push({ match, location });
        return Boolean(match) && location.search.includes('tab=featured');
      };

      function Page() {
        const route = useRoute();
        return (
          <div data-testid="link-page">
            <span data-testid="current-path">{route.path}</span>
            <DesignSystemLink
              to="/items"
              exact
              activeClassName="is-active"
              activeStyle={{ fontWeight: 'bold' }}
              testID="link-exact"
            >
              Exact
            </DesignSystemLink>
            <DesignSystemLink
              to="/items"
              isActive={activeByQuery}
              activeClassName="is-featured"
              activeStyle={{ opacity: 0.5 }}
              testID="link-custom-active"
            >
              Featured
            </DesignSystemLink>
            <DesignSystemLink to="/items/99" testID="link-go-99">
              Go 99
            </DesignSystemLink>
          </div>
        );
      }

      const routes = defineRoutes({
        List: { path: '/items', component: Page, native: true },
        Detail: { path: '/items/:id', component: Page, native: true },
      });

      renderWithDriver(driver, routes, { initialUrl: '/items/42?tab=featured' });

      // /items exact should NOT be active on /items/42
      const exactEl = screen.getAllByTestId('link-exact').find(isVisible)!;
      const featuredEl = screen.getAllByTestId('link-custom-active').find(isVisible)!;

      expect(calls.length).toBeGreaterThan(0);
      const lastCall = calls[calls.length - 1];
      expect(lastCall.match).toEqual({ params: {}, isExact: false, path: '/items', url: '/items' });
      expect(lastCall.location.pathname).toBe('/items/42');
      expect(lastCall.location.search).toBe('?tab=featured');

      if (driver.startsWith('web')) {
        expect(exactEl.getAttribute('data-custom-anchor')).toBe('true');
        expect(exactEl.className).not.toContain('is-active');
        expect(exactEl.getAttribute('aria-current')).toBeNull();
        expect(featuredEl.className).toContain('is-featured');
        expect(featuredEl.getAttribute('aria-current')).toBe('page');
      } else {
        expect(exactEl.getAttribute('aria-selected')).not.toBe('true');
        expect(featuredEl.getAttribute('aria-selected')).toBe('true');
      }

      // Clicking the wrapper navigates to /items/99 (custom anchor calls navigate() on web, Pressable onPress on native)
      const go99El = screen.getAllByTestId('link-go-99').find(isVisible)!;
      fireEvent.click(go99El);
      expect(focusedText('current-path')).toBe('/items/99');
    });
  });

  it('web Link component receives href, navigate, onClick and respects disabled', () => {
    const onClick = vi.fn();
    let capturedHref: string | undefined;

    const SpyAnchor = React.forwardRef<HTMLAnchorElement, WebLinkComponentProps>(
      ({ href, navigate, onClick: clickProp, children, ...rest }, ref) => {
        capturedHref = href;
        return (
          <a
            {...rest}
            ref={ref}
            href={href}
            onClick={(e) => {
              clickProp?.(e);
              e.preventDefault();
              navigate();
            }}
          >
            {children}
          </a>
        );
      },
    );

    function Home() {
      return (
        <div>
          <WebLink to="/target" component={SpyAnchor} disabled onClick={onClick} testID="disabled-custom">
            Disabled
          </WebLink>
        </div>
      );
    }

    const routes = defineRoutes({
      Home: { path: '/', component: Home },
      Target: { path: '/target', component: () => <div data-testid="target">target</div> },
    });

    render(
      <WebRouterProvider routes={routes} routerType="memory" initialEntries={['/']}>
        <WebRouterView />
      </WebRouterProvider>,
    );

    expect(capturedHref).toBeUndefined();
    fireEvent.click(screen.getByTestId('disabled-custom'));
    expect(screen.queryByTestId('target')).toBeNull();
  });
});

describe('Item 10: Imperative access outside React & external navigation', () => {
  describe.each<ParityDriverName>(ALL_DRIVERS)('getRouter / routerRef / openExternal / reload (%s)', (driver) => {
    it('supports getLocation, subscribe, navigate, openExternal, reload, and guards outside React', async () => {
      const onExternal = vi.fn();
      const onReload = vi.fn();
      const answers = [false, true, false, true];
      const confirm = vi.fn<GetUserConfirmation>((_m, cb) => cb(answers.shift() ?? true));
      const routerRef = createRouterRef();
      let setGuarded: (v: boolean) => void = () => {};

      function ListScreen() {
        const [guarded, setG] = React.useState(false);
        setGuarded = setG;
        useNavigationGuard(guarded, 'Leave?');
        return <div data-testid="imp-list">list</div>;
      }

      function DetailScreen() {
        const { id } = useParams<{ id: string }>();
        return <div data-testid="imp-detail">detail:{id}</div>;
      }

      const routes = defineRoutes({
        List: { path: '/items', component: ListScreen, native: true },
        Detail: { path: '/items/:id', component: DetailScreen, native: true },
      });

      const { unmount } = renderWithDriver(driver, routes, {
        initialUrl: '/items?sort=asc',
        onExternal,
        onReload,
        routerRef,
        getUserConfirmation: confirm,
      });

      const handle = getRouter();
      expect(routerRef.current).toBe(handle);
      expect(handle.getLocation().pathname).toBe('/items');
      expect(handle.getLocation().search).toBe('?sort=asc');
      expect(handle.getLocation().query).toEqual({ sort: 'asc' });

      const events: Array<[string, string]> = [];
      const unsub = handle.subscribe((loc, action) => {
        events.push([loc.path, action]);
      });

      act(() => handle.navigate('/items/7'));
      expect(focusedText('imp-detail')).toBe('detail:7');
      expect(handle.getLocation().pathname).toBe('/items/7');
      expect(events).toEqual([['/items/7', 'PUSH']]);

      act(() => handle.goBack());
      await waitFor(() => {
        expect(handle.getLocation().pathname).toBe('/items');
      });
      unsub();

      // Guarded openExternal and reload
      act(() => setGuarded(true));

      act(() => handle.openExternal('https://docs.example.org/guide'));
      expect(confirm).toHaveBeenCalledTimes(1);
      expect(onExternal).not.toHaveBeenCalled();

      act(() => handle.openExternal('https://docs.example.org/guide'));
      expect(onExternal).toHaveBeenCalledWith('https://docs.example.org/guide');

      act(() => handle.reload());
      expect(confirm).toHaveBeenCalledTimes(3);
      expect(onReload).not.toHaveBeenCalled();

      act(() => handle.reload());
      expect(onReload).toHaveBeenCalledTimes(1);

      act(() => setGuarded(false));
      unmount();

      expect(routerRef.current).toBeNull();
      expect(() => getRouter()).toThrow(/No active RouterProvider/);
    });
  });

  it('native reload() warns and no-ops when onReload is not provided', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const routes = defineRoutes({
      Home: { path: '/', component: () => <div data-testid="home">home</div>, native: true },
    });
    const Stack = createTestStackNavigator();
    const { unmount } = render(
      <NativeRouterProvider routes={routes} initialUrl="/">
        <NativeRouterView navigator={Stack} />
      </NativeRouterProvider>,
    );

    act(() => getRouter().reload());
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('reload()'));
    warn.mockRestore();
    unmount();
  });
});

describe('Item 11: No dependency on React Router internals (__RouterContext)', () => {
  it('src/ contains zero imports or references to __RouterContext', () => {
    const sources = (import.meta as any).glob('../src/**/*.{ts,tsx}', {
      query: '?raw',
      import: 'default',
      eager: true,
    }) as Record<string, string>;
    const entries = Object.entries(sources);
    expect(entries.length).toBeGreaterThan(0);
    for (const [file, content] of entries) {
      expect(content, `unexpected __RouterContext in ${file}`).not.toContain('__RouterContext');
    }
  });

  it('reuses ancestor MemoryRouter, BrowserRouter, and StaticRouter without __RouterContext', () => {
    const routes = defineRoutes({
      Item: {
        path: '/items/:id',
        component: () => {
          const { id } = useParams<{ id: string }>();
          return <span data-testid="reused-item">item:{id}</span>;
        },
      },
    });

    // Ancestor MemoryRouter
    const mem = render(
      <MemoryRouter initialEntries={['/items/11']}>
        <WebRouterProvider routes={routes}>
          <WebRouterView />
        </WebRouterProvider>
      </MemoryRouter>,
    );
    expect(screen.getByTestId('reused-item').textContent).toBe('item:11');
    mem.unmount();

    // Ancestor BrowserRouter
    window.history.replaceState(null, '', '/items/22');
    const br = render(
      <BrowserRouter>
        <WebRouterProvider routes={routes}>
          <WebRouterView />
        </WebRouterProvider>
      </BrowserRouter>,
    );
    expect(screen.getByTestId('reused-item').textContent).toBe('item:22');
    br.unmount();

    // Ancestor StaticRouter (SSR)
    const html = renderToStaticMarkup(
      <StaticRouter location="/items/33" context={{}}>
        <WebRouterProvider routes={routes}>
          <WebRouterView />
        </WebRouterProvider>
      </StaticRouter>,
    );
    expect(html).toContain('item:33');
  });
});

describe('Item 13: Hash round-trip on native (parity, custom linking, initialState, and /lite)', () => {
  describe.each<ParityDriverName>(ALL_DRIVERS)('hash parity (%s)', (driver) => {
    it('preserves hash across initialUrl, navigate, and replace identically to web', () => {
      let router: RouterController | null = null;

      function ItemScreen() {
        router = useRouter();
        const route = useRoute();
        return (
          <div data-testid="hash-screen">
            <span data-testid="hash-val">{route.hash}</span>
            <span data-testid="hash-query">{JSON.stringify(route.query)}</span>
            <span data-testid="hash-path">{route.path}</span>
          </div>
        );
      }

      const routes = defineRoutes({
        Item: { path: '/items/:id', component: ItemScreen, native: true },
      });

      renderWithDriver(driver, routes, { initialUrl: '/items/5?sort=asc#summary' });

      expect(focusedText('hash-val')).toBe('summary');
      expect(focusedText('hash-query')).toBe('{"sort":"asc"}');
      expect(focusedText('hash-path')).toBe('/items/5?sort=asc#summary');

      act(() => router!.navigate('/items/8#details'));
      expect(focusedText('hash-val')).toBe('details');
      expect(focusedText('hash-query')).toBe('{}');
      expect(focusedText('hash-path')).toBe('/items/8#details');

      act(() => router!.replace('/items/8?sort=desc#comments'));
      expect(focusedText('hash-val')).toBe('comments');
      expect(focusedText('hash-query')).toBe('{"sort":"desc"}');
      expect(focusedText('hash-path')).toBe('/items/8?sort=desc#comments');
    });
  });

  it('withHashLinking round-trips hashes through a custom React Navigation linking config without leaking metadata', () => {
    const customLinking = withHashLinking({
      prefixes: ['app://'],
      config: {
        screens: {
          Item: 'items/:id',
        },
      },
    });

    const stateWithQuery = customLinking.getStateFromPath!('/items/42?sort=asc#summary', customLinking.config);
    expect(customLinking.getPathFromState!(stateWithQuery as any, customLinking.config)).toBe(
      '/items/42?sort=asc#summary',
    );
    const leafQuery = (stateWithQuery as any).routes[0];
    expect(leafQuery.params.id).toBe('42');
    expect(leafQuery.params.sort).toBe('asc');

    const statePathOnly = customLinking.getStateFromPath!('/items/99#section', customLinking.config);
    expect(customLinking.getPathFromState!(statePathOnly as any, customLinking.config)).toBe(
      '/items/99#section',
    );
    const leafPath = (statePathOnly as any).routes[0];
    expect(leafPath.params.id).toBe('99');
  });

  it('unpacks hash cleanly from stock getStateFromPath initialState (both query+hash and path+hash)', () => {
    function ItemScreen() {
      const route = useRoute();
      const { id } = useParams<{ id: string }>();
      return (
        <div>
          <span data-testid="stock-id">{id}</span>
          <span data-testid="stock-query">{JSON.stringify(route.query)}</span>
          <span data-testid="stock-hash">{route.hash}</span>
          <span data-testid="stock-path">{route.path}</span>
        </div>
      );
    }

    const routes = defineRoutes({
      Item: { path: '/items/:id', component: ItemScreen, native: true },
    });

    const config = routes.toLinkingConfig(['app://']).config;

    // Query + hash from stock React Navigation getStateFromPath
    const Stack1 = createTestStackNavigator();
    const state1 = getStateFromPath('/items/5?tab=open#overview', config as any);
    const r1 = render(
      <NativeRouterProvider routes={routes} initialState={state1 as any}>
        <NativeRouterView navigator={Stack1} />
      </NativeRouterProvider>,
    );
    expect(focusedText('stock-id')).toBe('5');
    expect(focusedText('stock-query')).toBe('{"tab":"open"}');
    expect(focusedText('stock-hash')).toBe('overview');
    expect(focusedText('stock-path')).toBe('/items/5?tab=open#overview');
    r1.unmount();

    // Path param + hash (no query) from stock React Navigation getStateFromPath
    const Stack2 = createTestStackNavigator();
    const state2 = getStateFromPath('/items/7#details', config as any);
    const r2 = render(
      <NativeRouterProvider routes={routes} initialState={state2 as any}>
        <NativeRouterView navigator={Stack2} />
      </NativeRouterProvider>,
    );
    expect(focusedText('stock-id')).toBe('7');
    expect(focusedText('stock-query')).toBe('{}');
    expect(focusedText('stock-hash')).toBe('details');
    expect(focusedText('stock-path')).toBe('/items/7#details');
    r2.unmount();
  });

  it('/lite native round-trips #hash through navigate, replace, useLocation, useParams, and useQuery', () => {
    let liteRouter: LiteNative.LiteRouter | null = null;

    function ItemScreen() {
      liteRouter = LiteNative.useRouter();
      const loc = LiteNative.useLocation();
      const params = LiteNative.useParams<{ id: string }>();
      return (
        <div>
          <span data-testid="lite-hash-id">{params.id}</span>
          <span data-testid="lite-hash-val">{loc.hash}</span>
          <span data-testid="lite-hash-query">{JSON.stringify(loc.query)}</span>
          <span data-testid="lite-hash-path">{loc.path}</span>
        </div>
      );
    }

    const Stack = createTestStackNavigator();
    const linking = {
      prefixes: ['app://'],
      enabled: false,
      config: { screens: { Item: 'items/:id' } },
    };
    const initialState = getStateFromPath('/items/12', linking.config);

    render(
      <NavigationContainer linking={linking as any} initialState={initialState as any}>
        <Stack.Navigator>
          <Stack.Screen name="Item" component={ItemScreen} />
        </Stack.Navigator>
      </NavigationContainer>,
    );

    act(() => liteRouter!.navigate('/items/12?sort=asc#summary'));
    expect(focusedText('lite-hash-id')).toBe('12');
    expect(focusedText('lite-hash-val')).toBe('#summary');
    expect(focusedText('lite-hash-query')).toBe('{"sort":"asc"}');
    expect(focusedText('lite-hash-path')).toBe('/items/12?sort=asc#summary');

    act(() => liteRouter!.replace('#comments'));
    expect(focusedText('lite-hash-val')).toBe('#comments');
    expect(focusedText('lite-hash-path')).toBe('/items/12?sort=asc#comments');
  });
});











