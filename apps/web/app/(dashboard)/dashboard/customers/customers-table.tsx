'use client'

import Link from 'next/link'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'
import { useTranslations } from 'next-intl'
import { MoreHorizontal, Mail, Phone, MapPin, Eye, Pencil, Trash2, Users, Building2 } from 'lucide-react'
import { useState, useTransition } from 'react'

import { Button } from '@louez/ui'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@louez/ui'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@louez/ui'
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@louez/ui'
import { Badge } from '@louez/ui'
import { formatCurrency } from '@louez/utils'
import { deleteCustomer } from './actions'

interface Customer {
  id: string
  customerType: 'individual' | 'business'
  email: string
  firstName: string
  lastName: string
  companyName: string | null
  phone: string | null
  city: string | null
  createdAt: Date
  reservationCount: number
  totalSpent: string
  lastReservation: Date | null
}

interface CustomersTableProps {
  customers: Customer[]
}

export function CustomersTable({ customers }: CustomersTableProps) {
  const t = useTranslations('dashboard.customers')
  const tCommon = useTranslations('common')
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const handleDelete = () => {
    if (!deleteId) return

    startTransition(async () => {
      const result = await deleteCustomer(deleteId)
      if (result.error) {
        alert(result.error)
      }
      setDeleteId(null)
    })
  }

  if (customers.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-8 text-center">
        <Users className="h-12 w-12 text-muted-foreground/50" />
        <h3 className="mt-4 text-lg font-semibold">{t('noCustomers')}</h3>
        <p className="mt-2 text-sm text-muted-foreground">
          {t('noCustomersDescription')}
        </p>
        <Button render={<Link href="/dashboard/customers/new" />} className="mt-4">
          {t('addCustomer')}
        </Button>
      </div>
    )
  }

  return (
    <>
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('customer')}</TableHead>
              <TableHead>{t('contact')}</TableHead>
              <TableHead className="text-center">{t('totalReservations')}</TableHead>
              <TableHead className="text-right">{t('totalSpent')}</TableHead>
              <TableHead>{t('lastReservation')}</TableHead>
              <TableHead className="w-[50px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {customers.map((customer) => (
              <TableRow key={customer.id}>
                <TableCell>
                  <div className="space-y-1">
                    {customer.customerType === 'business' && customer.companyName ? (
                      <>
                        <Link
                          href={`/dashboard/customers/${customer.id}`}
                          className="font-medium hover:underline flex items-center gap-1.5"
                        >
                          <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                          {customer.companyName}
                        </Link>
                        <div className="text-sm text-muted-foreground">
                          {customer.firstName} {customer.lastName}
                        </div>
                      </>
                    ) : (
                      <Link
                        href={`/dashboard/customers/${customer.id}`}
                        className="font-medium hover:underline"
                      >
                        {customer.firstName} {customer.lastName}
                      </Link>
                    )}
                    {customer.city && (
                      <div className="flex items-center gap-1 text-sm text-muted-foreground">
                        <MapPin className="h-3 w-3" />
                        {customer.city}
                      </div>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="space-y-1">
                    <div className="flex items-center gap-1 text-sm">
                      <Mail className="h-3 w-3 text-muted-foreground" />
                      <a href={`mailto:${customer.email}`} className="hover:underline">
                        {customer.email}
                      </a>
                    </div>
                    {customer.phone && (
                      <div className="flex items-center gap-1 text-sm">
                        <Phone className="h-3 w-3 text-muted-foreground" />
                        <a href={`tel:${customer.phone}`} className="hover:underline">
                          {customer.phone}
                        </a>
                      </div>
                    )}
                  </div>
                </TableCell>
                <TableCell className="text-center">
                  <Badge variant="secondary">
                    {customer.reservationCount}
                  </Badge>
                </TableCell>
                <TableCell className="text-right font-medium">
                  {formatCurrency(parseFloat(customer.totalSpent))}
                </TableCell>
                <TableCell>
                  {customer.lastReservation ? (
                    <span className="text-sm text-muted-foreground">
                      {format(customer.lastReservation, 'dd MMM yyyy', { locale: fr })}
                    </span>
                  ) : (
                    <span className="text-sm text-muted-foreground">-</span>
                  )}
                </TableCell>
                <TableCell>
                  <DropdownMenu>
                    <DropdownMenuTrigger render={<Button variant="ghost" size="icon" />}>
                      <MoreHorizontal className="h-4 w-4" />
                      <span className="sr-only">{tCommon('actions')}</span>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem render={<Link href={`/dashboard/customers/${customer.id}`} />}>
                        <Eye className="mr-2 h-4 w-4" />
                        {t('viewDetails')}
                      </DropdownMenuItem>
                      <DropdownMenuItem render={<Link href={`/dashboard/customers/${customer.id}/edit`} />}>
                        <Pencil className="mr-2 h-4 w-4" />
                        {tCommon('edit')}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="text-destructive focus:text-destructive"
                        onClick={() => setDeleteId(customer.id)}
                        disabled={customer.reservationCount > 0}
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        {tCommon('delete')}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('deleteConfirm.title')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('deleteConfirm.description')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>{tCommon('cancel')}</AlertDialogClose>
            <AlertDialogClose
              render={<Button variant="destructive" />}
              onClick={handleDelete}
              disabled={isPending}
            >
              {isPending ? tCommon('loading') : tCommon('delete')}
            </AlertDialogClose>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
