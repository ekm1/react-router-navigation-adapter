import React, { useCallback, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import {
  Redirect,
  defineRoutes,
  useFocusEffect,
  useIsFocused,
  useNavigationGuard,
  useParams,
  useQuery,
  useRoute,
  useRouter,
} from '../src/index.web';
import { WebRouterProvider } from '../src/adapters/web';
import { NativeRouterProvider } from '../src/adapters/native';
import { Link as WebLink } from '../src/components/Link.web';
import { Link as NativeLink } from '../src/components/Link.native';
import { RouterView as WebRouterView } from '../src/components/RouterView.web';
import { RouterView as NativeRouterView } from '../src/components/RouterView.native';
import { createTestStackNavigator } from './helpers/createTestStackNavigator';
import type { CommonLinkProps, NavigationGuardContext, PlatformKind } from '../src/types';

type PlatformDriver = {
  platform: PlatformKind;
  LinkComponent: React.ComponentType<CommonLinkProps<any>>;
  renderApp: (
    routes: ReturnType<typeof createSharedApp>['routes'],
    options?: {
      initialUrl?: string;
      initialRouteName?: string;
      fallback?: React.ComponentType<any>;
      onUnmatchedUrl?: (url: string) => void;
    },
  ) => ReturnType<typeof render>;
};

function createSharedApp(
  LinkComponent: React.ComponentType<CommonLinkProps<any>>,
  hooks: {
    onFocusHome?: () => void;
    onBlurHome?: () => void;
    onGuardIntercept?: (ctx: NavigationGuardContext) => boolean | string | void;
  } = {},
) {
  function HomeScreen() {
    const router = useRouter();
    const route = useRoute();
    const isFocused = useIsFocused();

    useFocusEffect(
      useCallback(() => {
        hooks.onFocusHome?.();
        return () => {
          hooks.onBlurHome?.();
        };
      }, []),
    );

    return (
      <div data-testid="home-screen">
        <span data-testid="platform">{router.platform}</span>
        <span data-testid="home-route-name">{route.name}</span>
        <span data-testid="home-path">{route.path}</span>
        <span data-testid="home-can-go-back">{String(router.canGoBack())}</span>
        <span data-testid="home-focused">{String(isFocused)}</span>

        <button
          data-testid="btn-nav-user-by-name"
          onClick={() =>
            router.navigate(
              'UserProfile',
              { id: 42 },
              { query: { tab: 'posts' }, hash: 'bio', state: { from: 'home' } },
            )
          }
        >
          Go User 42
        </button>

        <button
          data-testid="btn-nav-user-by-url"
          onClick={() => router.navigate('/users/99?tab=likes#top')}
        >
          Go User 99 URL
        </button>

        <button
          data-testid="btn-nav-user-by-obj"
          onClick={() =>
            router.navigate({
              name: 'UserProfile',
              params: { id: 7 },
              query: { tab: 'about' },
              hash: 'details',
              state: { source: 'object' },
            })
          }
        >
          Go User 7 Obj
        </button>

        <button
          data-testid="btn-go-redirect"
          onClick={() => router.navigate('LegacyProfile')}
        >
          Go Legacy
        </button>

        <button
          data-testid="btn-go-editor"
          onClick={() => router.navigate('Editor')}
        >
          Go Editor
        </button>

        <LinkComponent
          to="Settings"
          params={{ section: 'billing' }}
          query={{ plan: 'pro' }}
          testID="link-settings"
        >
          Settings Link
        </LinkComponent>

        <LinkComponent
          to="Settings"
          params={{ section: 'security' }}
          replace
          testID="link-settings-replace"
        >
          Replace Settings
        </LinkComponent>

        <LinkComponent to="Settings" disabled testID="link-disabled">
          Disabled Link
        </LinkComponent>
      </div>
    );
  }

  function UserProfileScreen() {
    const router = useRouter();
    const route = useRoute();
    const params = useParams<{ id: number }>();
    const query = useQuery<{ tab?: string; page?: string }>();

    return (
      <div data-testid="user-screen">
        <span data-testid="user-route-name">{route.name}</span>
        <span data-testid="user-pathname">{route.pathname}</span>
        <span data-testid="user-path">{route.path}</span>
        <span data-testid="user-id">{String(params.id)}</span>
        <span data-testid="user-id-type">{typeof params.id}</span>
        <span data-testid="user-tab">{String(query.tab ?? '')}</span>
        <span data-testid="user-page">{String(query.page ?? '')}</span>
        <span data-testid="user-hash">{route.hash}</span>
        <span data-testid="user-state">{JSON.stringify(route.state ?? null)}</span>
        <span data-testid="user-can-go-back">{String(router.canGoBack())}</span>

        <button
          data-testid="btn-push-user-100"
          onClick={() => router.push('UserProfile', { id: 100 })}
        >
          Push 100
        </button>
        <button
          data-testid="btn-replace-settings"
          onClick={() => router.replace('Settings', { section: 'account' })}
        >
          Replace Settings
        </button>
        <button
          data-testid="btn-set-params"
          onClick={() => router.setParams({ id: 55 })}
        >
          Set Param 55
        </button>
        <button
          data-testid="btn-set-query-merge"
          onClick={() => router.setQuery({ page: 2 })}
        >
          Merge Query
        </button>
        <button
          data-testid="btn-set-query-delete"
          onClick={() => router.setQuery({ tab: null })}
        >
          Delete Tab
        </button>
        <button
          data-testid="btn-set-query-replace"
          onClick={() => router.setQuery({ fresh: 'yes' }, { merge: false })}
        >
          Replace Query
        </button>
        <button data-testid="btn-back" onClick={() => router.goBack()}>
          Back
        </button>
        <button
          data-testid="btn-reset-settings"
          onClick={() =>
            router.reset([{ name: 'Settings', params: { section: 'done' } }])
          }
        >
          Reset to Settings
        </button>
      </div>
    );
  }

  function SettingsScreen() {
    const router = useRouter();
    const route = useRoute();
    const params = useParams<{ section?: string }>();
    const query = useQuery<{ plan?: string }>();

    return (
      <div data-testid="settings-screen">
        <span data-testid="settings-section">{String(params.section ?? '')}</span>
        <span data-testid="settings-plan">{String(query.plan ?? '')}</span>
        <span data-testid="settings-path">{route.path}</span>
        <span data-testid="settings-can-go-back">
          {String(router.canGoBack())}
        </span>
        <button data-testid="btn-settings-back" onClick={() => router.goBack()}>
          Back
        </button>
      </div>
    );
  }

  function LegacyProfileScreen() {
    return <Redirect to="UserProfile" params={{ id: 88 }} query={{ from: 'legacy' }} />;
  }

  function EditorScreen() {
    const router = useRouter();
    const [dirty, setDirty] = useState(true);
    const [pendingProceed, setPendingProceed] = useState<(() => void) | null>(
      null,
    );

    useNavigationGuard(dirty, (ctx) => {
      if (hooks.onGuardIntercept) {
        return hooks.onGuardIntercept(ctx);
      }
      setPendingProceed(() => ctx.proceed);
      return false;
    });

    return (
      <div data-testid="editor-screen">
        <span data-testid="editor-dirty">{String(dirty)}</span>
        <span data-testid="editor-has-pending">
          {String(pendingProceed !== null)}
        </span>
        <button data-testid="btn-editor-back" onClick={() => router.goBack()}>
          Leave Editor
        </button>
        <button
          data-testid="btn-editor-confirm-leave"
          onClick={() => {
            pendingProceed?.();
          }}
        >
          Confirm Leave
        </button>
        <button
          data-testid="btn-editor-clean"
          onClick={() => setDirty(false)}
        >
          Mark Clean
        </button>
      </div>
    );
  }

  const routes = defineRoutes({
    Home: { path: '/', component: HomeScreen, native: true },
    UserProfile: {
      path: '/users/:id',
      parse: { id: Number },
      stringify: { id: (v: number) => String(v) },
      component: UserProfileScreen,
      native: true,
    },
    Settings: { path: '/settings/:section?', component: SettingsScreen, native: true },
    LegacyProfile: { path: '/legacy', component: LegacyProfileScreen, native: true },
    Editor: { path: '/editor', component: EditorScreen, native: true },
  });

  return { routes };
}

const drivers: PlatformDriver[] = [
  {
    platform: 'web',
    LinkComponent: WebLink,
    renderApp: (routes, options) =>
      render(
        <WebRouterProvider
          routes={routes}
          routerType="memory"
          initialEntries={[options?.initialUrl ?? '/']}
        >
          <WebRouterView fallback={options?.fallback} />
        </WebRouterProvider>,
      ),
  },
  {
    platform: 'native',
    LinkComponent: NativeLink,
    renderApp: (routes, options) => {
      const Stack = createTestStackNavigator();
      return render(
        <NativeRouterProvider
          routes={routes}
          initialUrl={options?.initialUrl}
          openWeb={options?.onUnmatchedUrl}
        >
          <NativeRouterView
            navigator={Stack}
            initialRouteName={(options?.initialRouteName as any) ?? 'Home'}
          />
        </NativeRouterProvider>,
      );
    },
  },
];

describe.each(drivers)('Common interface parity ($platform)', (driver) => {
  it('renders initial route and exposes unified route & controller API', () => {
    const { routes } = createSharedApp(driver.LinkComponent);
    driver.renderApp(routes);

    expect(screen.getByTestId('platform')).toHaveTextContent(driver.platform);
    expect(screen.getByTestId('home-route-name')).toHaveTextContent('Home');
    expect(screen.getByTestId('home-path')).toHaveTextContent('/');
    expect(screen.getByTestId('home-can-go-back')).toHaveTextContent('false');
    expect(screen.getByTestId('home-focused')).toHaveTextContent('true');
  });

  it('navigates by route name with params, query, hash, and state', () => {
    const { routes } = createSharedApp(driver.LinkComponent);
    driver.renderApp(routes);

    fireEvent.click(screen.getByTestId('btn-nav-user-by-name'));

    expect(screen.getByTestId('user-route-name')).toHaveTextContent('UserProfile');
    expect(screen.getByTestId('user-pathname')).toHaveTextContent('/users/42');
    expect(screen.getByTestId('user-path')).toHaveTextContent(
      '/users/42?tab=posts#bio',
    );
    expect(screen.getByTestId('user-id')).toHaveTextContent('42');
    expect(screen.getByTestId('user-id-type')).toHaveTextContent('number');
    expect(screen.getByTestId('user-tab')).toHaveTextContent('posts');
    expect(screen.getByTestId('user-hash')).toHaveTextContent('bio');
    expect(screen.getByTestId('user-state')).toHaveTextContent('{"from":"home"}');
    expect(screen.getByTestId('user-can-go-back')).toHaveTextContent('true');
  });

  it('navigates by raw URL string and parses params/query/hash identically', () => {
    const { routes } = createSharedApp(driver.LinkComponent);
    driver.renderApp(routes);

    fireEvent.click(screen.getByTestId('btn-nav-user-by-url'));

    expect(screen.getByTestId('user-id')).toHaveTextContent('99');
    expect(screen.getByTestId('user-id-type')).toHaveTextContent('number');
    expect(screen.getByTestId('user-tab')).toHaveTextContent('likes');
    expect(screen.getByTestId('user-hash')).toHaveTextContent('top');
    expect(screen.getByTestId('user-path')).toHaveTextContent(
      '/users/99?tab=likes#top',
    );
  });

  it('navigates by target object', () => {
    const { routes } = createSharedApp(driver.LinkComponent);
    driver.renderApp(routes);

    fireEvent.click(screen.getByTestId('btn-nav-user-by-obj'));

    expect(screen.getByTestId('user-id')).toHaveTextContent('7');
    expect(screen.getByTestId('user-tab')).toHaveTextContent('about');
    expect(screen.getByTestId('user-hash')).toHaveTextContent('details');
    expect(screen.getByTestId('user-state')).toHaveTextContent(
      '{"source":"object"}',
    );
  });

  it('supports push, goBack, replace, and reset stack operations', () => {
    const { routes } = createSharedApp(driver.LinkComponent);
    driver.renderApp(routes);

    // Home -> User 42 -> Push User 100
    fireEvent.click(screen.getByTestId('btn-nav-user-by-name'));
    expect(screen.getByTestId('user-id')).toHaveTextContent('42');

    fireEvent.click(screen.getByTestId('btn-push-user-100'));
    const userIdEls = screen.getAllByTestId('user-id');
    expect(userIdEls[userIdEls.length - 1]).toHaveTextContent('100');

    // Back from 100 -> 42
    const backBtns = screen.getAllByTestId('btn-back');
    fireEvent.click(backBtns[backBtns.length - 1]);
    expect(screen.getByTestId('user-id')).toHaveTextContent('42');

    // Replace User 42 with Settings (stack is now [Home, Settings])
    fireEvent.click(screen.getByTestId('btn-replace-settings'));
    expect(screen.getByTestId('settings-section')).toHaveTextContent('account');
    expect(screen.getByTestId('settings-can-go-back')).toHaveTextContent('true');

    // Back from Settings -> Home (skipped replaced User 42!)
    fireEvent.click(screen.getByTestId('btn-settings-back'));
    expect(screen.getByTestId('home-route-name')).toHaveTextContent('Home');

    // Navigate to User 42 then reset stack to Settings only
    fireEvent.click(screen.getByTestId('btn-nav-user-by-name'));
    fireEvent.click(screen.getByTestId('btn-reset-settings'));
    expect(screen.getByTestId('settings-section')).toHaveTextContent('done');
    expect(screen.getByTestId('settings-can-go-back')).toHaveTextContent('false');
  });

  it('supports setParams and setQuery (merge, delete, replace)', () => {
    const { routes } = createSharedApp(driver.LinkComponent);
    driver.renderApp(routes);

    fireEvent.click(screen.getByTestId('btn-nav-user-by-name'));
    expect(screen.getByTestId('user-path')).toHaveTextContent(
      '/users/42?tab=posts#bio',
    );

    fireEvent.click(screen.getByTestId('btn-set-params'));
    expect(screen.getByTestId('user-id')).toHaveTextContent('55');
    expect(screen.getByTestId('user-pathname')).toHaveTextContent('/users/55');

    fireEvent.click(screen.getByTestId('btn-set-query-merge'));
    expect(screen.getByTestId('user-tab')).toHaveTextContent('posts');
    expect(screen.getByTestId('user-page')).toHaveTextContent('2');

    fireEvent.click(screen.getByTestId('btn-set-query-delete'));
    expect(screen.getByTestId('user-tab')).toHaveTextContent('');
    expect(screen.getByTestId('user-page')).toHaveTextContent('2');

    fireEvent.click(screen.getByTestId('btn-set-query-replace'));
    expect(screen.getByTestId('user-page')).toHaveTextContent('');
    expect(screen.getByTestId('user-path')).toHaveTextContent(
      '/users/55?fresh=yes#bio',
    );
  });

  it('supports <Link> navigation, replace, and disabled state', () => {
    const { routes } = createSharedApp(driver.LinkComponent);
    driver.renderApp(routes);

    // Disabled link should not navigate
    fireEvent.click(screen.getByTestId('link-disabled'));
    expect(screen.getByTestId('home-route-name')).toHaveTextContent('Home');

    // Normal link navigates with params + query
    fireEvent.click(screen.getByTestId('link-settings'));
    expect(screen.getByTestId('settings-section')).toHaveTextContent('billing');
    expect(screen.getByTestId('settings-plan')).toHaveTextContent('pro');
    expect(screen.getByTestId('settings-path')).toHaveTextContent(
      '/settings/billing?plan=pro',
    );
    expect(screen.getByTestId('settings-can-go-back')).toHaveTextContent('true');

    // Go back and test replace link
    fireEvent.click(screen.getByTestId('btn-settings-back'));
    fireEvent.click(screen.getByTestId('link-settings-replace'));
    expect(screen.getByTestId('settings-section')).toHaveTextContent('security');
    expect(screen.getByTestId('settings-can-go-back')).toHaveTextContent('false');
  });

  it('supports declarative <Redirect>', async () => {
    const { routes } = createSharedApp(driver.LinkComponent);
    driver.renderApp(routes);

    fireEvent.click(screen.getByTestId('btn-go-redirect'));

    await waitFor(() => {
      expect(screen.getByTestId('user-id')).toHaveTextContent('88');
    });
    expect(screen.getByTestId('user-path')).toHaveTextContent(
      '/users/88?from=legacy',
    );
  });

  it('runs useFocusEffect on focus and cleans up on blur/unmount', () => {
    const onFocusHome = vi.fn();
    const onBlurHome = vi.fn();
    const { routes } = createSharedApp(driver.LinkComponent, {
      onFocusHome,
      onBlurHome,
    });
    driver.renderApp(routes);

    expect(onFocusHome).toHaveBeenCalledTimes(1);
    expect(onBlurHome).toHaveBeenCalledTimes(0);

    fireEvent.click(screen.getByTestId('btn-nav-user-by-name'));
    expect(onBlurHome).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId('btn-back'));
    expect(onFocusHome).toHaveBeenCalledTimes(2);
  });

  it('supports useNavigationGuard blocking and async proceed()', () => {
    const { routes } = createSharedApp(driver.LinkComponent);
    driver.renderApp(routes);

    fireEvent.click(screen.getByTestId('btn-go-editor'));
    expect(screen.getByTestId('editor-dirty')).toHaveTextContent('true');

    // Attempt to leave while dirty -> blocked
    fireEvent.click(screen.getByTestId('btn-editor-back'));
    expect(screen.getByTestId('editor-screen')).toBeVisible();
    expect(screen.getByTestId('editor-has-pending')).toHaveTextContent('true');

    // Confirm leave -> proceeds back to Home
    fireEvent.click(screen.getByTestId('btn-editor-confirm-leave'));
    expect(screen.getByTestId('home-screen')).toBeVisible();
  });
});

describe('Platform-specific capabilities', () => {
  it('Web: renders semantic <a href>, respects modifier clicks, supports 404 fallback and useExistingRouter', () => {
    const { routes } = createSharedApp(WebLink);

    function NotFound() {
      const route = useRoute();
      return (
        <div data-testid="not-found">
          404:{route.pathname}:{String(route.name)}
        </div>
      );
    }

    const { unmount } = render(
      <MemoryRouter initialEntries={['/']}>
        <WebRouterProvider routes={routes}>
          <WebRouterView fallback={NotFound} />
        </WebRouterProvider>
      </MemoryRouter>,
    );

    const link = screen.getByTestId('link-settings') as HTMLAnchorElement;
    expect(link.tagName).toBe('A');
    expect(link.getAttribute('href')).toBe('/settings/billing?plan=pro');

    // Cmd/Ctrl-click should not trigger SPA navigation (let browser open new tab)
    fireEvent.click(link, { metaKey: true });
    expect(screen.getByTestId('home-screen')).toBeInTheDocument();

    unmount();

    // Test 404 fallback on unmatched URL
    render(
      <WebRouterProvider
        routes={routes}
        routerType="memory"
        initialEntries={['/does-not-exist']}
      >
        <WebRouterView fallback={NotFound} />
      </WebRouterProvider>,
    );

    expect(screen.getByTestId('not-found')).toHaveTextContent(
      '404:/does-not-exist:null',
    );
  });
});
