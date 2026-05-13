'use client';

import { AlertCircle } from 'lucide-react';

import { Alert, AlertDescription } from '@louez/ui';

interface LoginErrorAlertProps {
  message: string | null;
}

export const LoginErrorAlert = ({ message }: LoginErrorAlertProps) => {
  if (!message) {
    return null;
  }

  return (
    <Alert variant="error">
      <AlertCircle className="h-4 w-4" />
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
};
