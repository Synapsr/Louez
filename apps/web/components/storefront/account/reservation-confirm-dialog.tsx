"use client";

import type { ReactNode } from "react";

import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  Dialog,
} from "@louez/ui";

interface ReservationConfirmDialogProps {
  open: boolean;
  modal?: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description: ReactNode;
  cancelLabel: ReactNode;
  confirmLabel: ReactNode;
  destructive?: boolean;
  isPending: boolean;
  onConfirm: () => void;
}

/** One confirmation dialog for cancelling, accepting and declining. */
export const ReservationConfirmDialog = ({
  open,
  modal = true,
  onOpenChange,
  title,
  description,
  cancelLabel,
  confirmLabel,
  destructive = false,
  isPending,
  onConfirm,
}: ReservationConfirmDialogProps) => {
  const Root = modal ? AlertDialog : Dialog;
  return (
    <Root
      open={open}
      onOpenChange={onOpenChange}
      {...(modal ? {} : { modal: false, mobileVariant: "dialog" })}
    >
      <AlertDialogContent
        initialFocus={modal ? undefined : false}
        finalFocus={modal ? undefined : false}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogClose render={<Button variant="outline" disabled={isPending} />}>
            {cancelLabel}
          </AlertDialogClose>
          <Button
            variant={destructive ? "destructive" : "default"}
            isPending={isPending}
            data-demo-target="portal-confirm-action"
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </Root>
  );
};
