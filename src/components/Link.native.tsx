import React, { forwardRef, useCallback } from 'react';
import { Pressable, type PressableProps } from 'react-native';
import { useUniversalRouterContext } from '../context';
import { useRoute, useRouter } from '../hooks';
import { resolveLinkActive, resolveTargetFromRoute, toLinkLocation } from '../shared';
import type { CommonLinkProps } from '../types';

/** Common link props plus any other `<Pressable>` props (`hitSlop`, `onLongPress`, ...). */
export type NativeLinkProps<TName extends string = string> = CommonLinkProps<TName> &
  Omit<PressableProps, keyof CommonLinkProps>;

function LinkImpl<TName extends string>({
  to,
  params,
  query,
  hash,
  state,
  replace = false,
  push = false,
  children,
  style,
  testID,
  accessibilityLabel,
  disabled,
  onPress,
  onClick,
  activeStyle,
  exact,
  strict,
  sensitive,
  isActive: isActiveProp,
  // Web-only props, accepted so shared screens and design-system wrappers compile on both platforms.
  className: _className,
  activeClassName: _activeClassName,
  target: _target,
  rel: _rel,
  component: _component,
  ...rest
}: NativeLinkProps<TName>, ref: React.ForwardedRef<any>) {
  const router = useRouter<TName>();
  const currentRoute = useRoute<TName>();
  const { registry, routeContext } = useUniversalRouterContext();
  const resolved = resolveTargetFromRoute(registry, currentRoute, to, params, { query, hash }, routeContext);
  const active = resolveLinkActive(resolved.pathname, toLinkLocation(currentRoute), {
    exact,
    strict,
    sensitive,
    isActive: isActiveProp,
  });
  const resolvedStyle =
    active && activeStyle
      ? typeof style === 'function'
        ? (pressable: { pressed: boolean }) => [style(pressable), activeStyle]
        : [style, activeStyle]
      : style;

  const handlePress = useCallback(
    (event: any) => {
      if (disabled) return;
      onPress?.(event);
      onClick?.(event);

      if (event?.defaultPrevented) return;

      const options = { query, hash, state };
      if (replace) {
        router.replace(to, params, options);
      } else if (push) {
        router.push(to, params, options);
      } else {
        router.navigate(to, params, options);
      }
    },
    [disabled, onPress, onClick, query, hash, state, replace, push, router, to, params],
  );

  return (
    <Pressable
      {...rest}
      ref={ref}
      accessibilityRole="link"
      accessibilityLabel={accessibilityLabel}
      testID={testID}
      style={resolvedStyle}
      accessibilityState={
        active ? { ...rest.accessibilityState, selected: true } : rest.accessibilityState
      }
      disabled={disabled}
      onPress={handlePress}
    >
      {children}
    </Pressable>
  );
}

/**
 * Native `<Link>` rendering a React Native `<Pressable>` with `accessibilityRole="link"`,
 * backed by React Navigation. Supports `NavLink` active-state props (`activeStyle`, `exact`,
 * `strict`, `sensitive`, `isActive`) and accepts web-only props (`component`, `activeClassName`)
 * so shared wrappers compile unchanged on both platforms.
 */
export const Link = forwardRef(LinkImpl) as <TName extends string = string>(
  props: NativeLinkProps<TName> & { ref?: React.Ref<any> },
) => React.ReactElement | null;
