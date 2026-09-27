/**
 * Button.
 *
 * The state matrix the design system defines, expressed once so every button in
 * the portal behaves identically:
 *
 *   Property   Default      Hover         Active        Disabled
 *   bg         variant bg   variant hover variant active muted
 *   fg         variant fg   variant fg    variant fg    muted-fg
 *   shadow     variant      variant       none          none
 *   opacity    1            1             1             0.40
 *
 * `disabled` is set via the `disabled` attribute rather than a class, so the
 * browser blocks the click and the element leaves the tab order. That is
 * behaviour a class alone cannot guarantee.
 */

import Link from 'next/link';
import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import './Button.css';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'link';
export type ButtonSize = 'sm' | 'md' | 'lg';

type BaseProps = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
  children: ReactNode;
  className?: string;
};

type ButtonAsButton = BaseProps &
  Omit<ComponentPropsWithoutRef<'button'>, 'className' | 'children'> & { href?: undefined };

type ButtonAsLink = BaseProps &
  Omit<ComponentPropsWithoutRef<typeof Link>, 'className' | 'children'> & { href: string };

export type ButtonProps = ButtonAsButton | ButtonAsLink;

export function Button(props: ButtonProps) {
  const {
    variant = 'primary',
    size = 'md',
    fullWidth = false,
    leadingIcon,
    trailingIcon,
    children,
    className,
    ...rest
  } = props;

  const classes = [
    'btn',
    `btn-${variant}`,
    `btn-${size}`,
    fullWidth ? 'btn-full' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  const content = (
    <>
      {leadingIcon ? (
        <span className="btn-icon" aria-hidden="true">
          {leadingIcon}
        </span>
      ) : null}
      <span className="btn-label">{children}</span>
      {trailingIcon ? (
        <span className="btn-icon" aria-hidden="true">
          {trailingIcon}
        </span>
      ) : null}
    </>
  );

  if ('href' in rest && typeof rest.href === 'string') {
    const { href, ...linkRest } = rest as ButtonAsLink;
    return (
      <Link href={href} className={classes} {...linkRest}>
        {content}
      </Link>
    );
  }

  const { type = 'button', ...buttonRest } = rest as ButtonAsButton;
  return (
    <button type={type} className={classes} {...buttonRest}>
      {content}
    </button>
  );
}
