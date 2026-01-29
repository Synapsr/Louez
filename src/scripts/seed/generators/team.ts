/**
 * Team Generator
 *
 * Generates store members and invitations.
 */

import type { StoreConfig } from '../config'
import { generateId, generateToken, addDays, pickRandom, randomInt, chance } from '../utils'
import { FRENCH_FIRST_NAMES, FRENCH_LAST_NAMES, generateFrenchEmail } from '../data/customer-names'

export interface GeneratedUser {
  id: string
  email: string
  name: string
  image: string | null
  emailVerified: Date | null
  createdAt: Date
  updatedAt: Date
}

export interface GeneratedStoreMember {
  id: string
  storeId: string
  userId: string
  role: 'owner' | 'member'
  addedBy: string | null
  createdAt: Date
  updatedAt: Date
}

export interface GeneratedStoreInvitation {
  id: string
  storeId: string
  email: string
  role: 'member'
  token: string
  status: 'pending' | 'accepted' | 'expired' | 'cancelled'
  invitedBy: string
  expiresAt: Date
  acceptedAt: Date | null
  createdAt: Date
}

export interface TeamGeneratorResult {
  users: GeneratedUser[]
  storeMembers: GeneratedStoreMember[]
  storeInvitations: GeneratedStoreInvitation[]
}

/**
 * Generate a random avatar URL
 */
function generateAvatarUrl(name: string): string {
  // Use UI Avatars for placeholder avatars
  const encoded = encodeURIComponent(name)
  const colors = ['0D8ABC', '2E7D32', 'C62828', '6A1B9A', 'E65100', '283593']
  const color = pickRandom(colors)
  return `https://ui-avatars.com/api/?name=${encoded}&background=${color}&color=fff&size=128`
}

/**
 * Generate team members for a store
 */
export function generateTeam(
  storeId: string,
  ownerId: string,
  storeConfig: StoreConfig,
  now: Date
): TeamGeneratorResult {
  const users: GeneratedUser[] = []
  const storeMembers: GeneratedStoreMember[] = []
  const storeInvitations: GeneratedStoreInvitation[] = []

  // Owner is already a member
  storeMembers.push({
    id: generateId(),
    storeId,
    userId: ownerId,
    role: 'owner',
    addedBy: null,
    createdAt: now,
    updatedAt: now,
  })

  // Generate additional team members based on plan
  // start: 0 members, pro: up to 2, ultra: unlimited
  const maxMembers =
    storeConfig.planSlug === 'start' ? 0 : storeConfig.planSlug === 'pro' ? 2 : storeConfig.teamSize

  const memberCount = Math.min(storeConfig.teamSize - 1, maxMembers) // -1 for owner

  const usedEmails = new Set<string>()

  for (let i = 0; i < memberCount; i++) {
    const isMale = chance(0.5)
    const firstName = pickRandom(isMale ? FRENCH_FIRST_NAMES.male : FRENCH_FIRST_NAMES.female)
    const lastName = pickRandom(FRENCH_LAST_NAMES)
    const name = `${firstName} ${lastName}`

    let email = generateFrenchEmail(firstName, lastName)
    while (usedEmails.has(email)) {
      email = generateFrenchEmail(firstName, lastName)
    }
    usedEmails.add(email)

    const userId = generateId()
    const createdAt = new Date(now.getTime() - randomInt(7, 90) * 24 * 60 * 60 * 1000)

    // Create user
    users.push({
      id: userId,
      email,
      name,
      image: chance(0.7) ? generateAvatarUrl(name) : null, // 70% have avatar
      emailVerified: createdAt,
      createdAt,
      updatedAt: now,
    })

    // Create store membership
    storeMembers.push({
      id: generateId(),
      storeId,
      userId,
      role: 'member',
      addedBy: ownerId,
      createdAt: new Date(createdAt.getTime() + randomInt(0, 7) * 24 * 60 * 60 * 1000),
      updatedAt: now,
    })
  }

  // Generate some pending/expired invitations (for ultra plan stores)
  if (storeConfig.planSlug === 'ultra' && memberCount > 0) {
    // 1 pending invitation
    const pendingEmail = generateFrenchEmail(
      pickRandom(FRENCH_FIRST_NAMES.female),
      pickRandom(FRENCH_LAST_NAMES)
    )

    storeInvitations.push({
      id: generateId(),
      storeId,
      email: pendingEmail,
      role: 'member',
      token: generateToken(64),
      status: 'pending',
      invitedBy: ownerId,
      expiresAt: addDays(now, 5), // Expires in 5 days
      acceptedAt: null,
      createdAt: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000), // Created 2 days ago
    })

    // 1 expired invitation
    const expiredEmail = generateFrenchEmail(
      pickRandom(FRENCH_FIRST_NAMES.male),
      pickRandom(FRENCH_LAST_NAMES)
    )

    const expiredCreatedAt = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000) // 10 days ago

    storeInvitations.push({
      id: generateId(),
      storeId,
      email: expiredEmail,
      role: 'member',
      token: generateToken(64),
      status: 'expired',
      invitedBy: ownerId,
      expiresAt: new Date(expiredCreatedAt.getTime() + 7 * 24 * 60 * 60 * 1000), // Expired 3 days ago
      acceptedAt: null,
      createdAt: expiredCreatedAt,
    })
  }

  return {
    users,
    storeMembers,
    storeInvitations,
  }
}
