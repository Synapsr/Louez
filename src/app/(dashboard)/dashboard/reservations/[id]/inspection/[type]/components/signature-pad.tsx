'use client'

import { useRef, useState, useEffect, useCallback } from 'react'
import { useTranslations } from 'next-intl'
import { Eraser, PenLine, Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'

interface SignaturePadProps {
  value: string | null
  onChange: (signature: string | null) => void
  signerName?: string
  onSignerNameChange?: (name: string) => void
  disabled?: boolean
  showConfirmation?: boolean
  confirmationText?: string
  className?: string
}

interface Point {
  x: number
  y: number
}

export function SignaturePad({
  value,
  onChange,
  signerName = '',
  disabled = false,
  showConfirmation = true,
  confirmationText,
  className,
}: SignaturePadProps) {
  const t = useTranslations('dashboard.settings.inspection')
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [isDrawing, setIsDrawing] = useState(false)
  const [hasSignature, setHasSignature] = useState(false)
  const [isConfirmed, setIsConfirmed] = useState(false)
  const lastPoint = useRef<Point | null>(null)

  // Initialize canvas with existing signature
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Set canvas size based on container
    const updateCanvasSize = () => {
      const container = containerRef.current
      if (!container) return

      const rect = container.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1

      canvas.width = rect.width * dpr
      canvas.height = rect.height * dpr
      canvas.style.width = `${rect.width}px`
      canvas.style.height = `${rect.height}px`

      ctx.scale(dpr, dpr)
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.strokeStyle = '#1a1a1a'
      ctx.lineWidth = 2

      // Restore existing signature if any
      if (value) {
        const img = new window.Image()
        img.onload = () => {
          ctx.drawImage(img, 0, 0, rect.width, rect.height)
          setHasSignature(true)
        }
        img.src = value
      }
    }

    updateCanvasSize()

    const resizeObserver = new ResizeObserver(updateCanvasSize)
    if (containerRef.current) {
      resizeObserver.observe(containerRef.current)
    }

    return () => resizeObserver.disconnect()
  }, [value])

  const getPointFromEvent = useCallback(
    (e: React.TouchEvent | React.MouseEvent): Point | null => {
      const canvas = canvasRef.current
      if (!canvas) return null

      const rect = canvas.getBoundingClientRect()
      let clientX: number, clientY: number

      if ('touches' in e) {
        if (e.touches.length === 0) return null
        clientX = e.touches[0].clientX
        clientY = e.touches[0].clientY
      } else {
        clientX = e.clientX
        clientY = e.clientY
      }

      return {
        x: clientX - rect.left,
        y: clientY - rect.top,
      }
    },
    []
  )

  const startDrawing = useCallback(
    (e: React.TouchEvent | React.MouseEvent) => {
      if (disabled) return

      const point = getPointFromEvent(e)
      if (!point) return

      setIsDrawing(true)
      lastPoint.current = point

      const canvas = canvasRef.current
      const ctx = canvas?.getContext('2d')
      if (ctx) {
        ctx.beginPath()
        ctx.moveTo(point.x, point.y)
      }
    },
    [disabled, getPointFromEvent]
  )

  const draw = useCallback(
    (e: React.TouchEvent | React.MouseEvent) => {
      if (!isDrawing || disabled) return

      const point = getPointFromEvent(e)
      if (!point) return

      const canvas = canvasRef.current
      const ctx = canvas?.getContext('2d')

      if (ctx && lastPoint.current) {
        ctx.beginPath()
        ctx.moveTo(lastPoint.current.x, lastPoint.current.y)
        ctx.lineTo(point.x, point.y)
        ctx.stroke()
        setHasSignature(true)
      }

      lastPoint.current = point
    },
    [isDrawing, disabled, getPointFromEvent]
  )

  const stopDrawing = useCallback(() => {
    if (isDrawing) {
      setIsDrawing(false)
      lastPoint.current = null

      // Save signature as base64
      const canvas = canvasRef.current
      if (canvas && hasSignature) {
        const dataUrl = canvas.toDataURL('image/png')
        onChange(dataUrl)
      }
    }
  }, [isDrawing, hasSignature, onChange])

  const clearSignature = useCallback(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')

    if (canvas && ctx) {
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      setHasSignature(false)
      setIsConfirmed(false)
      onChange(null)
    }
  }, [onChange])

  const handleConfirmChange = useCallback(
    (checked: boolean) => {
      setIsConfirmed(checked)
      if (!checked) {
        onChange(null)
      } else if (hasSignature) {
        const canvas = canvasRef.current
        if (canvas) {
          const dataUrl = canvas.toDataURL('image/png')
          onChange(dataUrl)
        }
      }
    },
    [hasSignature, onChange]
  )

  const isValid = hasSignature && (!showConfirmation || isConfirmed)

  return (
    <div className={cn('space-y-4', className)}>
      {/* Signer name display */}
      {signerName && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <PenLine className="h-4 w-4" />
          <span>{t('wizard.signingAs', { name: signerName })}</span>
        </div>
      )}

      {/* Canvas container */}
      <div
        ref={containerRef}
        className={cn(
          'relative h-40 w-full overflow-hidden rounded-xl border-2 bg-white',
          disabled ? 'cursor-not-allowed opacity-50' : 'cursor-crosshair',
          hasSignature ? 'border-primary' : 'border-dashed border-muted-foreground/30'
        )}
      >
        <canvas
          ref={canvasRef}
          className="touch-none"
          onMouseDown={startDrawing}
          onMouseMove={draw}
          onMouseUp={stopDrawing}
          onMouseLeave={stopDrawing}
          onTouchStart={startDrawing}
          onTouchMove={draw}
          onTouchEnd={stopDrawing}
        />

        {/* Placeholder text */}
        {!hasSignature && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-muted-foreground/50">
            <span className="text-sm">{t('wizard.signHere')}</span>
          </div>
        )}

        {/* Clear button */}
        {hasSignature && !disabled && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={clearSignature}
            className="absolute right-2 top-2 h-8 w-8 p-0"
          >
            <Eraser className="h-4 w-4" />
            <span className="sr-only">{t('wizard.clearSignature')}</span>
          </Button>
        )}
      </div>

      {/* Confirmation checkbox */}
      {showConfirmation && (
        <div className="flex items-start gap-3 rounded-lg border bg-muted/30 p-3">
          <Checkbox
            id="signature-confirmation"
            checked={isConfirmed}
            onCheckedChange={handleConfirmChange}
            disabled={disabled || !hasSignature}
          />
          <Label
            htmlFor="signature-confirmation"
            className={cn(
              'text-sm leading-relaxed',
              !hasSignature && 'text-muted-foreground'
            )}
          >
            {confirmationText || t('wizard.signatureConfirmation')}
          </Label>
        </div>
      )}

      {/* Status indicator */}
      {isValid && (
        <div className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400">
          <Check className="h-4 w-4" />
          <span>{t('wizard.signatureComplete')}</span>
        </div>
      )}
    </div>
  )
}

/**
 * Display-only signature view
 */
interface SignatureDisplayProps {
  signature: string
  signerName?: string
  signedAt?: Date
  className?: string
}

export function SignatureDisplay({
  signature,
  signerName,
  signedAt,
  className,
}: SignatureDisplayProps) {
  const t = useTranslations('dashboard.settings.inspection')

  return (
    <div className={cn('space-y-2', className)}>
      <div className="overflow-hidden rounded-lg border bg-white">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={signature}
          alt={t('wizard.customerSignature')}
          className="h-32 w-full object-contain"
        />
      </div>
      {(signerName || signedAt) && (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          {signerName && <span>{signerName}</span>}
          {signedAt && (
            <span>
              {signedAt.toLocaleDateString()} {signedAt.toLocaleTimeString()}
            </span>
          )}
        </div>
      )}
    </div>
  )
}
