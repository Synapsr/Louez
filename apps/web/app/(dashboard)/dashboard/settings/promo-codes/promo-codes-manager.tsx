'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { format } from 'date-fns'
import {
  Plus,
  MoreHorizontal,
  Pencil,
  Trash2,
  Tag,
  Loader2,
  Power,
  PowerOff,
} from 'lucide-react'
import { formatCurrency } from '@louez/utils'
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  toastManager,
} from '@louez/ui'

import { togglePromoCode, deletePromoCode } from './actions'
import { PromoCodeFormDialog } from './promo-code-form'

interface PromoCode {
  id: string
  code: string
  description: string | null
  type: 'percentage' | 'fixed'
  value: string
  minimumAmount: string | null
  maxUsageCount: number | null
  currentUsageCount: number
  startsAt: Date | null
  expiresAt: Date | null
  isActive: boolean
  createdAt: Date
}

interface PromoCodesManagerProps {
  codes: PromoCode[]
  currency: string
}

type PromoCodeStatus = 'active' | 'inactive' | 'expired' | 'exhausted'

function getPromoCodeStatus(code: PromoCode): PromoCodeStatus {
  if (!code.isActive) return 'inactive'
  const now = new Date()
  if (code.expiresAt && code.expiresAt < now) return 'expired'
  if (code.startsAt && code.startsAt > now) return 'inactive'
  if (code.maxUsageCount !== null && code.currentUsageCount >= code.maxUsageCount)
    return 'exhausted'
  return 'active'
}

function StatusBadge({ status }: { status: PromoCodeStatus }) {
  const t = useTranslations('dashboard.settings.promoCodes')

  const variants: Record<PromoCodeStatus, { variant: 'default' | 'secondary' | 'destructive' | 'outline'; label: string }> = {
    active: { variant: 'default', label: t('active') },
    inactive: { variant: 'secondary', label: t('inactive') },
    expired: { variant: 'destructive', label: t('expired') },
    exhausted: { variant: 'outline', label: t('exhausted') },
  }

  const { variant, label } = variants[status]
  return <Badge variant={variant}>{label}</Badge>
}

export function PromoCodesManager({ codes, currency }: PromoCodesManagerProps) {
  const router = useRouter()
  const t = useTranslations('dashboard.settings.promoCodes')
  const tCommon = useTranslations('common')
  const tErrors = useTranslations('errors')
  const [isLoading, setIsLoading] = useState(false)

  // Form dialog
  const [formDialogOpen, setFormDialogOpen] = useState(false)
  const [editingCode, setEditingCode] = useState<PromoCode | null>(null)

  // Delete dialog
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [codeToDelete, setCodeToDelete] = useState<PromoCode | null>(null)

  const handleToggle = async (code: PromoCode) => {
    setIsLoading(true)
    try {
      const result = await togglePromoCode(code.id)
      if (result.error) {
        toastManager.add({ title: tErrors(result.error.replace('errors.', '')), type: 'error' })
      } else {
        toastManager.add({
          title: code.isActive ? t('deactivated') : t('activated'),
          type: 'success',
        })
        router.refresh()
      }
    } catch {
      toastManager.add({ title: tErrors('generic'), type: 'error' })
    } finally {
      setIsLoading(false)
    }
  }

  const handleDelete = async () => {
    if (!codeToDelete) return

    setIsLoading(true)
    try {
      const result = await deletePromoCode(codeToDelete.id)
      if (result.error) {
        toastManager.add({ title: tErrors(result.error.replace('errors.', '')), type: 'error' })
      } else {
        toastManager.add({ title: t('deleted'), type: 'success' })
        setDeleteDialogOpen(false)
        setCodeToDelete(null)
        router.refresh()
      }
    } catch {
      toastManager.add({ title: tErrors('generic'), type: 'error' })
    } finally {
      setIsLoading(false)
    }
  }

  const openEditDialog = (code: PromoCode) => {
    setEditingCode(code)
    setFormDialogOpen(true)
  }

  const openCreateDialog = () => {
    setEditingCode(null)
    setFormDialogOpen(true)
  }

  const formatValue = (code: PromoCode) => {
    if (code.type === 'percentage') return `${parseFloat(code.value)}%`
    return formatCurrency(parseFloat(code.value), currency)
  }

  const formatUsage = (code: PromoCode) => {
    if (code.maxUsageCount !== null) {
      return `${code.currentUsageCount} / ${code.maxUsageCount}`
    }
    return `${code.currentUsageCount}`
  }

  const formatDateRange = (code: PromoCode) => {
    if (!code.startsAt && !code.expiresAt) return null
    const parts: string[] = []
    if (code.startsAt) parts.push(format(code.startsAt, 'dd/MM/yyyy'))
    else parts.push('...')
    parts.push('\u2192')
    if (code.expiresAt) parts.push(format(code.expiresAt, 'dd/MM/yyyy'))
    else parts.push('...')
    return parts.join(' ')
  }

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Tag className="h-5 w-5" />
              {t('title')}
            </CardTitle>
            <CardDescription>
              {codes.length === 0
                ? t('noPromoCodesDescription')
                : t('count', { count: codes.length })}
            </CardDescription>
          </div>
          <Button onClick={openCreateDialog}>
            <Plus className="mr-2 h-4 w-4" />
            {t('createCode')}
          </Button>
        </CardHeader>
        <CardContent>
          {codes.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-12">
              <Tag className="h-12 w-12 text-muted-foreground" />
              <h3 className="mt-4 text-lg font-semibold">
                {t('noPromoCodes')}
              </h3>
              <p className="mt-2 max-w-sm text-center text-sm text-muted-foreground">
                {t('noPromoCodesDescription')}
              </p>
              <Button className="mt-4" onClick={openCreateDialog}>
                {t('createCode')}
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              {codes.map((code) => {
                const status = getPromoCodeStatus(code)
                const dateRange = formatDateRange(code)

                return (
                  <div
                    key={code.id}
                    className="flex items-center justify-between rounded-lg border p-4"
                  >
                    <div className="flex items-center gap-4 min-w-0">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <code className="rounded bg-muted px-2 py-0.5 text-sm font-semibold">
                            {code.code}
                          </code>
                          <StatusBadge status={status} />
                          <span className="text-sm font-medium text-primary">
                            -{formatValue(code)}
                          </span>
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                          <span>{t('usageLabel')}: {formatUsage(code)}</span>
                          {code.minimumAmount && parseFloat(code.minimumAmount) > 0 && (
                            <span>
                              {t('minLabel')}: {formatCurrency(parseFloat(code.minimumAmount), currency)}
                            </span>
                          )}
                          {dateRange && <span>{dateRange}</span>}
                        </div>
                        {code.description && (
                          <p className="mt-1 truncate text-xs text-muted-foreground italic">
                            {code.description}
                          </p>
                        )}
                      </div>
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={<Button variant="ghost" size="icon" />}
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => openEditDialog(code)}>
                          <Pencil className="mr-2 h-4 w-4" />
                          {tCommon('edit')}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => handleToggle(code)}
                          disabled={isLoading}
                        >
                          {code.isActive ? (
                            <>
                              <PowerOff className="mr-2 h-4 w-4" />
                              {t('deactivate')}
                            </>
                          ) : (
                            <>
                              <Power className="mr-2 h-4 w-4" />
                              {t('activate')}
                            </>
                          )}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onClick={() => {
                            setCodeToDelete(code)
                            setDeleteDialogOpen(true)
                          }}
                        >
                          <Trash2 className="mr-2 h-4 w-4" />
                          {tCommon('delete')}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <PromoCodeFormDialog
        open={formDialogOpen}
        onOpenChange={setFormDialogOpen}
        editingCode={editingCode}
        currency={currency}
      />

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('deleteConfirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('deleteConfirm')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>
              {tCommon('cancel')}
            </AlertDialogClose>
            <AlertDialogClose
              render={<Button variant="destructive" />}
              onClick={handleDelete}
              disabled={isLoading}
            >
              {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {tCommon('delete')}
            </AlertDialogClose>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
