'use client';

import * as React from 'react';

import { Check, ChevronsUpDown, Search } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Button } from '@louez/ui';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@louez/ui';
import { Popover, PopoverContent, PopoverTrigger } from '@louez/ui';
import { Avatar, AvatarFallback } from '@louez/ui';
import { cn } from '@louez/utils';

interface Customer {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
}

interface CustomerComboboxProps {
  customers: Customer[];
  value: string;
  onValueChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
}

export function CustomerCombobox({
  customers,
  value,
  onValueChange,
  disabled = false,
  className,
}: CustomerComboboxProps) {
  const t = useTranslations('common.customerSearch');
  const [open, setOpen] = React.useState(false);
  const [searchQuery, setSearchQuery] = React.useState('');
  const scrollPositionRef = React.useRef<{ x: number; y: number } | null>(null);

  const selectedCustomer = customers.find((customer) => customer.id === value);

  const filteredCustomers = React.useMemo(() => {
    if (!searchQuery) return customers;

    const query = searchQuery.toLowerCase();
    return customers.filter((customer) => {
      const fullName =
        `${customer.firstName} ${customer.lastName}`.toLowerCase();
      const email = customer.email.toLowerCase();
      const phone = customer.phone?.toLowerCase() || '';

      return (
        fullName.includes(query) ||
        email.includes(query) ||
        phone.includes(query)
      );
    });
  }, [customers, searchQuery]);

  const getInitials = (firstName: string, lastName: string) => {
    return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase();
  };

  const handleOpenChange = React.useCallback((nextOpen: boolean) => {
    if (nextOpen) {
      scrollPositionRef.current = { x: window.scrollX, y: window.scrollY };
      window.requestAnimationFrame(() => {
        const scrollPosition = scrollPositionRef.current;

        if (!scrollPosition) return;

        window.scrollTo(scrollPosition.x, scrollPosition.y);
      });
    } else {
      scrollPositionRef.current = null;
    }

    setOpen(nextOpen);
  }, []);

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className={cn(
              'h-auto min-h-[44px] w-full min-w-0 justify-between py-2',
              !value && 'text-muted-foreground',
              className,
            )}
            disabled={disabled}
          />
        }
      >
        {selectedCustomer ? (
          <div className="flex min-w-0 items-center gap-3">
            <Avatar className="h-8 w-8 shrink-0">
              <AvatarFallback className="bg-primary/10 text-primary text-xs">
                {getInitials(
                  selectedCustomer.firstName,
                  selectedCustomer.lastName,
                )}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 text-left">
              <p className="text-foreground truncate font-medium">
                {selectedCustomer.firstName} {selectedCustomer.lastName}
              </p>
              <p className="text-muted-foreground truncate text-xs">
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
      <PopoverContent
        className="max-h-[calc(100vh-2rem)] w-[calc(100vw-2rem)] max-w-(--available-width) p-0 pt-2 *:p-0 sm:w-[400px]"
        align="start"
      >
        <Command open items={filteredCustomers}>
          <CommandInput
            autoFocus={false}
            placeholder={t('placeholder')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          <CommandEmpty>{t('noResults')}</CommandEmpty>
          <CommandList className="max-h-[min(calc(100vh-12rem),22rem)]">
            <CommandGroup>
              {filteredCustomers.map((customer) => (
                <CommandItem
                  key={customer.id}
                  value={customer.id}
                  onClick={() => {
                    onValueChange(customer.id === value ? '' : customer.id);
                    setOpen(false);
                    setSearchQuery('');
                  }}
                  className="flex items-center gap-3 py-3"
                >
                  <Avatar className="h-8 w-8 shrink-0">
                    <AvatarFallback className="bg-primary/10 text-primary text-xs">
                      {getInitials(customer.firstName, customer.lastName)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">
                      {customer.firstName} {customer.lastName}
                    </p>
                    <p className="text-muted-foreground truncate text-xs">
                      {customer.email}
                    </p>
                  </div>
                  {customer.phone && (
                    <span className="text-muted-foreground max-w-24 truncate text-xs">
                      {customer.phone}
                    </span>
                  )}
                  <Check
                    className={cn(
                      'h-4 w-4 shrink-0',
                      value === customer.id ? 'opacity-100' : 'opacity-0',
                    )}
                  />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
