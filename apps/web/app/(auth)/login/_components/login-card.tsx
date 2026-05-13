'use client';

import type { ReactNode } from 'react';

import { Card } from '@louez/ui';

interface LoginCardProps {
  children: ReactNode;
}

export const LoginCard = ({ children }: LoginCardProps) => {
  return (
    <Card className="border-0 *:py-0">{children}</Card>
  );
};
