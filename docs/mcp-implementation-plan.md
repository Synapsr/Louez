# Plan d'implémentation MCP — Louez

> Serveur MCP (Model Context Protocol) pour permettre aux loueurs de gérer entièrement leur business de location via un LLM.

---

## 1. Vue d'ensemble

### 1.1. Objectif

Créer un package `@louez/mcp` dans le monorepo qui expose un serveur MCP complet permettant aux loueurs (propriétaires de boutique) de piloter leur activité de location à travers un assistant IA — Claude, GPT, ou tout client MCP compatible.

### 1.2. Pourquoi un MCP ?

Le MCP (Model Context Protocol) est le standard ouvert pour connecter des LLM à des sources de données et outils externes. Pour Louez, cela signifie :

- **Gestion conversationnelle** : un loueur peut demander « Montre-moi les réservations en retard cette semaine » ou « Crée un produit vélo électrique à 45€/jour »
- **Automatisation** : création de réservations manuelles, gestion des paiements, mise à jour de statuts — tout via le langage naturel
- **Extensibilité open-source** : un MCP bien architecturé permet à la communauté de construire des intégrations personnalisées

### 1.3. Principes d'architecture

| Principe | Détail |
|----------|--------|
| **Réutilisation maximale** | S'appuyer sur les services `@louez/api`, le schéma `@louez/db` et les validations `@louez/validations` existants |
| **Isolation multi-tenant** | Chaque session MCP est scoped à un `storeId` — aucune fuite de données cross-tenant |
| **Sécurité first** | Authentification par API key (hachée, stockée en DB), permissions owner/member respectées |
| **Exemplaire OSS** | Code documenté, typé, testé, suivant les conventions du projet |
| **SDK officiel** | Utilisation du `@modelcontextprotocol/sdk` v1.x (stable, recommandé pour la production) |

---

## 2. Architecture technique

### 2.1. Position dans le monorepo

```
louez/
├── packages/
│   ├── mcp/                          # @louez/mcp — NOUVEAU
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── src/
│   │   │   ├── index.ts              # Point d'entrée, export du serveur
│   │   │   ├── server.ts             # McpServer setup + registration
│   │   │   ├── auth/
│   │   │   │   ├── api-keys.ts       # Validation et résolution d'API keys
│   │   │   │   └── context.ts        # Contexte de session MCP (store, user, permissions)
│   │   │   ├── tools/
│   │   │   │   ├── index.ts          # Enregistrement centralisé de tous les tools
│   │   │   │   ├── reservations.ts   # CRUD réservations + actions workflow
│   │   │   │   ├── products.ts       # CRUD produits + pricing
│   │   │   │   ├── customers.ts      # CRUD clients
│   │   │   │   ├── categories.ts     # CRUD catégories
│   │   │   │   ├── payments.ts       # Enregistrement et suivi paiements
│   │   │   │   ├── analytics.ts      # Consultation stats et métriques
│   │   │   │   └── settings.ts       # Configuration boutique
│   │   │   ├── resources/
│   │   │   │   ├── index.ts          # Enregistrement centralisé des resources
│   │   │   │   ├── store.ts          # Infos boutique courante
│   │   │   │   ├── catalog.ts        # Catalogue produits (lecture)
│   │   │   │   └── dashboard.ts      # Métriques dashboard (lecture)
│   │   │   ├── prompts/
│   │   │   │   ├── index.ts          # Enregistrement centralisé des prompts
│   │   │   │   └── templates.ts      # Prompts métier pré-configurés
│   │   │   └── utils/
│   │   │       ├── formatting.ts     # Formatage monétaire, dates, etc.
│   │   │       └── errors.ts         # Mapping erreurs MCP standardisé
│   │   └── bin/
│   │       └── louez-mcp.ts          # CLI entry point (stdio transport)
│   ├── db/                           # Modifié — ajout table api_keys
│   ├── api/                          # Existant — services réutilisés
│   └── ...
```

### 2.2. Dépendances

```json
{
  "name": "@louez/mcp",
  "version": "0.1.0",
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./stdio": "./bin/louez-mcp.ts"
  },
  "bin": {
    "louez-mcp": "./bin/louez-mcp.ts"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.12",
    "@louez/db": "workspace:*",
    "@louez/validations": "workspace:*",
    "@louez/utils": "workspace:*",
    "zod": "^3.24"
  },
  "devDependencies": {
    "@louez/config": "workspace:*",
    "typescript": "^5.8"
  }
}
```

### 2.3. Transports supportés

| Transport | Usage | Priorité |
|-----------|-------|----------|
| **stdio** | Usage local avec Claude Desktop, Claude Code, Cursor, etc. | Phase 1 |
| **Streamable HTTP** | Usage remote (déploiement serveur, multi-utilisateur) | Phase 2 |

### 2.4. Diagramme de flux

```
┌──────────────┐     stdio/HTTP      ┌──────────────────┐
│  Client MCP  │ ◄──────────────────► │  @louez/mcp      │
│  (Claude,    │                      │  McpServer        │
│   Cursor,    │                      │                   │
│   etc.)      │                      │  ┌─────────────┐  │
└──────────────┘                      │  │ Auth Layer  │  │
                                      │  │ (API Key →  │  │
                                      │  │  Store ctx) │  │
                                      │  └──────┬──────┘  │
                                      │         │         │
                                      │  ┌──────▼──────┐  │
                                      │  │ Tools /     │  │
                                      │  │ Resources / │  │
                                      │  │ Prompts     │  │
                                      │  └──────┬──────┘  │
                                      │         │         │
                                      └─────────┼─────────┘
                                                │
                                      ┌─────────▼─────────┐
                                      │   @louez/db        │
                                      │   (Drizzle + MySQL) │
                                      └────────────────────┘
```

---

## 3. Authentification et sécurité

### 3.1. Schéma API Keys

Ajout d'une nouvelle table dans `packages/db/src/schema.ts` :

```typescript
export const apiKeys = mysqlTable(
  'api_keys',
  {
    id: id(),
    storeId: varchar('store_id', { length: 21 }).notNull(),
    userId: varchar('user_id', { length: 21 }).notNull(), // Créateur de la clé

    name: varchar('name', { length: 100 }).notNull(),         // "Mon intégration MCP"
    keyPrefix: varchar('key_prefix', { length: 8 }).notNull(), // "lz_abc12" (pour identification)
    keyHash: varchar('key_hash', { length: 64 }).notNull(),    // SHA-256 de la clé complète

    // Permissions
    permissions: json('permissions').$type<ApiKeyPermissions>().notNull(),

    // Metadata
    lastUsedAt: timestamp('last_used_at', { mode: 'date' }),
    expiresAt: timestamp('expires_at', { mode: 'date' }),
    revokedAt: timestamp('revoked_at', { mode: 'date' }),
    createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
  },
  (table) => ({
    storeIdx: index('api_keys_store_idx').on(table.storeId),
    prefixIdx: index('api_keys_prefix_idx').on(table.keyPrefix),
  })
)
```

### 3.2. Type de permissions API Key

```typescript
// Dans @louez/types
export interface ApiKeyPermissions {
  // Granulaire par domaine
  reservations: 'none' | 'read' | 'write'
  products: 'none' | 'read' | 'write'
  customers: 'none' | 'read' | 'write'
  categories: 'none' | 'read' | 'write'
  payments: 'none' | 'read' | 'write'
  analytics: 'none' | 'read'
  settings: 'none' | 'read' | 'write'
}
```

### 3.3. Flux d'authentification

```
1. L'utilisateur génère une API key dans le dashboard (Settings > API)
2. La clé est affichée UNE SEULE FOIS : "lz_abc12def34..."
3. Le hash SHA-256 est stocké en DB
4. Lors d'une connexion MCP :
   a. La clé est passée via variable d'env (LOUEZ_API_KEY)
   b. Le serveur MCP extrait le prefix, cherche en DB
   c. Vérifie le hash, vérifie non-expiré/non-révoqué
   d. Charge le store + permissions associés
   e. Crée le contexte MCP (storeId, userId, permissions)
```

### 3.4. Isolation multi-tenant

Chaque opération de la session MCP est automatiquement filtrée par `storeId`. Le contexte d'authentification est résolu UNE FOIS à l'initialisation et injecté dans chaque handler de tool/resource :

```typescript
interface McpSessionContext {
  storeId: string
  userId: string
  storeName: string
  permissions: ApiKeyPermissions
}
```

### 3.5. Garde de permissions

Chaque tool vérifie la permission requise avant exécution :

```typescript
function requireMcpPermission(
  ctx: McpSessionContext,
  domain: keyof ApiKeyPermissions,
  level: 'read' | 'write'
): void {
  const perm = ctx.permissions[domain]
  if (perm === 'none') throw new McpPermissionError(domain, level)
  if (level === 'write' && perm === 'read') throw new McpPermissionError(domain, level)
}
```

---

## 4. Catalogue des Tools (actions)

Les tools sont les capacités d'action du serveur MCP. Ils suivent le pattern CRUD + actions métier.

### 4.1. Réservations (`tools/reservations.ts`)

| Tool | Input | Permission | Description |
|------|-------|------------|-------------|
| `list_reservations` | `{ status?, period?, search?, page?, pageSize? }` | `reservations:read` | Lister les réservations avec filtres |
| `get_reservation` | `{ reservationId }` | `reservations:read` | Détail complet d'une réservation |
| `create_reservation` | `{ customerId?, newCustomer?, startDate, endDate, items[], ... }` | `reservations:write` | Créer une réservation manuelle |
| `update_reservation` | `{ reservationId, startDate?, endDate?, items?[] }` | `reservations:write` | Modifier dates/items d'une réservation |
| `update_reservation_status` | `{ reservationId, status, rejectionReason? }` | `reservations:write` | Confirmer, rejeter, annuler, etc. |
| `update_reservation_notes` | `{ reservationId, notes }` | `reservations:write` | Mettre à jour les notes internes |
| `get_reservation_poll` | `{}` | `reservations:read` | Compteurs rapides (pending, ongoing, etc.) |

### 4.2. Produits (`tools/products.ts`)

| Tool | Input | Permission | Description |
|------|-------|------------|-------------|
| `list_products` | `{ status?, categoryId?, search? }` | `products:read` | Lister les produits |
| `get_product` | `{ productId }` | `products:read` | Détail complet d'un produit |
| `create_product` | `{ name, price, pricingMode, categoryId?, quantity?, ... }` | `products:write` | Créer un produit |
| `update_product` | `{ productId, name?, price?, status?, ... }` | `products:write` | Modifier un produit |
| `archive_product` | `{ productId }` | `products:write` | Archiver un produit |
| `check_availability` | `{ productId, startDate, endDate }` | `products:read` | Vérifier la dispo sur une période |

### 4.3. Clients (`tools/customers.ts`)

| Tool | Input | Permission | Description |
|------|-------|------------|-------------|
| `list_customers` | `{ search?, sort?, type? }` | `customers:read` | Lister les clients |
| `get_customer` | `{ customerId }` | `customers:read` | Détail d'un client avec historique |
| `create_customer` | `{ email, firstName, lastName, phone?, ... }` | `customers:write` | Créer un client |
| `update_customer` | `{ customerId, email?, firstName?, ... }` | `customers:write` | Modifier un client |

### 4.4. Catégories (`tools/categories.ts`)

| Tool | Input | Permission | Description |
|------|-------|------------|-------------|
| `list_categories` | `{}` | `categories:read` | Lister les catégories |
| `create_category` | `{ name, description? }` | `categories:write` | Créer une catégorie |
| `update_category` | `{ categoryId, name?, description? }` | `categories:write` | Modifier une catégorie |
| `delete_category` | `{ categoryId }` | `categories:write` | Supprimer une catégorie |

### 4.5. Paiements (`tools/payments.ts`)

| Tool | Input | Permission | Description |
|------|-------|------------|-------------|
| `list_payments` | `{ reservationId }` | `payments:read` | Paiements d'une réservation |
| `record_payment` | `{ reservationId, type, amount, method, notes? }` | `payments:write` | Enregistrer un paiement |
| `delete_payment` | `{ paymentId }` | `payments:write` | Supprimer un paiement |
| `return_deposit` | `{ reservationId, amount, method, notes? }` | `payments:write` | Rembourser une caution |

### 4.6. Analytics (`tools/analytics.ts`)

| Tool | Input | Permission | Description |
|------|-------|------------|-------------|
| `get_dashboard_stats` | `{ period?: '7d' \| '30d' \| '90d' \| '12m' }` | `analytics:read` | Métriques clés du dashboard |
| `get_revenue_report` | `{ startDate, endDate }` | `analytics:read` | Rapport de revenus sur une période |
| `get_product_performance` | `{ period? }` | `analytics:read` | Performance par produit |

### 4.7. Paramètres boutique (`tools/settings.ts`)

| Tool | Input | Permission | Description |
|------|-------|------------|-------------|
| `get_store_settings` | `{}` | `settings:read` | Configuration complète de la boutique |
| `update_store_info` | `{ name?, email?, phone?, address? }` | `settings:write` | Modifier les infos de la boutique |
| `update_store_legal` | `{ cgv?, legalNotice? }` | `settings:write` | Modifier les mentions légales |

---

## 5. Catalogue des Resources (lecture)

Les resources exposent des données en lecture seule, consultables par le client MCP.

### 5.1. Store (`resources/store.ts`)

| Resource | URI | Description |
|----------|-----|-------------|
| `store-info` | `louez://store/info` | Infos de la boutique (nom, slug, contact, config) |
| `store-settings` | `louez://store/settings` | Configuration complète |
| `store-team` | `louez://store/team` | Membres de l'équipe et rôles |

### 5.2. Catalogue (`resources/catalog.ts`)

| Resource | URI | Description |
|----------|-----|-------------|
| `product-list` | `louez://catalog/products` | Catalogue complet des produits |
| `product-detail` | `louez://catalog/products/{productId}` | Détail d'un produit (resource template) |
| `category-list` | `louez://catalog/categories` | Liste des catégories |

### 5.3. Dashboard (`resources/dashboard.ts`)

| Resource | URI | Description |
|----------|-----|-------------|
| `dashboard-summary` | `louez://dashboard/summary` | Résumé du jour (réservations, revenus) |
| `pending-reservations` | `louez://dashboard/reservations/pending` | Réservations en attente d'action |
| `overdue-returns` | `louez://dashboard/reservations/overdue` | Retours en retard |

---

## 6. Catalogue des Prompts (templates)

Les prompts sont des templates métier pré-configurés pour guider l'interaction.

| Prompt | Args | Description |
|--------|------|-------------|
| `daily-briefing` | `{}` | Résumé quotidien : réservations du jour, retours attendus, revenus |
| `reservation-summary` | `{ reservationId }` | Synthèse complète d'une réservation avec historique |
| `customer-profile` | `{ customerId }` | Profil client complet avec historique de locations |
| `inventory-check` | `{}` | État du stock : disponibilités, produits les plus loués |
| `revenue-analysis` | `{ period }` | Analyse des revenus sur une période donnée |

---

## 7. Plan de phases

### Phase 1 — Fondations (2-3 jours)

**Objectif** : package fonctionnel avec authentification et premiers tools.

| Étape | Fichiers | Détail |
|-------|----------|--------|
| 1.1 | `packages/mcp/package.json`, `tsconfig.json` | Scaffolding du package dans le monorepo |
| 1.2 | `packages/db/src/schema.ts` | Ajout de la table `api_keys` + relations |
| 1.3 | `packages/db/src/migrations/` | Migration pour la table `api_keys` |
| 1.4 | `packages/mcp/src/auth/` | Module d'authentification par API key |
| 1.5 | `packages/mcp/src/server.ts` | Setup du `McpServer` avec auth middleware |
| 1.6 | `packages/mcp/bin/louez-mcp.ts` | Entrée CLI (stdio transport) |
| 1.7 | `packages/mcp/src/utils/` | Helpers (formatting, errors) |

### Phase 2 — Tools de lecture (1-2 jours)

**Objectif** : toutes les opérations de consultation.

| Étape | Fichiers | Détail |
|-------|----------|--------|
| 2.1 | `tools/reservations.ts` | `list_reservations`, `get_reservation`, `get_reservation_poll` |
| 2.2 | `tools/products.ts` | `list_products`, `get_product`, `check_availability` |
| 2.3 | `tools/customers.ts` | `list_customers`, `get_customer` |
| 2.4 | `tools/categories.ts` | `list_categories` |
| 2.5 | `tools/analytics.ts` | `get_dashboard_stats`, `get_revenue_report`, `get_product_performance` |
| 2.6 | `tools/settings.ts` | `get_store_settings` |

### Phase 3 — Tools d'écriture (2-3 jours)

**Objectif** : toutes les opérations de mutation.

| Étape | Fichiers | Détail |
|-------|----------|--------|
| 3.1 | `tools/products.ts` | `create_product`, `update_product`, `archive_product` |
| 3.2 | `tools/customers.ts` | `create_customer`, `update_customer` |
| 3.3 | `tools/categories.ts` | `create_category`, `update_category`, `delete_category` |
| 3.4 | `tools/reservations.ts` | `create_reservation`, `update_reservation`, `update_reservation_status`, `update_reservation_notes` |
| 3.5 | `tools/payments.ts` | `record_payment`, `delete_payment`, `return_deposit` |
| 3.6 | `tools/settings.ts` | `update_store_info`, `update_store_legal` |

### Phase 4 — Resources et Prompts (1 jour)

**Objectif** : compléter l'expérience avec les resources et prompts métier.

| Étape | Fichiers | Détail |
|-------|----------|--------|
| 4.1 | `resources/store.ts` | Resources boutique |
| 4.2 | `resources/catalog.ts` | Resources catalogue (avec resource templates) |
| 4.3 | `resources/dashboard.ts` | Resources dashboard temps réel |
| 4.4 | `prompts/templates.ts` | 5 prompts métier pré-configurés |

### Phase 5 — Gestion d'API keys dans le dashboard (1-2 jours)

**Objectif** : interface utilisateur pour gérer les API keys.

| Étape | Fichiers | Détail |
|-------|----------|--------|
| 5.1 | `packages/api/src/routers/dashboard/api-keys.ts` | Procédures oRPC CRUD API keys |
| 5.2 | `packages/api/src/services/api-keys.ts` | Service métier (génération, hachage, révocation) |
| 5.3 | `apps/web/.../settings/api/` | Page dashboard Settings > API Keys |
| 5.4 | Composants UI | Formulaire création, liste, révocation, copie sécurisée |

### Phase 6 — Transport HTTP + Documentation (1-2 jours)

**Objectif** : déploiement remote et documentation.

| Étape | Fichiers | Détail |
|-------|----------|--------|
| 6.1 | `apps/web/app/api/mcp/` | Route handler Next.js pour Streamable HTTP transport |
| 6.2 | `packages/mcp/src/transports/` | Configuration transport HTTP |
| 6.3 | Documentation | README du package, guide d'utilisation, exemples Claude Desktop |

---

## 8. Exemples de code

### 8.1. Setup du serveur (`server.ts`)

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { resolveApiKey } from './auth/api-keys'
import { registerAllTools } from './tools'
import { registerAllResources } from './resources'
import { registerAllPrompts } from './prompts'
import type { McpSessionContext } from './auth/context'

export async function createMcpServer(apiKey: string): Promise<{
  server: McpServer
  context: McpSessionContext
}> {
  // 1. Résoudre l'API key → contexte store
  const context = await resolveApiKey(apiKey)

  // 2. Créer le serveur MCP
  const server = new McpServer({
    name: `louez-${context.storeName}`,
    version: '0.1.0',
  })

  // 3. Enregistrer tools, resources, prompts
  registerAllTools(server, context)
  registerAllResources(server, context)
  registerAllPrompts(server, context)

  return { server, context }
}
```

### 8.2. Exemple de tool (`tools/reservations.ts`)

```typescript
import { z } from 'zod'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { db, reservations, customers } from '@louez/db'
import { and, eq, desc } from 'drizzle-orm'
import type { McpSessionContext } from '../auth/context'
import { requireMcpPermission } from '../auth/context'
import { formatReservation } from '../utils/formatting'

export function registerReservationTools(server: McpServer, ctx: McpSessionContext) {
  server.registerTool(
    'list_reservations',
    {
      title: 'Lister les réservations',
      description: 'Liste les réservations de la boutique avec filtres optionnels',
      inputSchema: z.object({
        status: z.enum([
          'pending', 'confirmed', 'ongoing',
          'completed', 'cancelled', 'rejected',
        ]).optional().describe('Filtrer par statut'),
        search: z.string().optional().describe('Recherche par nom client ou numéro'),
        page: z.number().int().positive().default(1).describe('Numéro de page'),
        pageSize: z.number().int().min(1).max(100).default(20).describe('Taille de page'),
      }),
    },
    async (input) => {
      requireMcpPermission(ctx, 'reservations', 'read')

      const results = await getDashboardReservationsList({
        storeId: ctx.storeId,
        status: input.status,
        search: input.search,
        page: input.page,
        pageSize: input.pageSize,
      })

      return {
        content: [{
          type: 'text',
          text: formatReservationList(results),
        }],
      }
    },
  )

  // ... autres tools réservations
}
```

### 8.3. Entrée CLI (`bin/louez-mcp.ts`)

```typescript
#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createMcpServer } from '../src/server'

const apiKey = process.env.LOUEZ_API_KEY
if (!apiKey) {
  console.error('LOUEZ_API_KEY environment variable is required')
  process.exit(1)
}

const { server } = await createMcpServer(apiKey)
const transport = new StdioServerTransport()
await server.connect(transport)
```

### 8.4. Configuration Claude Desktop

```json
{
  "mcpServers": {
    "louez": {
      "command": "npx",
      "args": ["@louez/mcp"],
      "env": {
        "LOUEZ_API_KEY": "lz_abc12def34...",
        "DATABASE_URL": "mysql://..."
      }
    }
  }
}
```

---

## 9. Considérations de sécurité

### 9.1. Menaces et mitigations

| Menace | Mitigation |
|--------|------------|
| Fuite de clé API | Hash SHA-256 en DB, clé affichée une seule fois, révocation instantanée |
| Accès cross-tenant | Toutes les requêtes filtrées par `storeId` du contexte (jamais user-supplied) |
| Escalade de permissions | Vérification granulaire par domaine avant chaque opération |
| Injection SQL | Utilisation exclusive de Drizzle ORM (paramétrisé) |
| Abus / rate-limiting | Mise à jour `lastUsedAt` à chaque requête, monitoring possible |
| Clé expirée | Vérification `expiresAt` à chaque requête, rejet si expirée |

### 9.2. Bonnes pratiques

- Les API keys ne sont **jamais** loguées ni retournées en clair après création
- Le `keyPrefix` (8 chars) sert uniquement à l'identification visuelle (pas de recherche par clé complète)
- Les permissions de l'API key sont **intersectées** avec le rôle de l'utilisateur créateur (un `member` ne peut pas créer une clé avec plus de droits que son propre rôle)
- Les tools d'écriture sensibles (suppression, changement de statut) exigent `write` sur le domaine

---

## 10. Conventions de code

Pour rester cohérent avec le projet Louez existant :

| Convention | Application |
|------------|-------------|
| **IDs** | nanoid 21 chars |
| **Montants** | `DECIMAL(10,2)`, toujours en string dans Drizzle |
| **Validation** | Zod, schémas dans `@louez/validations` pour les réutilisables |
| **Erreurs** | Pattern `{ success: true }` / erreur MCP standardisée |
| **Multi-tenant** | `storeId` en filtre systématique |
| **TypeScript** | Strict mode, pas de `any` |
| **Nommage tools** | `snake_case` (convention MCP) |
| **Descriptions** | Bilingues FR/EN dans les descriptions de tools |

---

## 11. Réutilisation du code existant

Le serveur MCP doit **maximiser la réutilisation** du code existant :

| Couche existante | Réutilisation dans le MCP |
|------------------|--------------------------|
| `@louez/db` (schéma + requêtes) | Accès direct à la DB via Drizzle pour les queries |
| `packages/api/src/services/*` | Réutilisation des services métier (availability, reservations-dashboard, etc.) |
| `@louez/validations` | Schémas Zod existants pour la validation d'input |
| `@louez/utils` | Helpers pricing, permissions, formatage |
| `@louez/types` | Types partagés (StoreSettings, ProductSnapshot, etc.) |

### Services existants réutilisables immédiatement

- `services/availability.ts` → vérification de disponibilité produit
- `services/reservations-dashboard.ts` → listing et détail réservations
- `services/reservation-poll.ts` → compteurs rapides
- `services/store-settings.ts` → mise à jour paramètres boutique
- `services/onboarding.ts` → flow onboarding
- `services/address.ts` → résolution d'adresses

---

## 12. Tests

### Stratégie de test

| Type | Outil | Couverture |
|------|-------|------------|
| **Unitaire** | Vitest | Auth, formatting, permission guards |
| **Intégration** | Vitest + MCP Inspector | Chaque tool end-to-end avec DB de test |
| **Manuel** | Claude Desktop | Scénarios métier complets |

### Scénarios de test critiques

1. **Auth** : clé invalide → rejet, clé expirée → rejet, clé révoquée → rejet
2. **Permissions** : read-only key ne peut pas écrire, permissions granulaires respectées
3. **Multi-tenant** : un tool ne peut jamais accéder aux données d'un autre store
4. **CRUD complet** : créer un produit → le lister → le modifier → l'archiver
5. **Workflow réservation** : créer → confirmer → en cours → complété
6. **Formatage** : montants, dates, statuts correctement formatés pour le LLM

---

## 13. Documentation

### 13.1. README du package (`packages/mcp/README.md`)

- Installation et configuration
- Génération d'API key
- Configuration Claude Desktop / Cursor / Claude Code
- Liste complète des tools avec exemples
- Guide de contribution

### 13.2. Guide utilisateur dans `docs/`

- `docs/mcp-guide.md` : guide d'utilisation pour les loueurs
- Exemples de conversations type
- FAQ

---

## 14. Résumé des fichiers à créer/modifier

### Nouveaux fichiers (~20 fichiers)

```
packages/mcp/package.json
packages/mcp/tsconfig.json
packages/mcp/src/index.ts
packages/mcp/src/server.ts
packages/mcp/src/auth/api-keys.ts
packages/mcp/src/auth/context.ts
packages/mcp/src/tools/index.ts
packages/mcp/src/tools/reservations.ts
packages/mcp/src/tools/products.ts
packages/mcp/src/tools/customers.ts
packages/mcp/src/tools/categories.ts
packages/mcp/src/tools/payments.ts
packages/mcp/src/tools/analytics.ts
packages/mcp/src/tools/settings.ts
packages/mcp/src/resources/index.ts
packages/mcp/src/resources/store.ts
packages/mcp/src/resources/catalog.ts
packages/mcp/src/resources/dashboard.ts
packages/mcp/src/prompts/index.ts
packages/mcp/src/prompts/templates.ts
packages/mcp/src/utils/formatting.ts
packages/mcp/src/utils/errors.ts
packages/mcp/bin/louez-mcp.ts
```

### Fichiers modifiés (~5 fichiers)

```
packages/db/src/schema.ts              # Ajout table api_keys
packages/types/src/index.ts            # Ajout ApiKeyPermissions
pnpm-workspace.yaml                    # (déjà couvert par packages/*)
turbo.json                             # Ajout tasks pour @louez/mcp
packages/api/src/routers/dashboard/    # Ajout router api-keys (Phase 5)
```
