'use server'

import { and, desc, eq } from 'drizzle-orm'
import { z } from 'zod'

import { db, aiChats, aiChatMessages } from '@louez/db'

import { auth } from '@/lib/auth'
import { getCurrentStore } from '@/lib/store-context'

export type ChatSummary = {
  id: string
  title: string
  updatedAt: Date
}

export type ChatMessage = {
  id: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  createdAt: Date
}

/** Validate nanoid-style chat IDs (21 alphanumeric chars). */
const chatIdSchema = z.string().min(1).max(30)

/** List recent conversations for the current user/store. */
export async function listChats(): Promise<{
  chats: ChatSummary[]
  error?: string
}> {
  const session = await auth()
  if (!session?.user?.id) return { chats: [], error: 'errors.unauthenticated' }

  const store = await getCurrentStore()
  if (!store) return { chats: [], error: 'errors.unauthorized' }

  try {
    const rows = await db.query.aiChats.findMany({
      where: and(
        eq(aiChats.storeId, store.id),
        eq(aiChats.userId, session.user.id),
      ),
      columns: { id: true, title: true, updatedAt: true },
      orderBy: [desc(aiChats.updatedAt)],
      limit: 50,
    })

    return {
      chats: rows.map((r) => ({ ...r, title: r.title ?? 'Untitled' })),
    }
  } catch {
    return { chats: [], error: 'errors.internal' }
  }
}

/** Load all messages for a specific conversation. */
export async function loadChatMessages(chatId: string): Promise<{
  messages: ChatMessage[]
  error?: string
}> {
  const parsed = chatIdSchema.safeParse(chatId)
  if (!parsed.success) return { messages: [], error: 'errors.invalidData' }

  const session = await auth()
  if (!session?.user?.id)
    return { messages: [], error: 'errors.unauthenticated' }

  const store = await getCurrentStore()
  if (!store) return { messages: [], error: 'errors.unauthorized' }

  try {
    // Verify ownership
    const chat = await db.query.aiChats.findFirst({
      where: and(
        eq(aiChats.id, parsed.data),
        eq(aiChats.storeId, store.id),
        eq(aiChats.userId, session.user.id),
      ),
      columns: { id: true },
    })

    if (!chat) return { messages: [], error: 'errors.notFound' }

    const rows = await db.query.aiChatMessages.findMany({
      where: eq(aiChatMessages.chatId, parsed.data),
      columns: { id: true, role: true, content: true, createdAt: true },
      orderBy: [aiChatMessages.createdAt],
    })

    return {
      messages: rows.map((r) => ({ ...r, content: r.content ?? '' })),
    }
  } catch {
    return { messages: [], error: 'errors.internal' }
  }
}
