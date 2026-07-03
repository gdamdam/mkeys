/*
 * Toggle — an accessible on/off switch (role="switch"). Controlled. The "on"
 * track uses --ember (an armed state), the one accent chrome is allowed.
 */
import { useId } from 'react'
import './ui.css'

export interface ToggleProps {
  checked: boolean
  onChange: (next: boolean) => void
  /** Visible text label to the left of the switch. */
  label?: string
  /** Small hint under the label. */
  hint?: string
  disabled?: boolean
  /** Provide when there is no visible `label` (accessible name). */
  'aria-label'?: string
  id?: string
  className?: string
}

export function Toggle({
  checked,
  onChange,
  label,
  hint,
  disabled = false,
  'aria-label': ariaLabel,
  id,
  className,
}: ToggleProps) {
  const autoId = useId()
  const labelId = id ?? autoId
  const cls = ['toggle', disabled ? 'is-disabled' : '', className].filter(Boolean).join(' ')

  return (
    <div className={cls}>
      {label ? (
        <span className="toggle__text" id={`${labelId}-label`}>
          <span className="toggle__label">{label}</span>
          {hint ? <span className="toggle__hint">{hint}</span> : null}
        </span>
      ) : null}
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label ? undefined : ariaLabel}
        aria-labelledby={label ? `${labelId}-label` : undefined}
        disabled={disabled}
        className="toggle__switch"
        onClick={() => onChange(!checked)}
      >
        <span className="toggle__track">
          <span className="toggle__thumb" />
        </span>
      </button>
    </div>
  )
}
