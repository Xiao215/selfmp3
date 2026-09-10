import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useIsMobile } from '../lib/hooks.js'
import { Check, ChevronDown } from './Icons.js'
import { Popover, type LayerAlign, type LayerPlacement } from './Menu.js'

/**
 * The app's dropdown.
 *
 * A native `<select>` renders its list with the operating system, which on a
 * Mac means a white sheet with a blue system highlight dropped on top of a
 * dark app — the one control in here that always looked broken. This is the
 * replacement: the trigger is an ordinary button, the list is ours, and the
 * whole thing follows the ARIA select-only combobox pattern so keyboard and
 * screen-reader behaviour matches what a native select does.
 *
 * It is generic over the option value, so call sites keep their union types:
 *
 *   <Select<SongSortField> value={sort} onChange={setSort} options={SORT_OPTIONS} />
 *
 * Options are either a flat list or groups. At phone width the list is
 * presented as a bottom sheet instead of a floating panel.
 */

export type SelectOption<T> = {
  value: T
  label: string
  /** Secondary text, right-aligned in the row — counts, shortcuts, units. */
  hint?: string
  disabled?: boolean
}

export type SelectOptionGroup<T> = {
  label: string
  options: readonly SelectOption<T>[]
}

export type SelectItems<T> = readonly SelectOption<T>[] | readonly SelectOptionGroup<T>[]

export type SelectProps<T> = {
  value: T
  onChange: (value: T) => void
  options: SelectItems<T>
  /** Accessible name. Use this or `labelledBy` — every dropdown needs one. */
  label?: string
  labelledBy?: string
  /** Shown in the trigger when nothing matches the current value. */
  placeholder?: string
  size?: 'default' | 'small' | 'inline'
  className?: string
  disabled?: boolean
  title?: string
  id?: string
  align?: LayerAlign
  placement?: LayerPlacement
}

function isGrouped<T>(items: SelectItems<T>): items is readonly SelectOptionGroup<T>[] {
  const first: SelectOption<T> | SelectOptionGroup<T> | undefined = items[0]
  return first !== undefined && 'options' in first
}

function toGroups<T>(items: SelectItems<T>): readonly SelectOptionGroup<T>[] {
  if (items.length === 0) return []
  if (isGrouped(items)) return items
  return [{ label: '', options: items }]
}

/** How long a typed run counts as one word before the buffer resets. */
const TYPEAHEAD_RESET_MS = 700

export function Select<T>({
  value,
  onChange,
  options,
  label,
  labelledBy,
  placeholder = 'Select…',
  size = 'default',
  className = '',
  disabled = false,
  title,
  id,
  align = 'start',
  placement = 'auto',
}: SelectProps<T>) {
  const groups = useMemo(() => toGroups(options), [options])
  const flat = useMemo(() => groups.flatMap(group => group.options), [groups])

  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)

  const triggerRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const typeahead = useRef({ buffer: '', at: 0 })

  const isMobile = useIsMobile()
  const reactId = useId()
  const listId = `${id ?? reactId}-listbox`
  const optionId = (index: number): string => `${listId}-option-${index}`

  const selectedIndex = flat.findIndex(option => Object.is(option.value, value))
  const selected = selectedIndex === -1 ? undefined : flat[selectedIndex]

  // Keep the keyboard cursor on the option the eye is on.
  useEffect(() => {
    if (!open) return
    const node = listRef.current?.querySelector<HTMLElement>(
      `#${CSS.escape(optionId(activeIndex))}`,
    )
    node?.scrollIntoView({ block: 'nearest' })
  }, [open, activeIndex, listId])

  const openList = (index: number): void => {
    if (disabled) return
    setActiveIndex(clampToEnabled(flat, index === -1 ? 0 : index, 1))
    setOpen(true)
  }

  const close = (): void => {
    setOpen(false)
    typeahead.current = { buffer: '', at: 0 }
  }

  const commit = (index: number): void => {
    const option = flat[index]
    close()
    triggerRef.current?.focus()
    if (!option || option.disabled) return
    if (!Object.is(option.value, value)) onChange(option.value)
  }

  const move = (delta: number): void => {
    const from = activeIndex === -1 ? selectedIndex : activeIndex
    const next = clampToEnabled(flat, from + delta, delta > 0 ? 1 : -1)
    setActiveIndex(next)
  }

  const jumpTo = (character: string): void => {
    const now = Date.now()
    const buffer =
      now - typeahead.current.at > TYPEAHEAD_RESET_MS
        ? character
        : typeahead.current.buffer + character
    typeahead.current = { buffer, at: now }

    const query = buffer.toLowerCase()
    const from = (activeIndex === -1 ? selectedIndex : activeIndex) + (buffer.length === 1 ? 1 : 0)
    // Search from just after the cursor so repeating a letter cycles matches.
    for (let step = 0; step < flat.length; step += 1) {
      const index = (((from + step) % flat.length) + flat.length) % flat.length
      const option = flat[index]
      if (option && !option.disabled && option.label.toLowerCase().startsWith(query)) {
        setActiveIndex(index)
        return
      }
    }
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>): void => {
    if (disabled) return

    if (!open) {
      if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        openList(selectedIndex)
      } else if (event.key === 'ArrowUp') {
        event.preventDefault()
        setActiveIndex(
          clampToEnabled(flat, selectedIndex === -1 ? flat.length - 1 : selectedIndex, -1),
        )
        setOpen(true)
      } else if (event.key === 'Home') {
        event.preventDefault()
        openList(0)
      } else if (event.key === 'End') {
        event.preventDefault()
        setActiveIndex(clampToEnabled(flat, flat.length - 1, -1))
        setOpen(true)
      } else if (isTypeaheadKey(event)) {
        event.preventDefault()
        setOpen(true)
        jumpTo(event.key)
      }
      return
    }

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        move(1)
        break
      case 'ArrowUp':
        event.preventDefault()
        move(-1)
        break
      case 'Home':
        event.preventDefault()
        setActiveIndex(clampToEnabled(flat, 0, 1))
        break
      case 'End':
        event.preventDefault()
        setActiveIndex(clampToEnabled(flat, flat.length - 1, -1))
        break
      case 'Enter':
      case ' ':
        event.preventDefault()
        commit(activeIndex)
        break
      case 'Escape':
        event.preventDefault()
        // Only this dropdown closes; the dialog behind it stays open.
        event.stopPropagation()
        close()
        break
      case 'Tab':
        // Let focus move on, but never leave a list hanging over the page.
        close()
        break
      default:
        if (isTypeaheadKey(event)) {
          event.preventDefault()
          jumpTo(event.key)
        }
    }
  }

  let index = -1

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        id={id}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && activeIndex >= 0 ? optionId(activeIndex) : undefined}
        aria-label={label}
        aria-labelledby={labelledBy}
        aria-disabled={disabled || undefined}
        disabled={disabled}
        title={title}
        className={`select-trigger select-trigger-${size} ${open ? 'is-open' : ''} ${className}`}
        onClick={() => (open ? close() : openList(selectedIndex))}
        onKeyDown={onKeyDown}
      >
        <span className={`select-value ${selected ? '' : 'is-placeholder'}`}>
          {selected?.label ?? placeholder}
        </span>
        <ChevronDown size={size === 'inline' ? 11 : 13} />
      </button>

      {open && (
        <Popover
          anchorRef={triggerRef}
          onClose={() => {
            close()
            triggerRef.current?.focus()
          }}
          role="listbox"
          id={listId}
          label={label}
          labelledBy={labelledBy}
          className="select-listbox"
          placement={placement}
          align={align}
          matchAnchorWidth
          focus="none"
          sheet
        >
          <div ref={listRef} className="select-list">
            {isMobile && label && <div className="select-sheet-title">{label}</div>}

            {groups.map(group => (
              <div
                key={group.label}
                role={group.label ? 'group' : 'presentation'}
                aria-label={group.label || undefined}
                className="select-group"
              >
                {group.label && <div className="select-group-label">{group.label}</div>}

                {group.options.map(option => {
                  index += 1
                  const optionIndex = index
                  const isSelected = optionIndex === selectedIndex
                  return (
                    <div
                      key={String(option.value)}
                      id={optionId(optionIndex)}
                      role="option"
                      aria-selected={isSelected}
                      aria-disabled={option.disabled || undefined}
                      className={[
                        'select-option',
                        isSelected ? 'is-selected' : '',
                        optionIndex === activeIndex ? 'is-active' : '',
                        option.disabled ? 'is-disabled' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      // Keep focus on the trigger: the listbox is driven by
                      // aria-activedescendant, not by moving focus into it.
                      onPointerDown={event => event.preventDefault()}
                      onClick={() => commit(optionIndex)}
                      onPointerMove={() => {
                        if (!option.disabled) setActiveIndex(optionIndex)
                      }}
                    >
                      <span className="select-option-check">
                        {isSelected && <Check size={13} />}
                      </span>
                      <span className="select-option-label">{option.label}</span>
                      {option.hint && <span className="select-option-hint">{option.hint}</span>}
                    </div>
                  )
                })}
              </div>
            ))}

            {flat.length === 0 && <p className="select-empty">Nothing to choose from</p>}
          </div>
        </Popover>
      )}
    </>
  )
}

/** The nearest selectable option at or after `index`, searching in `step`. */
function clampToEnabled<T>(
  options: readonly SelectOption<T>[],
  index: number,
  step: 1 | -1,
): number {
  if (options.length === 0) return -1
  let candidate = Math.max(0, Math.min(options.length - 1, index))
  for (let guard = 0; guard < options.length; guard += 1) {
    const option = options[candidate]
    if (!option) break
    if (!option.disabled) return candidate
    candidate += step
    if (candidate < 0 || candidate >= options.length) break
  }
  return options.findIndex(option => !option.disabled)
}

function isTypeaheadKey(event: React.KeyboardEvent): boolean {
  return event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey
}
