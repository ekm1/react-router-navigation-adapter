import React, { useCallback } from 'react';
import { useRouter } from '../hooks';
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
}: CommonLinkProps<TName>) {
  const router = useRouter<TName>();
  const href = router.buildUrl(to, params, { query, hash });

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
      className={className}
      style={style}
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
