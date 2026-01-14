'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  Calendar as CalendarIcon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { cn, formatCurrency, formatDateShort } from '@/lib/utils'

type ReservationStatus = 'pending' | 'confirmed' | 'ongoing' | 'completed' | 'cancelled' | 'rejected'

interface Reservation {
  id: string
  number: string
  status: ReservationStatus | null
  startDate: Date
  endDate: Date
  totalAmount: string
  customer: {
    id: string
    firstName: string
    lastName: string
  }
  items: Array<{
    id: string
    quantity: number
    product: {
      id: string
      name: string
    } | null
    productSnapshot: {
      name: string
    } | null
  }>
}

interface Product {
  id: string
  name: string
  quantity: number
}

interface CalendarViewProps {
  initialReservations: Reservation[]
  products: Product[]
  storeId: string
}

const statusColors: Record<ReservationStatus, string> = {
  pending: 'bg-yellow-500',
  confirmed: 'bg-green-500',
  ongoing: 'bg-blue-500',
  completed: 'bg-gray-400',
  cancelled: 'bg-red-300',
  rejected: 'bg-red-400',
}

type ViewMode = 'week' | 'month'

export function CalendarView({
  initialReservations,
  products,
}: CalendarViewProps) {
  const t = useTranslations('dashboard.calendar')
  const [currentDate, setCurrentDate] = useState(new Date())
  const [viewMode, setViewMode] = useState<ViewMode>('week')
  const [selectedProductId, setSelectedProductId] = useState<string>('all')
  const [reservations] = useState(initialReservations)

  const statusLabels: Record<ReservationStatus, string> = {
    pending: t('status.pending'),
    confirmed: t('status.confirmed'),
    ongoing: t('status.ongoing'),
    completed: t('status.completed'),
    cancelled: t('status.cancelled'),
    rejected: t('status.rejected'),
  }

  const dayNames = [
    t('dayNames.mon'),
    t('dayNames.tue'),
    t('dayNames.wed'),
    t('dayNames.thu'),
    t('dayNames.fri'),
    t('dayNames.sat'),
    t('dayNames.sun'),
  ]

  // Calculate days to display based on view mode
  const displayDays = useMemo(() => {
    const days: Date[] = []
    const start = new Date(currentDate)

    if (viewMode === 'week') {
      // Get Monday of the week
      const dayOfWeek = start.getDay()
      const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek
      start.setDate(start.getDate() + diff)

      for (let i = 0; i < 7; i++) {
        const day = new Date(start)
        day.setDate(start.getDate() + i)
        days.push(day)
      }
    } else {
      // Month view
      const firstDay = new Date(start.getFullYear(), start.getMonth(), 1)
      const lastDay = new Date(start.getFullYear(), start.getMonth() + 1, 0)

      // Start from Monday of the first week
      const startDayOfWeek = firstDay.getDay()
      const startDiff = startDayOfWeek === 0 ? -6 : 1 - startDayOfWeek
      const viewStart = new Date(firstDay)
      viewStart.setDate(firstDay.getDate() + startDiff)

      // Generate 5-6 weeks
      const weeks = Math.ceil((lastDay.getDate() + Math.abs(startDiff)) / 7)
      for (let i = 0; i < weeks * 7; i++) {
        const day = new Date(viewStart)
        day.setDate(viewStart.getDate() + i)
        days.push(day)
      }
    }

    return days
  }, [currentDate, viewMode])

  // Filter reservations by product
  const filteredReservations = useMemo(() => {
    if (selectedProductId === 'all') return reservations

    return reservations.filter((r) =>
      r.items.some((item) => item.product?.id === selectedProductId)
    )
  }, [reservations, selectedProductId])

  // Get reservations for a specific day
  const getReservationsForDay = (day: Date) => {
    return filteredReservations.filter((r) => {
      const start = new Date(r.startDate)
      const end = new Date(r.endDate)
      const dayStart = new Date(day.getFullYear(), day.getMonth(), day.getDate())
      const dayEnd = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 23, 59, 59)

      return start <= dayEnd && end >= dayStart
    })
  }

  // Navigation functions
  const goToPrevious = () => {
    const newDate = new Date(currentDate)
    if (viewMode === 'week') {
      newDate.setDate(newDate.getDate() - 7)
    } else {
      newDate.setMonth(newDate.getMonth() - 1)
    }
    setCurrentDate(newDate)
  }

  const goToNext = () => {
    const newDate = new Date(currentDate)
    if (viewMode === 'week') {
      newDate.setDate(newDate.getDate() + 7)
    } else {
      newDate.setMonth(newDate.getMonth() + 1)
    }
    setCurrentDate(newDate)
  }

  const goToToday = () => {
    setCurrentDate(new Date())
  }

  // Format period label
  const periodLabel = useMemo(() => {
    if (viewMode === 'week') {
      const start = displayDays[0]
      const end = displayDays[6]
      return `${formatDateShort(start)} - ${formatDateShort(end)} ${end.getFullYear()}`
    } else {
      return new Intl.DateTimeFormat('fr-FR', {
        month: 'long',
        year: 'numeric',
      }).format(currentDate)
    }
  }, [displayDays, currentDate, viewMode])

  const isToday = (day: Date) => {
    const today = new Date()
    return (
      day.getDate() === today.getDate() &&
      day.getMonth() === today.getMonth() &&
      day.getFullYear() === today.getFullYear()
    )
  }

  const isCurrentMonth = (day: Date) => {
    return day.getMonth() === currentDate.getMonth()
  }

  return (
    <div className="space-y-4">
      {/* Controls */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            {/* Navigation */}
            <div className="flex items-center gap-2">
              <Button variant="outline" size="icon" onClick={goToPrevious}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="icon" onClick={goToNext}>
                <ChevronRight className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="sm" onClick={goToToday}>
                {t('today')}
              </Button>
              <span className="ml-2 text-lg font-semibold capitalize">
                {periodLabel}
              </span>
            </div>

            {/* Filters */}
            <div className="flex items-center gap-2">
              <Select value={viewMode} onValueChange={(v) => setViewMode(v as ViewMode)}>
                <SelectTrigger className="w-[140px]">
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="week">{t('views.week')}</SelectItem>
                  <SelectItem value="month">{t('views.month')}</SelectItem>
                </SelectContent>
              </Select>

              <Select value={selectedProductId} onValueChange={setSelectedProductId}>
                <SelectTrigger className="w-[200px]">
                  <SelectValue placeholder={t('filterByProduct')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('allProducts')}</SelectItem>
                  {products.map((product) => (
                    <SelectItem key={product.id} value={product.id}>
                      {product.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Button asChild>
                <Link href="/dashboard/reservations/new">
                  <Plus className="mr-2 h-4 w-4" />
                  {t('new')}
                </Link>
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Calendar Grid */}
      <Card>
        <CardContent className="p-0">
          {/* Day Headers */}
          <div className="grid grid-cols-7 border-b">
            {dayNames.map((name, i) => (
              <div
                key={name}
                className={cn(
                  'p-3 text-center text-sm font-medium text-muted-foreground',
                  i === 5 || i === 6 ? 'bg-muted/30' : ''
                )}
              >
                {name}
              </div>
            ))}
          </div>

          {/* Calendar Days */}
          <div className={cn(
            'grid grid-cols-7',
            viewMode === 'week' ? 'min-h-[500px]' : ''
          )}>
            {displayDays.map((day, index) => {
              const dayReservations = getReservationsForDay(day)
              const isWeekend = day.getDay() === 0 || day.getDay() === 6

              return (
                <div
                  key={index}
                  className={cn(
                    'min-h-[120px] border-b border-r p-2',
                    viewMode === 'week' ? 'min-h-[140px]' : '',
                    isWeekend ? 'bg-muted/20' : '',
                    !isCurrentMonth(day) && viewMode === 'month' ? 'bg-muted/40' : '',
                    index % 7 === 6 ? 'border-r-0' : ''
                  )}
                >
                  {/* Day Number */}
                  <div className="mb-1 flex items-center justify-between">
                    <span
                      className={cn(
                        'inline-flex h-7 w-7 items-center justify-center rounded-full text-sm',
                        isToday(day)
                          ? 'bg-primary font-semibold text-primary-foreground'
                          : !isCurrentMonth(day) && viewMode === 'month'
                          ? 'text-muted-foreground'
                          : 'font-medium'
                      )}
                    >
                      {day.getDate()}
                    </span>
                    {dayReservations.length > 0 && (
                      <Badge variant="secondary" className="text-xs">
                        {dayReservations.length}
                      </Badge>
                    )}
                  </div>

                  {/* Reservations */}
                  <div className="space-y-1">
                    {dayReservations.slice(0, viewMode === 'week' ? 5 : 3).map((reservation) => (
                      <Link
                        key={reservation.id}
                        href={`/dashboard/reservations/${reservation.id}`}
                        className="block"
                      >
                        <div
                          className={cn(
                            'rounded px-2 py-1 text-xs text-white transition-opacity hover:opacity-80',
                            statusColors[reservation.status || 'pending']
                          )}
                        >
                          <div className="truncate font-medium">
                            {reservation.customer.firstName} {reservation.customer.lastName}
                          </div>
                          {viewMode === 'week' && (
                            <div className="truncate text-white/80">
                              {reservation.items
                                .map((item) => item.productSnapshot?.name || item.product?.name)
                                .join(', ')}
                            </div>
                          )}
                        </div>
                      </Link>
                    ))}
                    {dayReservations.length > (viewMode === 'week' ? 5 : 3) && (
                      <div className="text-xs text-muted-foreground">
                        {t('moreItems', { count: dayReservations.length - (viewMode === 'week' ? 5 : 3) })}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>

      {/* Legend */}
      <Card>
        <CardHeader className="py-3">
          <CardTitle className="text-sm font-medium">{t('legend')}</CardTitle>
        </CardHeader>
        <CardContent className="py-2">
          <div className="flex flex-wrap gap-4">
            {(Object.entries(statusLabels) as [ReservationStatus, string][]).map(
              ([status, label]) => (
                <div key={status} className="flex items-center gap-2">
                  <div
                    className={cn('h-3 w-3 rounded', statusColors[status])}
                  />
                  <span className="text-sm text-muted-foreground">{label}</span>
                </div>
              )
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
