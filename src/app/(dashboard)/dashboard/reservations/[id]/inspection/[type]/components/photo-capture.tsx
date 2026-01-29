'use client'

import { useState, useRef, useCallback } from 'react'
import { useTranslations } from 'next-intl'
import { Camera, X, Plus, Loader2, ImageIcon, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

export interface CapturedPhoto {
  id: string
  url: string
  thumbnailUrl?: string
  caption?: string
  isUploading?: boolean
}

interface PhotoCaptureProps {
  photos: CapturedPhoto[]
  onPhotosChange: (photos: CapturedPhoto[]) => void
  maxPhotos?: number
  disabled?: boolean
}

/**
 * Generate a unique ID for photos
 */
function generatePhotoId(): string {
  return `photo_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
}

/**
 * Compress an image file for local preview
 */
async function compressImage(
  file: File,
  maxWidth: number = 1200,
  quality: number = 0.8
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = document.createElement('img')
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')

    img.onload = () => {
      URL.revokeObjectURL(img.src)

      let { width, height } = img

      // Scale down if needed
      if (width > maxWidth) {
        height = (height * maxWidth) / width
        width = maxWidth
      }

      canvas.width = width
      canvas.height = height

      if (ctx) {
        ctx.drawImage(img, 0, 0, width, height)
        // Return as data URL for local storage
        resolve(canvas.toDataURL('image/webp', quality))
      } else {
        reject(new Error('Failed to get canvas context'))
      }
    }

    img.onerror = () => reject(new Error('Failed to load image'))
    img.src = URL.createObjectURL(file)
  })
}

export function PhotoCapture({
  photos,
  onPhotosChange,
  maxPhotos = 10,
  disabled = false,
}: PhotoCaptureProps) {
  const t = useTranslations('dashboard.settings.inspection')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [previewPhoto, setPreviewPhoto] = useState<CapturedPhoto | null>(null)
  const [isCapturing, setIsCapturing] = useState(false)

  const canAddMore = photos.length < maxPhotos

  const handleFileSelect = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = event.target.files
      if (!files || files.length === 0) return

      const remainingSlots = maxPhotos - photos.length
      const filesToProcess = Array.from(files).slice(0, remainingSlots)

      setIsCapturing(true)

      const newPhotos: CapturedPhoto[] = []

      for (const file of filesToProcess) {
        // Validate file type
        if (!file.type.startsWith('image/')) {
          toast.error(t('wizard.photoInvalidType'))
          continue
        }

        // Validate file size (max 20MB before compression)
        if (file.size > 20 * 1024 * 1024) {
          toast.error(t('wizard.photoTooLarge'))
          continue
        }

        try {
          // Compress and convert to data URL
          const dataUrl = await compressImage(file)

          newPhotos.push({
            id: generatePhotoId(),
            url: dataUrl,
            isUploading: false,
          })
        } catch {
          toast.error(t('wizard.photoError'))
        }
      }

      if (newPhotos.length > 0) {
        onPhotosChange([...photos, ...newPhotos])
      }

      setIsCapturing(false)

      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    },
    [photos, maxPhotos, onPhotosChange, t]
  )

  const handleRemovePhoto = useCallback(
    (photoId: string) => {
      onPhotosChange(photos.filter((p) => p.id !== photoId))
      setPreviewPhoto(null)
    },
    [photos, onPhotosChange]
  )

  const handleTriggerCapture = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  return (
    <div className="space-y-3">
      {/* Photo grid */}
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 sm:gap-3">
        {photos.map((photo) => (
          <button
            key={photo.id}
            type="button"
            onClick={() => setPreviewPhoto(photo)}
            disabled={photo.isUploading}
            className={cn(
              'group relative aspect-square overflow-hidden rounded-xl border bg-muted',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2',
              photo.isUploading && 'cursor-wait'
            )}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={photo.thumbnailUrl || photo.url}
              alt=""
              className="h-full w-full object-cover"
            />

            {/* Uploading overlay */}
            {photo.isUploading && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                <Loader2 className="h-6 w-6 animate-spin text-white" />
              </div>
            )}

            {/* Hover overlay */}
            {!photo.isUploading && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition-all group-hover:bg-black/30 group-hover:opacity-100">
                <ImageIcon className="h-6 w-6 text-white" />
              </div>
            )}
          </button>
        ))}

        {/* Add photo button */}
        {canAddMore && (
          <button
            type="button"
            onClick={handleTriggerCapture}
            disabled={disabled || isCapturing}
            className={cn(
              'flex aspect-square flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed',
              'transition-colors hover:border-primary hover:bg-primary/5',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2',
              (disabled || isCapturing) && 'cursor-not-allowed opacity-50'
            )}
          >
            {isCapturing ? (
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            ) : (
              <>
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
                  <Plus className="h-5 w-5 text-primary" />
                </div>
                <span className="text-xs text-muted-foreground">
                  {photos.length}/{maxPhotos}
                </span>
              </>
            )}
          </button>
        )}
      </div>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        onChange={handleFileSelect}
        className="hidden"
        aria-label={t('wizard.addPhoto')}
      />

      {/* Quick capture button for mobile */}
      {canAddMore && (
        <Button
          type="button"
          variant="outline"
          onClick={handleTriggerCapture}
          disabled={disabled || isCapturing}
          className="w-full sm:hidden"
        >
          <Camera className="mr-2 h-4 w-4" />
          {t('wizard.takePhoto')}
        </Button>
      )}

      {/* Photo preview dialog */}
      <Dialog open={!!previewPhoto} onOpenChange={() => setPreviewPhoto(null)}>
        <DialogContent className="max-w-2xl p-0">
          <DialogHeader className="sr-only">
            <DialogTitle>{t('wizard.photoPreview')}</DialogTitle>
          </DialogHeader>

          {previewPhoto && (
            <div className="relative">
              {/* Image */}
              <div className="relative aspect-[4/3] w-full bg-black">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={previewPhoto.url}
                  alt=""
                  className="h-full w-full object-contain"
                />
              </div>

              {/* Actions */}
              <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-2">
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => handleRemovePhoto(previewPhoto.id)}
                  className="gap-2"
                >
                  <Trash2 className="h-4 w-4" />
                  {t('wizard.deletePhoto')}
                </Button>
              </div>

              {/* Close button */}
              <button
                type="button"
                onClick={() => setPreviewPhoto(null)}
                className="absolute right-4 top-4 rounded-full bg-black/50 p-2 text-white transition-colors hover:bg-black/70"
              >
                <X className="h-5 w-5" />
                <span className="sr-only">{t('wizard.close')}</span>
              </button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

/**
 * Minimal photo display for comparison views
 */
interface PhotoGridProps {
  photos: CapturedPhoto[]
  onPhotoClick?: (photo: CapturedPhoto) => void
}

export function PhotoGrid({ photos, onPhotoClick }: PhotoGridProps) {
  if (photos.length === 0) {
    return (
      <div className="flex items-center justify-center rounded-lg border border-dashed p-6 text-center">
        <div className="text-muted-foreground">
          <ImageIcon className="mx-auto h-8 w-8 opacity-50" />
          <p className="mt-2 text-sm">Aucune photo</p>
        </div>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-3 gap-2">
      {photos.map((photo) => (
        <button
          key={photo.id}
          type="button"
          onClick={() => onPhotoClick?.(photo)}
          className="group relative aspect-square overflow-hidden rounded-lg border bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={photo.thumbnailUrl || photo.url}
            alt=""
            className="h-full w-full object-cover transition-transform group-hover:scale-105"
          />
        </button>
      ))}
    </div>
  )
}
