/**
 * THE CONTROL PRIMITIVES — the small pieces every panel is built from.
 *
 * Carried over from the approved design at :8899 with the same class names, so the ported CSS applies with
 * no new rules. Two decisions here are the design's, not incidental:
 *
 *  · **A LIST, never pills, for filters.** Alexander, 2026-09-08: *"I don't like to use pills as filters,
 *    they'll create a lot of issues after, because of space, it'd rather have a list of selectable items."*
 *    `FilterList` is that list, and it carries a count per row so the label has information scent.
 *  · **Every label names the EFFECT, not the field.** "Z-Width" became "How many cells it spans". So these
 *    take plain-language labels and an optional (i) rather than a field name.
 */
import { InfoButton } from './InfoButton'

/** A row: a label on the left (with an optional (i)) and a control on the right. */
export function ControlRow({
  label,
  helpId,
  children,
  unit,
}: {
  label?: string
  helpId?: string
  children: React.ReactNode
  unit?: string
}) {
  return (
    <div className="ctl">
      {(label || helpId) && (
        <span className="l">
          {label && <span>{label}</span>}
          {helpId && <InfoButton helpId={helpId} />}
        </span>
      )}
      {children}
      {unit && <span className="u">{unit}</span>}
    </div>
  )
}

/** A segmented choice — two to five mutually exclusive options, all visible at once. */
export function Segmented<T extends string>({
  label,
  helpId,
  options,
  value,
  onChange,
}: {
  label?: string
  helpId?: string
  options: readonly { value: T; label: string; title?: string }[]
  value: T
  onChange: (value: T) => void
}) {
  return (
    <ControlRow label={label} helpId={helpId}>
      <div className="seg" role="group" aria-label={label}>
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            className={option.value === value ? 'on' : ''}
            title={option.title}
            aria-pressed={option.value === value}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </ControlRow>
  )
}

/** A slider with its live value shown. */
export function Slider({
  label,
  helpId,
  min,
  max,
  step,
  value,
  unit = '',
  onChange,
}: {
  label: string
  helpId?: string
  min: number
  max: number
  step: number
  value: number
  unit?: string
  onChange: (value: number) => void
}) {
  return (
    <ControlRow label={label} helpId={helpId}>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <output>{`${value}${unit}`}</output>
    </ControlRow>
  )
}

/** A number field. */
export function NumberField({
  label,
  helpId,
  value,
  unit,
  min,
  max,
  onChange,
}: {
  label: string
  helpId?: string
  value: number
  unit?: string
  min?: number
  max?: number
  onChange: (value: number) => void
}) {
  return (
    <ControlRow label={label} helpId={helpId} unit={unit}>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        aria-label={label}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </ControlRow>
  )
}

/** A full-width action button, the `wideBtn()` of the design. */
export function WideButton({
  children,
  title,
  tone,
  disabled,
  onClick,
}: {
  children: React.ReactNode
  title?: string
  tone?: 'primary' | 'danger'
  disabled?: boolean
  onClick?: () => void
}) {
  const toneClass = tone === 'primary' ? ' pri' : tone === 'danger' ? ' dan' : ''
  return (
    <button type="button" className={`b wide sm${toneClass}`} title={title} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  )
}

export interface FilterRow {
  id: string
  label: string
  /** How many things this filter would show. The information scent that makes the label worth reading. */
  count?: number
}

/**
 * A selectable LIST of filters — explicitly not pills.
 *
 * The count on each row is why this beats a dropdown too: you can see there are 4 doors and 94 ground
 * tiles without opening anything.
 */
export function FilterList({
  ariaLabel,
  rows,
  value,
  onChange,
}: {
  ariaLabel: string
  rows: readonly FilterRow[]
  value: string
  onChange: (id: string) => void
}) {
  return (
    <div className="flist" role="group" aria-label={ariaLabel}>
      {rows.map((row) => (
        <button
          key={row.id}
          type="button"
          className={`frow${row.id === value ? ' on' : ''}`}
          aria-pressed={row.id === value}
          onClick={() => onChange(row.id)}
        >
          <span>{row.label}</span>
          {row.count !== undefined && <span className="ct">{row.count}</span>}
        </button>
      ))}
    </div>
  )
}

/** A quiet explanatory line under a control. */
export function Hint({ children }: { children: React.ReactNode }) {
  return <div className="hint">{children}</div>
}
