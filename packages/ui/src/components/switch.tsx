'use client';

import { Switch as SwitchPrimitive } from '@base-ui/react/switch';

import { cn } from '@louez/utils';

function Switch({ className, ...props }: SwitchPrimitive.Root.Props) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        'focus-visible:ring-ring focus-visible:ring-offset-background data-checked:bg-primary data-unchecked:bg-input inline-flex h-[calc(var(--thumb-size)+2px)] w-[calc(var(--thumb-size)*2-2px)] shrink-0 items-center rounded-full p-px transition-[background-color,box-shadow] duration-200 outline-none [--thumb-size:--spacing(5)] focus-visible:ring-2 focus-visible:ring-offset-1 data-disabled:opacity-64 sm:[--thumb-size:--spacing(4)]',
        className,
      )}
      data-slot="switch"
      {...props}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          'bg-background pointer-events-none block aspect-square h-full origin-left rounded-(--thumb-size) shadow-sm/5 will-change-transform [transition:translate_.15s,border-radius_.15s,scale_.1s_.1s,transform-origin_.15s] in-[[role=switch]:active,[data-slot=label]:active]:rounded-[var(--thumb-size)/calc(var(--thumb-size)*1.1)] in-[[role=switch]:active,[data-slot=label]:active]:not-data-disabled:scale-x-110 data-checked:origin-[var(--thumb-size)_50%] data-checked:translate-x-[calc(var(--thumb-size)-4px)]',
        )}
        data-slot="switch-thumb"
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
