'use client';

import type * as React from 'react';

import { mergeProps } from '@base-ui/react/merge-props';
import { useRender } from '@base-ui/react/use-render';
import { type VariantProps, cva } from 'class-variance-authority';

import { cn } from '@louez/utils';

const buttonVariants = cva(
  "focus-visible:ring-ring focus-visible:ring-offset-background relative inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-lg border text-base font-medium whitespace-nowrap transition-shadow outline-none before:pointer-events-none before:absolute before:inset-0 before:rounded-[calc(var(--radius-lg)-1px)] focus-visible:ring-2 focus-visible:ring-offset-1 disabled:pointer-events-none disabled:opacity-64 sm:text-sm pointer-coarse:after:absolute pointer-coarse:after:size-full pointer-coarse:after:min-h-11 pointer-coarse:after:min-w-11 [&_svg]:pointer-events-none [&_svg]:-mx-0.5 [&_svg]:shrink-0 [&_svg:not([class*='opacity-'])]:opacity-80 [&_svg:not([class*='size-'])]:size-4.5 sm:[&_svg:not([class*='size-'])]:size-4",
  {
    defaultVariants: {
      size: 'default',
      variant: 'default',
    },
    variants: {
      size: {
        default: 'h-9 px-[calc(var(--spacing)*3_-_1px)]',
        icon: 'size-9 sm:size-8',
        'icon-lg': 'size-10 sm:size-9',
        'icon-sm': 'size-8 sm:size-7',
        'icon-xl':
          "size-11 sm:size-10 [&_svg:not([class*='size-'])]:size-5 sm:[&_svg:not([class*='size-'])]:size-4.5",
        'icon-xs':
          "size-7 rounded-md before:rounded-[calc(var(--radius-md)-1px)] sm:size-6 not-in-data-[slot=input-group]:[&_svg:not([class*='size-'])]:size-4 sm:not-in-data-[slot=input-group]:[&_svg:not([class*='size-'])]:size-3.5",
        lg: 'h-10 px-[calc(var(--spacing)*3.5_-_1px)]',
        sm: 'h-8 gap-1.5 px-[calc(var(--spacing)*2.5_-_1px)]',
        xl: "h-11 px-[calc(var(--spacing)*4_-_1px)] text-lg [&_svg:not([class*='size-'])]:size-5 sm:[&_svg:not([class*='size-'])]:size-4.5",
        xs: "h-7 gap-1 rounded-md px-[calc(var(--spacing)*2_-_1px)] text-sm before:rounded-[calc(var(--radius-md)-1px)] [&_svg:not([class*='size-'])]:size-4 sm:[&_svg:not([class*='size-'])]:size-3.5",
      },
      variant: {
        default:
          'border-primary bg-primary text-primary-foreground shadow-primary/24 [:hover,[data-pressed]]:bg-primary/90 shadow-xs not-disabled:inset-shadow-[0_1px_--theme(--color-white/16%)] [:active,[data-pressed]]:inset-shadow-[0_1px_--theme(--color-black/8%)] [:disabled,:active,[data-pressed]]:shadow-none',
        destructive:
          'border-destructive bg-destructive shadow-destructive/24 [:hover,[data-pressed]]:bg-destructive/90 text-white shadow-xs not-disabled:inset-shadow-[0_1px_--theme(--color-white/16%)] [:active,[data-pressed]]:inset-shadow-[0_1px_--theme(--color-black/8%)] [:disabled,:active,[data-pressed]]:shadow-none',
        'destructive-outline':
          'border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700 dark:border-red-800 dark:hover:bg-red-950 [:hover,[data-pressed]]:border-destructive/32 [:hover,[data-pressed]]:bg-destructive/4 shadow-xs/5 not-dark:bg-clip-padding not-disabled:not-active:not-data-pressed:before:shadow-[0_1px_--theme(--color-black/4%)] dark:not-disabled:before:shadow-[0_-1px_--theme(--color-white/2%)] dark:not-disabled:not-active:not-data-pressed:before:shadow-[0_-1px_--theme(--color-white/6%)] [:disabled,:active,[data-pressed]]:shadow-none',
        ghost:
          'text-foreground data-pressed:bg-accent [:hover,[data-pressed]]:bg-accent border-transparent',
        link: 'border-transparent underline-offset-4 [:hover,[data-pressed]]:underline',
        outline:
          'border-input bg-popover text-foreground dark:bg-input/32 [:hover,[data-pressed]]:bg-accent/50 dark:[:hover,[data-pressed]]:bg-input/64 shadow-xs/5 not-dark:bg-clip-padding not-disabled:not-active:not-data-pressed:before:shadow-[0_1px_--theme(--color-black/4%)] dark:not-disabled:before:shadow-[0_-1px_--theme(--color-white/2%)] dark:not-disabled:not-active:not-data-pressed:before:shadow-[0_-1px_--theme(--color-white/6%)] [:disabled,:active,[data-pressed]]:shadow-none',
        secondary:
          'bg-secondary text-secondary-foreground [:active,[data-pressed]]:bg-secondary/80 [:hover,[data-pressed]]:bg-secondary/90 border-transparent',
        success:
          'border-green-600 bg-green-600 shadow-green-600/24 [:hover,[data-pressed]]:bg-green-700 text-white shadow-xs not-disabled:inset-shadow-[0_1px_--theme(--color-white/16%)] [:active,[data-pressed]]:inset-shadow-[0_1px_--theme(--color-black/8%)] [:disabled,:active,[data-pressed]]:shadow-none',
        'success-outline':
          'border-input bg-popover text-emerald-700 dark:text-emerald-400 dark:bg-input/32 [:hover,[data-pressed]]:border-emerald-500/32 [:hover,[data-pressed]]:bg-emerald-500/4 shadow-xs/5 not-dark:bg-clip-padding not-disabled:not-active:not-data-pressed:before:shadow-[0_1px_--theme(--color-black/4%)] dark:not-disabled:before:shadow-[0_-1px_--theme(--color-white/2%)] dark:not-disabled:not-active:not-data-pressed:before:shadow-[0_-1px_--theme(--color-white/6%)] [:disabled,:active,[data-pressed]]:shadow-none',
        'warning-outline':
          'border-input bg-popover text-amber-700 dark:text-amber-400 dark:bg-input/32 [:hover,[data-pressed]]:border-amber-500/32 [:hover,[data-pressed]]:bg-amber-500/4 shadow-xs/5 not-dark:bg-clip-padding not-disabled:not-active:not-data-pressed:before:shadow-[0_1px_--theme(--color-black/4%)] dark:not-disabled:before:shadow-[0_-1px_--theme(--color-white/2%)] dark:not-disabled:not-active:not-data-pressed:before:shadow-[0_-1px_--theme(--color-white/6%)] [:disabled,:active,[data-pressed]]:shadow-none',
      },
    },
  },
);

interface ButtonProps extends useRender.ComponentProps<'button'> {
  variant?: VariantProps<typeof buttonVariants>['variant'];
  size?: VariantProps<typeof buttonVariants>['size'];
}

function Button({ className, variant, size, render, ...props }: ButtonProps) {
  const typeValue: React.ButtonHTMLAttributes<HTMLButtonElement>['type'] =
    render ? undefined : 'button';

  const defaultProps = {
    className: cn(buttonVariants({ className, size, variant })),
    'data-slot': 'button',
    type: typeValue,
  };

  return useRender({
    defaultTagName: 'button',
    props: mergeProps<'button'>(defaultProps, props),
    render,
  });
}

export { Button, buttonVariants };
