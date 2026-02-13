'use client'

import { useState, useTransition } from 'react'
import { Pencil, Save, X } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { Button } from '@louez/ui'
import { Textarea } from '@louez/ui'
import { updateCustomerNotes } from '../actions'

interface CustomerNotesProps {
  customerId: string
  initialNotes: string
}

export function CustomerNotes({ customerId, initialNotes }: CustomerNotesProps) {
  const t = useTranslations('dashboard.customers')
  const [isEditing, setIsEditing] = useState(false)
  const [notes, setNotes] = useState(initialNotes)
  const [isPending, startTransition] = useTransition()

  const handleSave = () => {
    startTransition(async () => {
      const result = await updateCustomerNotes(customerId, notes)
      if (result.error) {
        alert(result.error)
      } else {
        setIsEditing(false)
      }
    })
  }

  const handleCancel = () => {
    setNotes(initialNotes)
    setIsEditing(false)
  }

  if (isEditing) {
    return (
      <div className="space-y-4">
        <Textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder={t('notes.placeholder')}
          rows={4}
        />
        <div className="flex gap-2">
          <Button onClick={handleSave} disabled={isPending}>
            <Save className="mr-2 h-4 w-4" />
            {isPending ? t('notes.saving') : t('notes.save')}
          </Button>
          <Button variant="outline" onClick={handleCancel}>
            <X className="mr-2 h-4 w-4" />
            {t('notes.cancel')}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div>
      {notes ? (
        <p className="whitespace-pre-wrap text-sm">{notes}</p>
      ) : (
        <p className="text-sm text-muted-foreground">{t('notes.empty')}</p>
      )}
      <Button
        variant="outline"
        className="mt-4"
        onClick={() => setIsEditing(true)}
      >
        <Pencil className="mr-2 h-4 w-4" />
        {notes ? t('notes.edit') : t('notes.add')}
      </Button>
    </div>
  )
}
