import React, { forwardRef, useCallback } from 'react';
import { useHistory } from 'react-router-dom';
import { useIsActive, useRouteRegistry, useRouter } from '../hooks';
import { normalizeHash, stringifyQueryParams } from '../pathUtils';
import type { CommonLinkProps } from '../types';

/** Common link props plus any other `<a>` attributes (`id`, `title`, `aria-*`; `data-*` also pass through). */
export type WebLinkProps<TName extends string = string> = CommonLinkProps<TName> &
  Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, keyof CommonLinkProps | 'href'>;

function isModifiedEvent(event: React.MouseEvent<HTMLAnchorElement>): boolean {
  return Boolean(event.metaKey || event.altKey || event.ctrlKey || event.shiftKey);
}

function LinkImpl<TName extends string>(
  {
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
    ...rest
  }: WebLinkProps<TName>,
  ref: React.ForwardedRef<HTMLAnchorElement>,
) {
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
        if (replace) router.replace(to, params, options);
        else if (push) router.push(to, params, options);
        else router.navigate(to, params, options);
      }
    },
    [disabled, onClick, onPress, target, query, hash, state, replace, push, router, to, params],
  );

  return (
    <a
      {...rest}
      ref={ref}
      href={disabled ? undefined : href}
      className={[className, isActive && activeClassName].filter(Boolean).join(' ') || undefined}
      style={isActive && activeStyle ? { ...style, ...activeStyle } : style}
      aria-current={isActive ? 'page' : rest['aria-current']}
      data-testid={testID}
      aria-label={accessibilityLabel ?? rest['aria-label']}
      aria-disabled={disabled || undefined}
      target={target}
      rel={rel}
      onClick={handleClick}
    >
      {children}
    </a>
  );
}

/**
 * Web `<Link>` rendering a semantic `<a href>` backed by React Router v5. Preserves browser
 * behavior for modifier clicks (Cmd/Ctrl-click), right-click and `target="_blank"`.
 * Forwards its ref to the `<a>` and passes other anchor attributes through.
 */
export const Link = forwardRef(LinkImpl) as <TName extends string = string>(
  props: WebLinkProps<TName> & { ref?: React.Ref<HTMLAnchorElement> },
) => React.ReactElement | null;
