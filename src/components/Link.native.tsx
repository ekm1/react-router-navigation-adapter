import React, { forwardRef, useCallback } from 'react';
import { Pressable, type PressableProps } from 'react-native';
import { useIsActive, useRouter } from '../hooks';
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
  // Web-only props, accepted so shared screens compile on both platforms.
  className: _className,
  activeClassName: _activeClassName,
  target: _target,
  rel: _rel,
  ...rest
}: NativeLinkProps<TName>, ref: React.ForwardedRef<any>) {
  const router = useRouter<TName>();
  const isActive = useIsActive(to, params, { exact });
  const resolvedStyle =
    isActive && activeStyle
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
        isActive ? { ...rest.accessibilityState, selected: true } : rest.accessibilityState
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
 * backed by React Navigation. Forwards its ref and other Pressable props.
 */
export const Link = forwardRef(LinkImpl) as <TName extends string = string>(
  props: NativeLinkProps<TName> & { ref?: React.Ref<any> },
) => React.ReactElement | null;
