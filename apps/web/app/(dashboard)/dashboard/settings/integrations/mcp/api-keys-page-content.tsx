'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import {
  Check,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  Plus,
  Terminal,
  Trash2,
  AlertTriangle,
} from 'lucide-react'
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Separator,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  toastManager,
} from '@louez/ui'
import type { ApiKeyPermissions } from '@louez/db/schema'

import { orpc } from '@/lib/orpc/react'

// ── Types ────────────────────────────────────────────────────────────────

type ApiKeyItem = {
  id: string
  name: string
  keyPrefix: string
  permissions: ApiKeyPermissions
  lastUsedAt: Date | null
  expiresAt: Date | null
  createdAt: Date
  revokedAt: Date | null
}

// ── Permission presets ───────────────────────────────────────────────────

const PERMISSION_PRESETS = {
  full: {
    reservations: 'write',
    products: 'write',
    customers: 'write',
    categories: 'write',
    payments: 'write',
    analytics: 'read',
    settings: 'write',
  },
  readOnly: {
    reservations: 'read',
    products: 'read',
    customers: 'read',
    categories: 'read',
    payments: 'read',
    analytics: 'read',
    settings: 'read',
  },
  operations: {
    reservations: 'write',
    products: 'read',
    customers: 'write',
    categories: 'read',
    payments: 'write',
    analytics: 'read',
    settings: 'none',
  },
} as const satisfies Record<string, ApiKeyPermissions>

type PresetKey = keyof typeof PERMISSION_PRESETS

const DOMAINS = [
  'reservations',
  'products',
  'customers',
  'categories',
  'payments',
  'analytics',
  'settings',
] as const

// ── Component ────────────────────────────────────────────────────────────

export function ApiKeysPageContent() {
  const t = useTranslations('dashboard.settings.api')
  const queryClient = useQueryClient()

  const [showCreate, setShowCreate] = useState(false)
  const [newKeyName, setNewKeyName] = useState('')
  const [selectedPreset, setSelectedPreset] = useState<PresetKey>('full')
  const [permissions, setPermissions] = useState<ApiKeyPermissions>(PERMISSION_PRESETS.full)
  const [createdKey, setCreatedKey] = useState<string | null>(null)
  const [copiedKey, setCopiedKey] = useState(false)
  const [showMcpConfig, setShowMcpConfig] = useState(false)
  const [copiedMcp, setCopiedMcp] = useState(false)
  const [confirmRevoke, setConfirmRevoke] = useState<string | null>(null)

  const keysQuery = useQuery(
    orpc.dashboard.apiKeys.list.queryOptions({ input: {} })
  )

  const createMutation = useMutation({
    ...orpc.dashboard.apiKeys.create.mutationOptions(),
    onSuccess: (data: { id: string; key: string; prefix: string }) => {
      setCreatedKey(data.key)
      setNewKeyName('')
      setSelectedPreset('full')
      setPermissions(PERMISSION_PRESETS.full)
      queryClient.invalidateQueries({
        queryKey: orpc.dashboard.apiKeys.list.queryOptions({ input: {} }).queryKey,
      })
    },
    onError: (error: Error) => {
      toastManager.add({ title: error.message, type: 'error' })
    },
  })

  const revokeMutation = useMutation({
    ...orpc.dashboard.apiKeys.revoke.mutationOptions(),
    onSuccess: () => {
      toastManager.add({ title: t('keyRevoked'), type: 'success' })
      setConfirmRevoke(null)
      queryClient.invalidateQueries({
        queryKey: orpc.dashboard.apiKeys.list.queryOptions({ input: {} }).queryKey,
      })
    },
    onError: (error: Error) => {
      toastManager.add({ title: error.message, type: 'error' })
    },
  })

  const handleCopy = async (text: string, setter: (v: boolean) => void) => {
    try {
      await navigator.clipboard.writeText(text)
      setter(true)
      setTimeout(() => setter(false), 2000)
    } catch {
      toastManager.add({ title: 'Failed to copy to clipboard', type: 'error' })
    }
  }

  const handlePresetChange = (preset: PresetKey) => {
    setSelectedPreset(preset)
    setPermissions(PERMISSION_PRESETS[preset])
  }

  const mcpConfig = JSON.stringify(
    {
      mcpServers: {
        louez: {
          url: `${typeof window !== 'undefined' ? window.location.origin : ''}/api/mcp`,
          headers: { Authorization: 'Bearer <YOUR_API_KEY>' },
        },
      },
    },
    null,
    2
  )

  const keys = (keysQuery.data ?? []) as ApiKeyItem[]

  return (
    <div className="space-y-8">
      {/* ── API Keys ──────────────────────────────────────────────────── */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <h3 className="text-sm font-medium">{t('keysTitle')}</h3>
            <p className="text-muted-foreground text-sm">{t('keysDescription')}</p>
          </div>
          <Button size="sm" onClick={() => setShowCreate(true)}>
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            {t('createKey')}
          </Button>
        </div>

        {keysQuery.isLoading ? (
          <div className="space-y-2">
            {[1, 2].map((i) => (
              <Skeleton key={i} className="h-16 w-full rounded-lg" />
            ))}
          </div>
        ) : keys.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-10">
              <KeyRound className="text-muted-foreground mb-3 h-8 w-8" />
              <p className="text-muted-foreground text-sm">{t('noKeys')}</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {keys.map((apiKey) => (
              <Card key={apiKey.id}>
                <CardContent className="flex items-center justify-between py-3">
                  <div className="flex items-center gap-3">
                    <KeyRound className="text-muted-foreground h-4 w-4 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{apiKey.name}</p>
                      <p className="text-muted-foreground font-mono text-xs">
                        {apiKey.keyPrefix}...
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="hidden flex-wrap gap-1 sm:flex">
                      {DOMAINS.filter(
                        (d) => apiKey.permissions[d] !== 'none'
                      ).map((d) => (
                        <Badge key={d} variant="secondary" className="text-xs">
                          {d}:{apiKey.permissions[d]}
                        </Badge>
                      ))}
                    </div>
                    {apiKey.lastUsedAt && (
                      <span className="text-muted-foreground hidden text-xs lg:block">
                        {t('lastUsed')}{' '}
                        {new Date(apiKey.lastUsedAt).toLocaleDateString()}
                      </span>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-destructive hover:text-destructive h-8 w-8"
                      onClick={() => setConfirmRevoke(apiKey.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      <Separator />

      {/* ── Endpoints ─────────────────────────────────────────────────── */}
      <div className="space-y-4">
        <div className="space-y-1">
          <h3 className="text-sm font-medium">{t('endpointsTitle')}</h3>
          <p className="text-muted-foreground text-sm">{t('endpointsDescription')}</p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <Terminal className="h-4 w-4" />
                <CardTitle className="text-sm">{t('mcpServerTitle')}</CardTitle>
              </div>
              <CardDescription className="text-xs">{t('mcpDescription')}</CardDescription>
            </CardHeader>
            <CardContent>
              <code className="bg-muted rounded px-2 py-1 text-xs">
                {typeof window !== 'undefined' ? window.location.origin : ''}/api/mcp
              </code>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <Terminal className="h-4 w-4" />
                <CardTitle className="text-sm">{t('stdioTitle')}</CardTitle>
              </div>
              <CardDescription className="text-xs">{t('stdioDescription')}</CardDescription>
            </CardHeader>
            <CardContent>
              <code className="bg-muted rounded px-2 py-1 text-xs">
                npx tsx packages/mcp/bin/louez-mcp.ts
              </code>
            </CardContent>
          </Card>
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowMcpConfig(!showMcpConfig)}
        >
          {showMcpConfig ? (
            <EyeOff className="mr-1.5 h-3.5 w-3.5" />
          ) : (
            <Eye className="mr-1.5 h-3.5 w-3.5" />
          )}
          {t('showMcpConfig')}
        </Button>

        {showMcpConfig && (
          <Card>
            <CardContent className="relative pt-4">
              <p className="text-muted-foreground mb-2 text-xs">{t('mcpConfigHint')}</p>
              <pre className="bg-muted overflow-x-auto rounded-lg p-4 text-xs">
                {mcpConfig}
              </pre>
              <Button
                variant="ghost"
                size="icon"
                className="absolute right-6 top-6 h-7 w-7"
                onClick={() => handleCopy(mcpConfig, setCopiedMcp)}
              >
                {copiedMcp ? (
                  <Check className="h-3.5 w-3.5" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
              </Button>
            </CardContent>
          </Card>
        )}
      </div>

      {/* ── Create Key Dialog ─────────────────────────────────────────── */}
      <Dialog
        open={showCreate}
        onOpenChange={(open) => {
          setShowCreate(open)
          if (!open) {
            setCreatedKey(null)
            setCopiedKey(false)
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          {createdKey ? (
            <>
              <DialogHeader>
                <DialogTitle>{t('keyCreatedTitle')}</DialogTitle>
                <DialogDescription>{t('keyCreatedDescription')}</DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <div className="bg-muted flex items-center gap-2 rounded-lg p-3">
                  <code className="flex-1 break-all text-sm">{createdKey}</code>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0"
                    onClick={() => handleCopy(createdKey, setCopiedKey)}
                  >
                    {copiedKey ? (
                      <Check className="h-4 w-4" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </Button>
                </div>
                <div className="bg-destructive/10 text-destructive flex items-start gap-2 rounded-lg p-3 text-sm">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <p>{t('keyCreatedWarning')}</p>
                </div>
              </div>
              <DialogFooter>
                <Button
                  onClick={() => {
                    setShowCreate(false)
                    setCreatedKey(null)
                  }}
                >
                  {t('done')}
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>{t('createKeyTitle')}</DialogTitle>
                <DialogDescription>{t('createKeyDescription')}</DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>{t('keyName')}</Label>
                  <Input
                    placeholder={t('keyNamePlaceholder')}
                    value={newKeyName}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                      setNewKeyName(e.target.value)
                    }
                    autoFocus
                  />
                </div>

                <div className="space-y-2">
                  <Label>{t('permissionsPreset')}</Label>
                  <Select value={selectedPreset} onValueChange={(v) => handlePresetChange(v as PresetKey)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="full">{t('presetFull')}</SelectItem>
                      <SelectItem value="readOnly">{t('presetReadOnly')}</SelectItem>
                      <SelectItem value="operations">{t('presetOperations')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>{t('permissionsDetail')}</Label>
                  <div className="grid grid-cols-1 gap-1.5">
                    {DOMAINS.map((domain) => (
                      <div
                        key={domain}
                        className="flex items-center justify-between rounded-md border px-3 py-1.5"
                      >
                        <span className="text-sm capitalize">{domain}</span>
                        <Badge
                          variant={
                            permissions[domain] === 'write'
                              ? 'default'
                              : permissions[domain] === 'read'
                                ? 'secondary'
                                : 'outline'
                          }
                          className="text-xs"
                        >
                          {permissions[domain]}
                        </Badge>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setShowCreate(false)}>
                  {t('cancel')}
                </Button>
                <Button
                  onClick={() =>
                    createMutation.mutate({
                      name: newKeyName,
                      permissions,
                    })
                  }
                  disabled={!newKeyName.trim() || createMutation.isPending}
                >
                  {t('create')}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Revoke Confirmation Dialog ────────────────────────────────── */}
      <Dialog open={!!confirmRevoke} onOpenChange={() => setConfirmRevoke(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('revokeTitle')}</DialogTitle>
            <DialogDescription>{t('revokeDescription')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmRevoke(null)}>
              {t('cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (confirmRevoke) revokeMutation.mutate({ keyId: confirmRevoke })
              }}
              disabled={revokeMutation.isPending}
            >
              {t('revokeConfirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
