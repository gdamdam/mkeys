/*
 * IconButton — a square, icon-only button. An aria-label is REQUIRED (the icon
 * is decorative). The armed/active state is the one place chrome earns the warm
 * --ember accent; everything else stays neutral.
 */
import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react'
import './ui.css'

export interface IconButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> {
  /** Accessible name — required since the button has no text. */
  label: string
  /** The icon element (see icons.tsx). */
  children: ReactNode
  /** Armed/active/selected — draws the ember accent + aria-pressed. */
  active?: boolean
  /** Visual weight. */
  variant?: 'ghost' | 'solid'
  size?: 'sm' | 'md' | 'lg'
  ref?: Ref<HTMLButtonElement>
}

export function IconButton({
  label,
  children,
  active = false,
  variant = 'ghost',
  size = 'md',
  className,
  type,
  ref,
  ...rest
}: IconButtonProps) {
  const cls = [
    'iconbtn',
    `iconbtn--${variant}`,
    `iconbtn--${size}`,
    active ? 'is-active' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ')
  return (
    <button
      ref={ref}
      // Default to a non-submitting button unless a caller opts into a type.
      type={type ?? 'button'}
      className={cls}
      aria-label={label}
      aria-pressed={active}
      title={label}
      {...rest}
    >
      {children}
    </button>
  )
}
