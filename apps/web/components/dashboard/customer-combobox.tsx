'use client'

import * as React from 'react'
import { Check, ChevronsUpDown, User, Search } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { cn } from '@louez/utils'
import { Button } from '@louez/ui'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@louez/ui'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@louez/ui'
import { Avatar, AvatarFallback } from '@louez/ui'

interface Customer {
  id: string
  email: string
  firstName: string
  lastName: string
  phone: string | null
}

interface CustomerComboboxProps {
  customers: Customer[]
  value: string
  onValueChange: (value: string) => void
  disabled?: boolean
  className?: string
}

export function CustomerCombobox({
  customers,
  value,
  onValueChange,
  disabled = false,
  className,
}: CustomerComboboxProps) {
  const t = useTranslations('common.customerSearch')
  const [open, setOpen] = React.useState(false)
  const [searchQuery, setSearchQuery] = React.useState('')

  const selectedCustomer = customers.find((customer) => customer.id === value)

  const filteredCustomers = React.useMemo(() => {
    if (!searchQuery) return customers

    const query = searchQuery.toLowerCase()
    return customers.filter((customer) => {
      const fullName = `${customer.firstName} ${customer.lastName}`.toLowerCase()
      const email = customer.email.toLowerCase()
      const phone = customer.phone?.toLowerCase() || ''

      return fullName.includes(query) || email.includes(query) || phone.includes(query)
    })
  }, [customers, searchQuery])

  const getInitials = (firstName: string, lastName: string) => {
    return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase()
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn(
            'w-full justify-between h-auto min-h-[44px] py-2',
            !value && 'text-muted-foreground',
            className
          )}
          disabled={disabled}
        />}>
          {selectedCustomer ? (
            <div className="flex items-center gap-3">
              <Avatar className="h-8 w-8">
                <AvatarFallback className="bg-primary/10 text-primary text-xs">
                  {getInitials(selectedCustomer.firstName, selectedCustomer.lastName)}
                </AvatarFallback>
              </Avatar>
              <div className="text-left">
                <p className="font-medium text-foreground">
                  {selectedCustomer.firstName} {selectedCustomer.lastName}
                </p>
                <p className="text-xs text-muted-foreground">
                  {selectedCustomer.email}
                </p>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Search className="h-4 w-4" />
              <span>{t('selectCustomer')}</span>
            </div>
          )}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
      </PopoverTrigger>
      <PopoverContent className="w-[400px] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder={t('placeholder')}
            value={searchQuery}
            onValueChange={setSearchQuery}
          />
          <CommandList>
            <CommandEmpty>{t('noResults')}</CommandEmpty>
            <CommandGroup>
              {filteredCustomers.map((customer) => (
                <CommandItem
                  key={customer.id}
                  value={customer.id}
                  onClick={() => {
                    onValueChange(customer.id === value ? '' : customer.id)
                    setOpen(false)
                    setSearchQuery('')
                  }}
                  className="flex items-center gap-3 py-3"
                >
                  <Avatar className="h-8 w-8">
                    <AvatarFallback className="bg-primary/10 text-primary text-xs">
                      {getInitials(customer.firstName, customer.lastName)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">
                      {customer.firstName} {customer.lastName}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      {customer.email}
                    </p>
                  </div>
                  {customer.phone && (
                    <span className="text-xs text-muted-foreground">
                      {customer.phone}
                    </span>
                  )}
                  <Check
                    className={cn(
                      'h-4 w-4 shrink-0',
                      value === customer.id ? 'opacity-100' : 'opacity-0'
                    )}
                  />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
