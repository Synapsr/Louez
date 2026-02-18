'use client'

import Link from 'next/link'

import { Badge, Card, CardContent, CardHeader, CardTitle } from '@louez/ui'

type IntegrationCardProps = {
  href: string
  logoPath: string
  name: string
  description: string
  enabled: boolean
  connected: boolean
  enabledLabel: string
  disabledLabel: string
  connectedLabel: string
  statusLabel: string
}

export function IntegrationCard({
  href,
  logoPath,
  name,
  description,
  enabled,
  connected,
  enabledLabel,
  disabledLabel,
  connectedLabel,
  statusLabel,
}: IntegrationCardProps) {
  return (
    <Link href={href}>
      <Card className="h-full transition hover:border-primary/40 hover:bg-muted/40">
        <CardHeader className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="h-10 w-10 overflow-hidden rounded-md border bg-background p-1">
              <img
                src={logoPath}
                alt={name}
                className="h-full w-full object-contain"
              />
            </div>
            <div className="flex items-center gap-2">
              <Badge variant={enabled ? 'success' : 'secondary'}>
                {enabled ? enabledLabel : disabledLabel}
              </Badge>
              <Badge variant="outline">{statusLabel}</Badge>
            </div>
          </div>
          <CardTitle className="text-base">{name}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>{description}</p>
          {connected && <p className="font-medium text-foreground">{connectedLabel}</p>}
        </CardContent>
      </Card>
    </Link>
  )
}
