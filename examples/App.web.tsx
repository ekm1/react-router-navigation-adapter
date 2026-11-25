import { RouterProvider, RouterView } from '../src/index.web';
import { routes } from './routes';

/**
 * Web: inside the MFE's existing React Router v5 `<Router>`, the provider attaches to it.
 * Without one it mounts a `<BrowserRouter>`.
 */
export function WebApp() {
  return (
    <RouterProvider routes={routes}>
      <RouterView fallback={() => <div>404 Not Found</div>} />
    </RouterProvider>
  );
}
