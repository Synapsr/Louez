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
} from "@louez/ui";

interface ReservationConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description: ReactNode;
  cancelLabel: ReactNode;
  confirmLabel: ReactNode;
  destructive?: boolean;
  isPending: boolean;
  onConfirm: () => void;
}

/** One confirmation dialog for signing, accepting and declining. */
export const ReservationConfirmDialog = ({
  open,
  onOpenChange,
  title,
  description,
  cancelLabel,
  confirmLabel,
  destructive = false,
  isPending,
  onConfirm,
}: ReservationConfirmDialogProps) => (
  <AlertDialog open={open} onOpenChange={onOpenChange}>
    <AlertDialogContent>
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
          onClick={onConfirm}
        >
          {confirmLabel}
        </Button>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
);
