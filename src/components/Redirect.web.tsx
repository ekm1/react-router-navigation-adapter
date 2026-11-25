import { Redirect as RRRedirect } from 'react-router-dom';
import { useRouteRegistry } from '../hooks';
import { normalizeHash, stringifyQueryParams } from '../pathUtils';
import type { RedirectProps } from '../types';

/**
 * Web `<Redirect>`: React Router v5's own, so it works during server rendering
 * (`StaticRouter` records `context.url`) and redirects in the first commit on the client.
 */
export function Redirect<TName extends string = string>({ to, params, query, hash, state, push = false }: RedirectProps<TName>) {
  const resolved = useRouteRegistry<TName>().resolveTarget(to, params, { query, hash, state });
  return (
    <RRRedirect
      push={push}
      to={{
        pathname: resolved.pathname,
        search: stringifyQueryParams(resolved.query),
        hash: resolved.hash ? `#${normalizeHash(resolved.hash)}` : '',
        state: resolved.state,
      }}
    />
  );
}
