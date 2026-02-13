'use client'

import { useEffect, useRef, useState } from 'react'
import { Check, Pencil, X } from 'lucide-react'
import { Input, Label } from '@louez/ui'
import { cn } from '@louez/utils'

type FormStoreNameSlugProps = {
  nameValue: string
  nameErrors: unknown[]
  slugValue: string
  slugErrors: unknown[]
  onNameChange: (nextValue: string) => void
  onNameBlur: () => void
  onSlugChange: (nextValue: string) => void
  label: string
  namePlaceholder: string
  slugPlaceholder: string
  slugDefault: string
  domain: string
  confirmAriaLabel: string
  cancelAriaLabel: string
}

function slugifyStoreName(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

function sanitizeSlugValue(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-/, '')
}

function getFormErrorMessage(error: unknown): string {
  if (typeof error === 'string') return error

  if (error instanceof Error && error.message) {
    return error.message
  }

  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>

    if (typeof record.message === 'string' && record.message.length > 0) {
      return record.message
    }

    if (Array.isArray(record.issues) && record.issues.length > 0) {
      return getFormErrorMessage(record.issues[0])
    }

    if (Array.isArray(record.errors) && record.errors.length > 0) {
      return getFormErrorMessage(record.errors[0])
    }
  }

  return 'Invalid value'
}

export function FormStoreNameSlug({
  nameValue,
  nameErrors,
  slugValue,
  slugErrors,
  onNameChange,
  onNameBlur,
  onSlugChange,
  label,
  namePlaceholder,
  slugPlaceholder,
  slugDefault,
  domain,
  confirmAriaLabel,
  cancelAriaLabel,
}: FormStoreNameSlugProps) {
  const [isEditingSlug, setIsEditingSlug] = useState(false)
  const [isSlugManuallyEdited, setIsSlugManuallyEdited] = useState(false)
  const slugInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!isEditingSlug || !slugInputRef.current) return

    slugInputRef.current.focus()
    slugInputRef.current.select()
  }, [isEditingSlug])

  const handleStoreNameChange = (value: string) => {
    onNameChange(value)

    if (isSlugManuallyEdited) return

    onSlugChange(slugifyStoreName(value))
  }

  const handleSlugInputChange = (value: string) => {
    onSlugChange(sanitizeSlugValue(value))
    setIsSlugManuallyEdited(true)
  }

  const closeSlugEditor = () => {
    setIsEditingSlug(false)
  }

  const resetSlugToGeneratedValue = () => {
    setIsSlugManuallyEdited(false)
    setIsEditingSlug(false)
    onSlugChange(slugifyStoreName(nameValue))
  }

  return (
    <>
      <div className="grid gap-2">
        <Label htmlFor="name">{label}</Label>
        <Input
          id="name"
          placeholder={namePlaceholder}
          value={nameValue}
          onChange={(e) => handleStoreNameChange(e.target.value)}
          onBlur={onNameBlur}
        />

        {(slugValue || nameValue) && (
          <div className="pt-1">
            {isEditingSlug ? (
              <div className="flex items-center gap-2">
                <div className="flex flex-1 items-center rounded-md border bg-muted/50 px-3 py-1.5">
                  <input
                    ref={slugInputRef}
                    type="text"
                    value={slugValue}
                    onChange={(e) => handleSlugInputChange(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        closeSlugEditor()
                      }

                      if (e.key === 'Escape') {
                        resetSlugToGeneratedValue()
                      }
                    }}
                    className="min-w-0 flex-1 bg-transparent text-sm font-medium outline-none"
                    placeholder={slugPlaceholder}
                  />
                  <span className="text-muted-foreground text-sm">.{domain}</span>
                </div>
                <button
                  type="button"
                  onClick={closeSlugEditor}
                  className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  aria-label={confirmAriaLabel}
                >
                  <Check className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={resetSlugToGeneratedValue}
                  className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  aria-label={cancelAriaLabel}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <div
                className="group flex cursor-pointer items-center gap-2"
                onClick={() => setIsEditingSlug(true)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    setIsEditingSlug(true)
                  }
                }}
              >
                <span className="text-sm text-muted-foreground">
                  <span
                    className={cn(
                      'font-medium transition-colors',
                      'group-hover:text-primary',
                    )}
                  >
                    {slugValue || slugifyStoreName(nameValue) || slugDefault}
                  </span>
                  <span>.{domain}</span>
                </span>
                <Pencil className="h-3 w-3 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
              </div>
            )}
          </div>
        )}

        {nameErrors.length > 0 && (
          <p className="text-destructive text-sm">
            {getFormErrorMessage(nameErrors[0])}
          </p>
        )}
      </div>

      <div>
        <input type="hidden" value={slugValue} />
        {slugErrors.length > 0 && (
          <p className="text-sm font-medium text-destructive">
            {getFormErrorMessage(slugErrors[0])}
          </p>
        )}
      </div>
    </>
  )
}
