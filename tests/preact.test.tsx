import React from 'react';
import { render as compatRender, unmountComponentAtNode } from 'react-dom';
import { act } from 'react-dom/test-utils';
import { fireEvent, screen } from '@testing-library/dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  Link,
  Prompt,
  Redirect,
  RouterProvider,
  RouterView,
  createRouterRef,
  defineRoutes,
  getRouter,
  useHistory,
  useIsFocused,
  useLocation,
  useNavigationGuard,
  useParams,
  useQuery,
  useRoute,
  useRouteMatch,
  useRouter,
  withRouter,
  type ControlledNavigateIntent,
  type GetUserConfirmation,
  type RouterController,
  type WebLinkComponentProps,
} from '../src/index.web';

const mountedContainers: HTMLElement[] = [];

function renderPreact(ui: React.ReactElement) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  mountedContainers.push(container);
  act(() => {
    compatRender(ui, container);
  });
  return {
    container,
    rerender: (nextUi: React.ReactElement) => {
      act(() => {
        compatRender(nextUi, container);
      });
    },
    unmount: () => {
      act(() => {
        unmountComponentAtNode(container);
      });
      container.remove();
    },
  };
}

afterEach(() => {
  while (mountedContainers.length > 0) {
    const container = mountedContainers.pop()!;
    act(() => {
      unmountComponentAtNode(container);
    });
    container.remove();
  }
});

describe('Item 12: Preact compatibility (preact/compat)', () => {
  it('runs against preact/compat rather than React', async () => {
    const preactCompat = await import('preact/compat');
    expect(React.useState).toBe(preactCompat.useState);
    expect(compatRender).toBe(preactCompat.render);
  });

  it('RouterProvider, RouterView, multiple paths, overlays, and imperative getRouter work under preact/compat', () => {
    let router: RouterController | null = null;
    const routerRef = createRouterRef();

    function ItemsScreen() {
      router = useRouter();
      const route = useRoute();
      const params = useParams<{ id?: string }>();
      const query = useQuery();
      const focused = useIsFocused();
      return (
        <div data-testid="items-screen">
          <span data-testid="items-id">{params.id ?? 'list'}</span>
          <span data-testid="items-sort">{String(query.sort ?? '')}</span>
          <span data-testid="items-focused">{String(focused)}</span>
          <span data-testid="items-path">{route.path}</span>
        </div>
      );
    }

    function PreviewOverlay() {
      const { previewId } = useParams<{ previewId: string }>();
      const focused = useIsFocused();
      return (
        <div data-testid="preview-overlay">
          preview:{previewId}:{String(focused)}
        </div>
      );
    }

    const routes = defineRoutes({
      Items: { path: ['/items', '/items/:id'], component: ItemsScreen },
      Preview: { path: '/preview/:previewId', component: PreviewOverlay, overlay: true },
    });

    const { unmount } = renderPreact(
      <RouterProvider routes={routes} routerType="memory" initialEntries={['/items?sort=asc']} routerRef={routerRef}>
        <RouterView />
      </RouterProvider>,
    );

    expect(screen.getByTestId('items-id').textContent).toBe('list');
    expect(screen.getByTestId('items-sort').textContent).toBe('asc');
    expect(screen.getByTestId('items-focused').textContent).toBe('true');
    expect(getRouter()).toBe(routerRef.current);

    act(() => router!.navigate('Items', { id: '42' }));
    expect(screen.getByTestId('items-id').textContent).toBe('42');

    act(() => getRouter().navigate('Preview', { previewId: 'p1' }));
    expect(screen.getByTestId('preview-overlay').textContent).toBe('preview:p1:true');
    expect(screen.getByTestId('items-focused').textContent).toBe('false');

    act(() => getRouter().goBack());
    expect(screen.queryByTestId('preview-overlay')).toBeNull();
    expect(screen.getByTestId('items-focused').textContent).toBe('true');
    unmount();
  });

  it('Link supports activeClassName, isActive, custom component, ref forwarding, and navigation', () => {
    const linkRef = React.createRef<HTMLAnchorElement>();

    const CustomAnchor = React.forwardRef<HTMLAnchorElement, WebLinkComponentProps>(
      ({ href, navigate, children, ...rest }, ref) => (
        <a
          {...rest}
          ref={ref}
          href={href}
          data-custom="yes"
          onClick={(e) => {
            e.preventDefault();
            navigate();
          }}
        >
          {children}
        </a>
      ),
    );

    function Home() {
      return (
        <div>
          <Link
            ref={linkRef}
            to="/items"
            exact
            activeClassName="active-link"
            testID="home-link"
          >
            Items
          </Link>
          <Link
            to="/items"
            component={CustomAnchor}
            isActive={(_match, loc) => loc.search.includes('hl=1')}
            activeClassName="highlighted"
            testID="custom-link"
          >
            Custom
          </Link>
        </div>
      );
    }

    const routes = defineRoutes({
      Home: { path: '/', component: Home },
      Items: { path: '/items', component: () => <div data-testid="items-dest">items</div> },
    });

    const { unmount } = renderPreact(
      <RouterProvider routes={routes} routerType="memory" initialEntries={['/?hl=1']}>
        <RouterView />
      </RouterProvider>,
    );

    expect(linkRef.current).not.toBeNull();
    expect(screen.getByTestId('custom-link').getAttribute('data-custom')).toBe('yes');
    expect(screen.getByTestId('custom-link').className).toContain('highlighted');

    act(() => {
      fireEvent.click(screen.getByTestId('custom-link'));
    });
    expect(screen.getByTestId('items-dest').textContent).toBe('items');
    unmount();
  });

  it('leave guards, Prompt, and entry guards (redirect and element) work under preact/compat', () => {
    const answers = [false, true];
    const confirm = vi.fn<GetUserConfirmation>((_m, cb) => cb(answers.shift() ?? true));
    let router: RouterController | null = null;

    function Editor() {
      router = useRouter();
      useNavigationGuard(true, 'Unsaved edits');
      return (
        <div data-testid="editor">
          <Prompt when={true} message="Prompt check" />
          editor
        </div>
      );
    }

    const routes = defineRoutes({
      Editor: { path: '/editor', component: Editor },
      Admin: {
        path: '/admin',
        component: () => <div data-testid="admin">admin</div>,
        guard: (_route, ctx: any) => (ctx?.authed ? true : 'Login'),
      },
      Banner: {
        path: '/banner',
        component: () => <div data-testid="banner-real">real</div>,
        guard: () => <div data-testid="banner-gate">gate</div>,
      },
      Login: { path: '/login', component: () => <div data-testid="login">login</div> },
    });

    const { unmount } = renderPreact(
      <RouterProvider
        routes={routes}
        routeContext={{ authed: false }}
        routerType="memory"
        initialEntries={['/editor']}
        getUserConfirmation={confirm}
      >
        <RouterView />
      </RouterProvider>,
    );

    // Leave guard blocks first, then accepts and entry guard redirects /admin -> /login
    act(() => router!.navigate('/admin'));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('editor')).toBeTruthy();

    act(() => router!.navigate('/admin'));
    expect(screen.getByTestId('login')).toBeTruthy();

    // Entry guard returning an alternative element
    act(() => getRouter().navigate('/banner'));
    expect(screen.getByTestId('banner-gate')).toBeTruthy();
    expect(screen.queryByTestId('banner-real')).toBeNull();
    unmount();
  });

  it('compat hooks (useHistory, useLocation, useRouteMatch, withRouter, Redirect) and controlled mode work under preact/compat', () => {
    const intents: ControlledNavigateIntent[] = [];

    const LegacyWidget = withRouter(({ history, location, match }) => (
      <div data-testid="legacy-widget">
        {location.pathname}|{match.url}|{history.action}
      </div>
    ));

    function HooksScreen() {
      const history = useHistory();
      const loc = useLocation();
      const match = useRouteMatch('/projects/:id');
      return (
        <div data-testid="hooks-screen">
          <span data-testid="hooks-info">
            {loc.pathname}:{match?.params ? (match.params as any).id : 'none'}
          </span>
          <LegacyWidget />
          <button data-testid="go-legacy" onClick={() => history.push('/old')}>
            go old
          </button>
        </div>
      );
    }

    const routes = defineRoutes({
      Project: { path: '/projects/:id', component: HooksScreen },
      Old: { path: '/old', component: () => <Redirect to="/projects/99" /> },
    });

    const { rerender, unmount } = renderPreact(
      <RouterProvider
        routes={routes}
        location="/projects/7"
        onNavigate={(intent) => intents.push(intent)}
      >
        <RouterView />
      </RouterProvider>,
    );

    expect(screen.getByTestId('hooks-info').textContent).toBe('/projects/7:7');
    expect(screen.getByTestId('legacy-widget').textContent).toContain('/projects/7');

    act(() => {
      fireEvent.click(screen.getByTestId('go-legacy'));
    });
    expect(intents).toEqual([{ path: '/old', action: 'push' }]);

    // Host navigates to /old -> <Redirect> emits replace intent to /projects/99
    rerender(
      <RouterProvider
        routes={routes}
        location="/old"
        onNavigate={(intent) => intents.push(intent)}
      >
        <RouterView />
      </RouterProvider>,
    );
    expect(intents[intents.length - 1]).toEqual({ path: '/projects/99', action: 'replace' });
    unmount();
  });
});
