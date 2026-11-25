import { useEffect, useRef } from 'react';
import { useRouter } from '../hooks';
import type { RedirectProps } from '../types';

/**
 * Declarative redirect component that works identically on Web (React Router v5)
 * and Native (React Navigation). Replaces the current route by default (`push={false}`).
 */
export function Redirect<TName extends string = string>({
  to,
  params,
  query,
  hash,
  state,
  push = false,
}: RedirectProps<TName>): null {
  const router = useRouter<TName>();
  const targetUrl = router.buildUrl(to, params, { query, hash });
  const lastRedirectedRef = useRef<string | null>(null);

  useEffect(() => {
    const key = `${push ? 'push' : 'replace'}:${targetUrl}`;
    if (lastRedirectedRef.current === key) return;
    lastRedirectedRef.current = key;

    const options = { query, hash, state };
    if (push) {
      router.push(to, params, options);
    } else {
      router.replace(to, params, options);
    }
  }, [router, to, params, query, hash, state, push, targetUrl]);

  return null;
}
