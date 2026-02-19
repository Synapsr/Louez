'use client'

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@louez/ui'
import { formatStoreDateRange } from '@/lib/utils/store-date'
import { getCurrencySymbol } from '@louez/utils'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  CheckCircle,
  AlertCircle,
  Clock,
  Package,
  Ban,
  XCircle,
  MoreHorizontal,
  Loader2,
} from 'lucide-react'
import type { Reservation, ReservationStatus, SortField, SortDirection } from './reservations-types'
import { STATUS_CONFIG, getPaymentStatus, PAYMENT_STATUS_CLASSES } from './reservations-utils'

interface ReservationsTableViewProps {
  reservations: Reservation[]
  currency?: string
  timezone?: string
  currentSort?: SortField
  currentSortDirection?: SortDirection
  onSortChange: (field: SortField) => void
  loadingAction: string | null
  handleStatusChange: (
    e: React.MouseEvent,
    reservation: Reservation,
    newStatus: ReservationStatus
  ) => Promise<void>
  openRejectDialog: (e: React.MouseEvent, reservation: Reservation) => void
}

const STATUS_ICON_MAP: Record<ReservationStatus, typeof Clock> = {
  pending: Clock,
  confirmed: CheckCircle,
  ongoing: Package,
  completed: CheckCircle,
  cancelled: Ban,
  rejected: XCircle,
}

function SortableHead({
  field,
  currentSort,
  currentSortDirection,
  onSortChange,
  children,
  className,
}: {
  field: SortField
  currentSort?: SortField
  currentSortDirection?: SortDirection
  onSortChange: (field: SortField) => void
  children: React.ReactNode
  className?: string
}) {
  const isActive = currentSort === field
  const Icon = isActive
    ? currentSortDirection === 'asc' ? ArrowUp : ArrowDown
    : ArrowUpDown

  return (
    <TableHead className={className}>
      <Button
        variant="ghost"
        size="sm"
        className="-ml-3 h-8"
        onClick={() => onSortChange(field)}
      >
        {children}
        <Icon className="ml-2 h-3.5 w-3.5" />
      </Button>
    </TableHead>
  )
}

export function ReservationsTableView({
  reservations,
  currency = 'EUR',
  timezone,
  currentSort,
  currentSortDirection,
  onSortChange,
  loadingAction,
  handleStatusChange,
  openRejectDialog,
}: ReservationsTableViewProps) {
  const t = useTranslations('dashboard.reservations')
  const router = useRouter()
  const currencySymbol = getCurrencySymbol(currency)

  return (
    <TooltipProvider>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[100px]">{t('number')}</TableHead>
              <TableHead>{t('customer')}</TableHead>
              <TableHead className="hidden md:table-cell">{t('items')}</TableHead>
              <SortableHead
                field="startDate"
                currentSort={currentSort}
                currentSortDirection={currentSortDirection}
                onSortChange={onSortChange}
              >
                {t('dates')}
              </SortableHead>
              <SortableHead
                field="amount"
                currentSort={currentSort}
                currentSortDirection={currentSortDirection}
                onSortChange={onSortChange}
                className="text-right"
              >
                {t('total')}
              </SortableHead>
              <SortableHead
                field="status"
                currentSort={currentSort}
                currentSortDirection={currentSortDirection}
                onSortChange={onSortChange}
              >
                {t('paymentStatusLabel')}
              </SortableHead>
              <TableHead className="hidden lg:table-cell">{t('payments')}</TableHead>
              <TableHead className="w-[50px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {reservations.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="h-24 text-center text-muted-foreground">
                  {t('noReservations')}
                </TableCell>
              </TableRow>
            ) : (
              reservations.map((reservation) => {
                const status = (reservation.status ?? 'pending') as ReservationStatus
                const statusConfig = STATUS_CONFIG[status]
                const StatusIcon = STATUS_ICON_MAP[status]
                const paymentInfo = getPaymentStatus(reservation)
                const showPaymentStatus = !['cancelled', 'rejected'].includes(status)
                const hasPendingOnlinePayment = reservation.payments.some(
                  (p) => p.method === 'stripe' && p.status === 'pending' && p.type === 'rental'
                )
                const isLoading = loadingAction?.startsWith(reservation.id)
                const isPending = status === 'pending'
                const isConfirmed = status === 'confirmed'
                const isOngoing = status === 'ongoing'
                return (
                  <TableRow
                    key={reservation.id}
                    className="cursor-pointer"
                    onClick={() => router.push(`/dashboard/reservations/${reservation.id}`)}
                  >
                    {/* Number */}
                    <TableCell className="font-mono text-sm font-medium">
                      <Link
                        href={`/dashboard/reservations/${reservation.id}`}
                        className="hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        #{reservation.number}
                      </Link>
                    </TableCell>

                    {/* Customer */}
                    <TableCell>
                      {reservation.customer.firstName} {reservation.customer.lastName}
                    </TableCell>

                    {/* Items (hidden on mobile) */}
                    <TableCell className="hidden md:table-cell">
                      <Tooltip>
                        <TooltipTrigger render={<span className="cursor-help" />}>
                          <span className="text-muted-foreground">
                            {reservation.items[0].quantity > 1 && (
                              <span className="font-medium text-foreground">{reservation.items[0].quantity}× </span>
                            )}
                            {reservation.items[0].productSnapshot.name}
                            {reservation.items.length > 1 && (
                              <span className="ml-1 text-xs text-muted-foreground/70">
                                +{reservation.items.length - 1}
                              </span>
                            )}
                          </span>
                        </TooltipTrigger>
                        <TooltipContent side="bottom" className="max-w-[300px]">
                          <ul className="space-y-2 text-xs">
                            {reservation.items.map((item) => {
                              const attrs = item.selectedAttributes
                              const hasAttrs = attrs && Object.keys(attrs).length > 0
                              return (
                                <li key={item.id}>
                                  <div className="flex justify-between gap-4">
                                    <span className="font-medium">{item.productSnapshot.name}</span>
                                    <span className="shrink-0 text-muted-foreground">×{item.quantity}</span>
                                  </div>
                                  {hasAttrs && (
                                    <div className="mt-0.5 flex flex-wrap gap-1">
                                      {Object.entries(attrs).map(([key, value]) => (
                                        <span
                                          key={key}
                                          className="inline-flex items-center rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
                                        >
                                          {key}: {value}
                                        </span>
                                      ))}
                                    </div>
                                  )}
                                </li>
                              )
                            })}
                          </ul>
                        </TooltipContent>
                      </Tooltip>
                    </TableCell>

                    {/* Dates */}
                    <TableCell className="whitespace-nowrap text-sm">
                      {formatStoreDateRange(reservation.startDate, reservation.endDate, timezone)}
                    </TableCell>

                    {/* Amount */}
                    <TableCell className="text-right font-medium">
                      {parseFloat(reservation.totalAmount).toFixed(2)} {currencySymbol}
                    </TableCell>

                    {/* Status */}
                    <TableCell>
                      <Badge
                        variant="secondary"
                        className={`gap-1 ${statusConfig.bgClass} ${statusConfig.className} border-0`}
                      >
                        <StatusIcon className="h-3 w-3" />
                        {t(`status.${status}`)}
                      </Badge>
                    </TableCell>

                    {/* Payment (hidden on small screens) */}
                    <TableCell className="hidden lg:table-cell">
                      {showPaymentStatus && (
                        <Tooltip>
                          <TooltipTrigger render={
                            <Badge
                              variant="secondary"
                              className={`gap-1 text-xs ${PAYMENT_STATUS_CLASSES[paymentInfo.status]}`}
                            />
                          }>
                            {paymentInfo.status === 'paid' ? (
                              <CheckCircle className="h-3 w-3" />
                            ) : (
                              <AlertCircle className="h-3 w-3" />
                            )}
                            {t(`paymentStatus.${paymentInfo.status}`)}
                          </TooltipTrigger>
                          <TooltipContent>
                            <div className="text-xs">
                              <p>{paymentInfo.totalPaid.toFixed(2)} {currencySymbol} / {paymentInfo.totalDue.toFixed(2)} {currencySymbol}</p>
                              {paymentInfo.status !== 'paid' && (
                                <p className="text-red-400">
                                  {t('payment.unpaidWarning', {
                                    formattedAmount: `${(paymentInfo.totalDue - paymentInfo.totalPaid).toFixed(2)} ${currencySymbol}`,
                                  })}
                                </p>
                              )}
                            </div>
                          </TooltipContent>
                        </Tooltip>
                      )}
                    </TableCell>

                    {/* Actions */}
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <DropdownMenu>
                        <DropdownMenuTrigger render={
                          <Button variant="ghost" size="icon" className="h-8 w-8" disabled={!!isLoading} />
                        }>
                          {isLoading ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <MoreHorizontal className="h-4 w-4" />
                          )}
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {/* View details — always available */}
                          <DropdownMenuItem render={<Link href={`/dashboard/reservations/${reservation.id}`} />}>
                            {t('viewDetails')}
                          </DropdownMenuItem>

                          {/* Pending actions */}
                          {isPending && !hasPendingOnlinePayment && (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                onClick={(e) => handleStatusChange(e, reservation, 'confirmed')}
                              >
                                <CheckCircle className="mr-2 h-4 w-4" />
                                {t('actions.accept')}
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={(e) => openRejectDialog(e, reservation)}
                                className="text-destructive focus:text-destructive"
                              >
                                <XCircle className="mr-2 h-4 w-4" />
                                {t('actions.reject')}
                              </DropdownMenuItem>
                            </>
                          )}

                          {isPending && hasPendingOnlinePayment && (
                            <>
                              <DropdownMenuSeparator />
                              <div className="px-2 py-1.5 text-sm text-muted-foreground">
                                {t('paymentInProgress')}
                              </div>
                            </>
                          )}

                          {/* Confirmed actions */}
                          {isConfirmed && (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                onClick={(e) => handleStatusChange(e, reservation, 'ongoing')}
                              >
                                <Package className="mr-2 h-4 w-4" />
                                {t('actions.markPickedUp')}
                              </DropdownMenuItem>
                            </>
                          )}

                          {/* Ongoing actions */}
                          {isOngoing && (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                onClick={(e) => handleStatusChange(e, reservation, 'completed')}
                              >
                                <CheckCircle className="mr-2 h-4 w-4" />
                                {t('actions.markReturned')}
                              </DropdownMenuItem>
                            </>
                          )}

                          {/* Cancel is available from the detail page */}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>
    </TooltipProvider>
  )
}
