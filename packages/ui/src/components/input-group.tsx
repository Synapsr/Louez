'use client';

import type * as React from 'react';

import { type VariantProps, cva } from 'class-variance-authority';

import { cn } from '@louez/utils';

import { Button } from './button';
import { Input } from './input';
import { Textarea } from './textarea';

function InputGroup({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="input-group"
      role="group"
      className={cn(
        'group/input-group border-input ring-ring/24 dark:bg-input/32 bg-background has-[[data-slot=input-group-control]:focus-visible]:border-ring has-[[data-slot][aria-invalid=true]]:border-destructive/36 has-[[data-slot][aria-invalid=true]:focus-visible]:border-destructive/64 has-[[data-slot][aria-invalid=true]:focus-visible]:ring-destructive/16 dark:has-[[data-slot][aria-invalid=true]:focus-visible]:ring-destructive/24 relative flex min-h-9 w-full min-w-0 items-center rounded-lg border text-base transition-shadow outline-none not-dark:bg-clip-padding before:pointer-events-none before:absolute before:inset-0 before:rounded-[calc(var(--radius-lg)-1px)] has-disabled:opacity-64 has-[[data-slot=input-group-control]:focus-visible]:ring-[3px] has-[>textarea]:h-auto sm:text-sm',
        'not-has-disabled:not-has-[[data-slot=input-group-control]:focus-visible]:not-has-[[data-slot][aria-invalid=true]]:before:shadow-[0_1px_--theme(--color-black/4%)] dark:not-has-disabled:not-has-[[data-slot=input-group-control]:focus-visible]:not-has-[[data-slot][aria-invalid=true]]:before:shadow-[0_-1px_--theme(--color-white/6%)]',
        'has-[>[data-align=inline-end]]:[&_[data-slot=input-group-control]]:pr-0 has-[>[data-align=inline-start]]:[&_[data-slot=input-group-control]]:pl-0',
        'has-[>[data-align=block-start]]:h-auto has-[>[data-align=block-start]]:flex-col has-[>[data-align=block-start]]:[&_[data-slot=input-group-control]]:pb-3',
        'has-[>[data-align=block-end]]:h-auto has-[>[data-align=block-end]]:flex-col has-[>[data-align=block-end]]:[&_[data-slot=input-group-control]]:pt-3',
        className,
      )}
      {...props}
    />
  );
}

const inputGroupAddonVariants = cva(
  "text-muted-foreground flex h-auto cursor-text items-center justify-center gap-2 py-1.5 text-sm font-medium select-none group-data-[disabled=true]/input-group:opacity-50 [&>kbd]:rounded-[calc(var(--radius-lg)-5px)] [&>svg:not([class*='size-'])]:size-4",
  {
    defaultVariants: {
      align: 'inline-start',
    },
    variants: {
      align: {
        'block-end':
          'order-last w-full justify-start px-3 pb-3 group-has-[[data-slot=input-group-control]]/input-group:pb-2.5 [.border-t]:pt-3',
        'block-start':
          'order-first w-full justify-start px-3 pt-3 group-has-[[data-slot=input-group-control]]/input-group:pt-2.5 [.border-b]:pb-3',
        'inline-end':
          'order-last pr-3 has-[>button]:mr-[-0.45rem] has-[>kbd]:mr-[-0.35rem]',
        'inline-start':
          'order-first pl-3 has-[>button]:ml-[-0.45rem] has-[>kbd]:ml-[-0.35rem]',
      },
    },
  },
);

function InputGroupAddon({
  className,
  align = 'inline-start',
  ...props
}: React.ComponentProps<'div'> & VariantProps<typeof inputGroupAddonVariants>) {
  return (
    <div
      role="group"
      data-slot="input-group-addon"
      data-align={align}
      className={cn(inputGroupAddonVariants({ align }), className)}
      onClick={(event) => {
        if ((event.target as HTMLElement).closest('button')) {
          return;
        }

        event.currentTarget.parentElement
          ?.querySelector<HTMLElement>('[data-slot=input-group-control]')
          ?.focus();
      }}
      {...props}
    />
  );
}

const inputGroupButtonVariants = cva(
  'flex items-center gap-2 text-sm shadow-none',
  {
    defaultVariants: {
      size: 'xs',
    },
    variants: {
      size: {
        'icon-sm': 'size-8 rounded-md p-0 has-[>svg]:p-0',
        'icon-xs':
          'size-6 rounded-[calc(var(--radius-lg)-5px)] p-0 has-[>svg]:p-0',
        sm: 'h-8 gap-1.5 rounded-md px-2.5 has-[>svg]:px-2.5',
        xs: "h-6 gap-1 rounded-[calc(var(--radius-lg)-5px)] px-2 has-[>svg]:px-2 [&>svg:not([class*='size-'])]:size-3.5",
      },
    },
  },
);

function InputGroupButton({
  className,
  type = 'button',
  variant = 'ghost',
  size = 'xs',
  ...props
}: Omit<React.ComponentProps<typeof Button>, 'size'> &
  VariantProps<typeof inputGroupButtonVariants>) {
  return (
    <Button
      type={type}
      data-size={size}
      variant={variant}
      className={cn(inputGroupButtonVariants({ size }), className)}
      {...props}
    />
  );
}

function InputGroupText({ className, ...props }: React.ComponentProps<'span'>) {
  return (
    <span
      className={cn(
        'text-muted-foreground flex items-center gap-2 text-sm [&_svg]:pointer-events-none [&_svg:not([class*=size-])]:size-4',
        className,
      )}
      {...props}
    />
  );
}

function InputGroupInput({
  className,
  ...props
}: React.ComponentProps<typeof Input>) {
  return (
    <Input
      data-slot="input-group-control"
      unstyled
      className={cn(
        'flex-1 rounded-none border-0 bg-transparent shadow-none',
        className,
      )}
      {...props}
    />
  );
}

function InputGroupTextarea({
  className,
  ...props
}: React.ComponentProps<typeof Textarea>) {
  return (
    <Textarea
      data-slot="input-group-control"
      unstyled
      className={cn(
        'flex-1 resize-none rounded-none border-0 bg-transparent py-3 shadow-none dark:bg-transparent',
        className,
      )}
      {...props}
    />
  );
}

export {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupText,
  InputGroupTextarea,
};
