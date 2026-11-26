import React, { forwardRef, useCallback } from 'react';
import { useHistory } from 'react-router-dom';
import { useUniversalRouterContext } from '../context';
import { useRoute, useRouter } from '../hooks';
import { normalizeHash, stringifyQueryParams } from '../pathUtils';
import { resolveLinkActive, resolveTargetFromRoute, toLinkLocation } from '../shared';
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
    strict,
    sensitive,
    isActive: isActiveProp,
    component: CustomComponent,
    ...rest
  }: WebLinkProps<TName>,
  ref: React.ForwardedRef<any>,
) {
  const router = useRouter<TName>();
  const currentRoute = useRoute<TName>();
  const { registry, routeContext } = useUniversalRouterContext();
  const history = useHistory();
  const resolved = resolveTargetFromRoute(registry, currentRoute, to, params, { query, hash }, routeContext);
  // createHref applies the router's basename, so new-tab/copy-link URLs are correct.
  const href = history.createHref({
    pathname: resolved.pathname,
    search: stringifyQueryParams(resolved.query),
    hash: resolved.hash ? `#${normalizeHash(resolved.hash)}` : '',
  });
  const active = resolveLinkActive(resolved.pathname, toLinkLocation(currentRoute), {
    exact,
    strict,
    sensitive,
    isActive: isActiveProp,
  });

  const navigate = useCallback(() => {
    if (disabled) return;
    const options = { query, hash, state };
    if (replace) router.replace(to, params, options);
    else if (push) router.push(to, params, options);
    else router.navigate(to, params, options);
  }, [disabled, query, hash, state, replace, push, router, to, params]);

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
        navigate();
      }
    },
    [disabled, onClick, onPress, target, navigate],
  );

  const resolvedClassName = [className, active && activeClassName].filter(Boolean).join(' ') || undefined;
  const resolvedStyle = active && activeStyle ? { ...style, ...activeStyle } : style;

  if (CustomComponent) {
    return (
      <CustomComponent
        {...rest}
        ref={ref}
        href={disabled ? undefined : href}
        navigate={navigate}
        className={resolvedClassName}
        style={resolvedStyle}
        aria-current={active ? 'page' : rest['aria-current']}
        data-testid={testID}
        aria-label={accessibilityLabel ?? rest['aria-label']}
        aria-disabled={disabled || undefined}
        target={target}
        rel={rel}
        onClick={onClick}
      >
        {children}
      </CustomComponent>
    );
  }

  return (
    <a
      {...rest}
      ref={ref}
      href={disabled ? undefined : href}
      className={resolvedClassName}
      style={resolvedStyle}
      aria-current={active ? 'page' : rest['aria-current']}
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
 * Web `<Link>` rendering a semantic `<a href>` (or custom `component`) backed by React Router v5.
 * Preserves browser behavior for modifier clicks (Cmd/Ctrl-click), right-click and `target="_blank"`.
 * Supports React Router v5 `NavLink` active-state props (`activeClassName`, `activeStyle`, `exact`,
 * `strict`, `sensitive`, `isActive`) and forwards its ref and other anchor attributes through.
 */
export const Link = forwardRef(LinkImpl) as <TName extends string = string>(
  props: WebLinkProps<TName> & { ref?: React.Ref<any> },
) => React.ReactElement | null;
