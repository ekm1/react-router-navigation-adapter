import { Redirect as RRRedirect } from 'react-router-dom';
import { useRoute, useRouteRegistry } from '../hooks';
import { toLocationDescriptor } from '../pathUtils';
import { resolveTargetFromRoute } from '../shared';
import type { RedirectProps } from '../types';

/**
 * Web `<Redirect>`: React Router v5's own, so it works during server rendering
 * (`StaticRouter` records `context.url`) and redirects in the first commit on the client.
 */
export function Redirect<TName extends string = string>({ to, params, query, hash, state, push = false }: RedirectProps<TName>) {
  const currentRoute = useRoute<TName>();
  const resolved = resolveTargetFromRoute(useRouteRegistry<TName>(), currentRoute, to, params, { query, hash, state });
  return (
    <RRRedirect
      push={push}
      to={toLocationDescriptor(resolved)}
    />
  );
}
