import React, { useCallback } from 'react';
import { useHistory } from 'react-router-dom';
import { useIsActive, useRouteRegistry, useRouter } from '../hooks';
import { normalizeHash, stringifyQueryParams } from '../pathUtils';
import type { CommonLinkProps } from '../types';

function isModifiedEvent(event: React.MouseEvent<HTMLAnchorElement>): boolean {
  return Boolean(event.metaKey || event.altKey || event.ctrlKey || event.shiftKey);
}

/**
 * Web `<Link>` component rendering a semantic `<a href>` backed by React Router v5.
 * Preserves native browser behavior for modifier clicks (Cmd/Ctrl-click), right-click,
 * and `target="_blank"`.
 */
export function Link<TName extends string = string>({
  to,
  params,
  query,
  hash,
  state,
  replace = false,
  push = false,
  children,
  className,
  style,
  testID,
  accessibilityLabel,
  disabled,
  onPress,
  onClick,
  target,
  rel,
  activeClassName,
  activeStyle,
  exact,
}: CommonLinkProps<TName>) {
  const router = useRouter<TName>();
  const history = useHistory();
  const resolved = useRouteRegistry<TName>().resolveTarget(to, params, { query, hash });
  // createHref applies the router's basename, so new-tab/copy-link URLs are correct.
  const href = history.createHref({
    pathname: resolved.pathname,
    search: stringifyQueryParams(resolved.query),
    hash: resolved.hash ? `#${normalizeHash(resolved.hash)}` : '',
  });
  const isActive = useIsActive(to, params, { exact });

  const handleClick = useCallback(
    (event: React.MouseEvent<HTMLAnchorElement>) => {
      if (disabled) {
        event.preventDefault();
        return;
      }

      onClick?.(event);
      onPress?.(event);

      if (
        !event.defaultPrevented &&
        event.button === 0 &&
        (!target || target === '_self') &&
        !isModifiedEvent(event)
      ) {
        event.preventDefault();
        const options = { query, hash, state };
        if (replace) {
          router.replace(to, params, options);
        } else if (push) {
          router.push(to, params, options);
        } else {
          router.navigate(to, params, options);
        }
      }
    },
    [
      disabled,
      onClick,
      onPress,
      target,
      query,
      hash,
      state,
      replace,
      push,
      router,
      to,
      params,
    ],
  );

  return (
    <a
      href={disabled ? undefined : href}
      className={[className, isActive && activeClassName].filter(Boolean).join(' ') || undefined}
      style={isActive && activeStyle ? { ...style, ...activeStyle } : style}
      aria-current={isActive ? 'page' : undefined}
      data-testid={testID}
      aria-label={accessibilityLabel}
      aria-disabled={disabled || undefined}
      target={target}
      rel={rel}
      onClick={handleClick}
    >
      {children}
    </a>
  );
}
