import { useCallback, useState } from 'react'
import type { ChangeEvent, DragEvent } from 'react'

import { useTranslations } from 'next-intl'

import { toastManager } from '@louez/ui'

import type { ProductFormComponentApi } from '../types'

interface UseProductFormMediaParams {
  form: ProductFormComponentApi
  imagesPreviews: string[]
}

export function useProductFormMedia({
  form,
  imagesPreviews,
}: UseProductFormMediaParams) {
  const t = useTranslations('dashboard.products.form')

  const [isDragging, setIsDragging] = useState(false)
  const [isUploadingImages, setIsUploadingImages] = useState(false)

  const processFiles = useCallback(
    async (files: FileList | File[]) => {
      const fileArray = Array.from(files)
      const filesToProcess = Math.min(fileArray.length, 5 - imagesPreviews.length)

      if (filesToProcess === 0) return

      setIsUploadingImages(true)
      const uploadedUrls: string[] = []

      try {
        for (let index = 0; index < filesToProcess; index += 1) {
          const file = fileArray[index]

          if (!file.type.startsWith('image/')) {
            toastManager.add({ title: t('imageError'), type: 'error' })
            continue
          }

          if (file.size > 15 * 1024 * 1024) {
            toastManager.add({ title: t('imageSizeError'), type: 'error' })
            continue
          }

          const base64 = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader()
            reader.onload = () => resolve(reader.result as string)
            reader.onerror = reject
            reader.readAsDataURL(file)
          })

          const response = await fetch('/api/upload/image', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              image: base64,
              type: 'product',
              filename: `product-${Date.now()}`,
            }),
          })

          if (!response.ok) {
            const error = await response.json()
            throw new Error(error.error || 'Upload failed')
          }

          const { url } = await response.json()
          uploadedUrls.push(url)
        }

        if (uploadedUrls.length > 0) {
          form.setFieldValue('images', [...imagesPreviews, ...uploadedUrls])
        }
      } catch (error) {
        console.error('Image upload error:', error)
        toastManager.add({ title: t('imageUploadError'), type: 'error' })
      } finally {
        setIsUploadingImages(false)
      }
    },
    [form, imagesPreviews, t]
  )

  const handleImageUpload = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      if (!event.target.files) return
      processFiles(event.target.files)
    },
    [processFiles]
  )

  const handleDragOver = useCallback((event: DragEvent) => {
    event.preventDefault()
    event.stopPropagation()
  }, [])

  const handleDragEnter = useCallback((event: DragEvent) => {
    event.preventDefault()
    event.stopPropagation()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((event: DragEvent) => {
    event.preventDefault()
    event.stopPropagation()
    setIsDragging(false)
  }, [])

  const handleDrop = useCallback(
    (event: DragEvent) => {
      event.preventDefault()
      event.stopPropagation()
      setIsDragging(false)

      if (event.dataTransfer.files && event.dataTransfer.files.length > 0) {
        processFiles(event.dataTransfer.files)
      }
    },
    [processFiles]
  )

  const removeImage = useCallback(
    (index: number) => {
      form.setFieldValue(
        'images',
        imagesPreviews.filter((_, currentIndex) => currentIndex !== index)
      )
    },
    [form, imagesPreviews]
  )

  const setMainImage = useCallback(
    (index: number) => {
      if (index === 0) return

      const updated = [...imagesPreviews]
      const [moved] = updated.splice(index, 1)
      updated.unshift(moved)
      form.setFieldValue('images', updated)
    },
    [form, imagesPreviews]
  )

  return {
    isDragging,
    isUploadingImages,
    processFiles,
    handleImageUpload,
    handleDragOver,
    handleDragEnter,
    handleDragLeave,
    handleDrop,
    removeImage,
    setMainImage,
  }
}
