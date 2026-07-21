import { and, count, desc, eq, isNotNull, isNull, sql } from 'drizzle-orm'

import type { Database } from '@louez/db'
import {
  aiAdvisorConversations,
  aiAdvisorMessages,
  customers,
  reservations,
} from '@louez/db/schema'
import {
  VERIFICATION_KICKOFF_PROMPT,
  type AdvisorConversationFilter,
} from '@louez/validations'

import { ApiServiceError } from './errors'

const DEFAULT_PAGE_SIZE = 20

/**
 * Paginated conversation summaries for the dashboard settings page.
 * "Converted" means the conversation is linked to a reservation.
 */
export async function listAdvisorConversations(params: {
  db: Database
  storeId: string
  filter?: AdvisorConversationFilter
  page?: number
  pageSize?: number
}) {
  const { db, storeId } = params
  const page = params.page ?? 1
  const pageSize = params.pageSize ?? DEFAULT_PAGE_SIZE

  const conditions = [eq(aiAdvisorConversations.storeId, storeId)]
  if (params.filter === 'converted') {
    conditions.push(isNotNull(aiAdvisorConversations.reservationId))
  } else if (params.filter === 'not_converted') {
    conditions.push(isNull(aiAdvisorConversations.reservationId))
  }
  const whereClause = and(...conditions)

  const [rows, totalResult] = await Promise.all([
    db
      .select({
        id: aiAdvisorConversations.id,
        createdAt: aiAdvisorConversations.createdAt,
        updatedAt: aiAdvisorConversations.updatedAt,
        customerId: aiAdvisorConversations.customerId,
        customerFirstName: customers.firstName,
        customerLastName: customers.lastName,
        reservationId: aiAdvisorConversations.reservationId,
        reservationNumber: reservations.number,
        validatedAt: aiAdvisorConversations.validatedAt,
        locale: aiAdvisorConversations.locale,
        messageCount: sql<number>`(
          SELECT COUNT(*) FROM ${aiAdvisorMessages}
          WHERE ${aiAdvisorMessages.conversationId} = ${aiAdvisorConversations.id}
            AND (${aiAdvisorMessages.content} IS NULL
              OR ${aiAdvisorMessages.content} <> ${VERIFICATION_KICKOFF_PROMPT})
        )`.mapWith(Number),
        firstUserMessage: sql<string | null>`(
          SELECT LEFT(${aiAdvisorMessages.content}, 160) FROM ${aiAdvisorMessages}
          WHERE ${aiAdvisorMessages.conversationId} = ${aiAdvisorConversations.id}
            AND ${aiAdvisorMessages.role} = 'user'
            AND ${aiAdvisorMessages.content} <> ${VERIFICATION_KICKOFF_PROMPT}
          ORDER BY ${aiAdvisorMessages.createdAt} ASC
          LIMIT 1
        )`,
      })
      .from(aiAdvisorConversations)
      .leftJoin(customers, eq(aiAdvisorConversations.customerId, customers.id))
      .leftJoin(
        reservations,
        eq(aiAdvisorConversations.reservationId, reservations.id),
      )
      .where(whereClause)
      .orderBy(desc(aiAdvisorConversations.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db
      .select({ count: count() })
      .from(aiAdvisorConversations)
      .where(whereClause),
  ])

  return {
    conversations: rows.map((row) => ({
      id: row.id,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      customerId: row.customerId,
      customerName:
        row.customerFirstName && row.customerLastName
          ? `${row.customerFirstName} ${row.customerLastName}`
          : null,
      reservationId: row.reservationId,
      reservationNumber: row.reservationNumber,
      validatedAt: row.validatedAt,
      locale: row.locale,
      messageCount: row.messageCount,
      firstUserMessage: row.firstUserMessage,
    })),
    totalCount: totalResult[0]?.count ?? 0,
    page,
    pageSize,
  }
}

function toTranscript(
  conversation: NonNullable<
    Awaited<ReturnType<typeof findConversationWithMessages>>
  >,
) {
  return {
    id: conversation.id,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    customerId: conversation.customerId,
    customerName: conversation.customer
      ? `${conversation.customer.firstName} ${conversation.customer.lastName}`
      : null,
    reservationId: conversation.reservationId,
    reservationNumber: conversation.reservation?.number ?? null,
    validatedAt: conversation.validatedAt,
    collectedData: conversation.collectedData,
    locale: conversation.locale,
    messages: conversation.messages
      .filter(
        (
          message,
        ): message is (typeof conversation.messages)[number] & {
          role: 'user' | 'assistant'
        } =>
          // Tool-only turns have no text — skip them in transcripts. The hidden
          // verification kickoff is a control signal, never shown to the owner.
          (message.role === 'user' || message.role === 'assistant') &&
          Boolean(message.content) &&
          message.content !== VERIFICATION_KICKOFF_PROMPT,
      )
      .map((message) => ({
        id: message.id,
        role: message.role,
        content: message.content ?? '',
        createdAt: message.createdAt,
      })),
  }
}

function findConversationWithMessages(
  db: Database,
  where: ReturnType<typeof and>,
) {
  return db.query.aiAdvisorConversations.findFirst({
    where,
    columns: {
      id: true,
      createdAt: true,
      updatedAt: true,
      customerId: true,
      reservationId: true,
      validatedAt: true,
      collectedData: true,
      locale: true,
    },
    with: {
      customer: { columns: { firstName: true, lastName: true } },
      reservation: { columns: { number: true } },
      messages: {
        columns: { id: true, role: true, content: true, createdAt: true },
        orderBy: (messages, { asc }) => [asc(messages.createdAt)],
      },
    },
  })
}

/** Full transcript of one conversation, for the dashboard. */
export async function getAdvisorConversation(params: {
  db: Database
  storeId: string
  conversationId: string
}) {
  const conversation = await findConversationWithMessages(
    params.db,
    and(
      eq(aiAdvisorConversations.id, params.conversationId),
      eq(aiAdvisorConversations.storeId, params.storeId),
    ),
  )

  if (!conversation) {
    throw new ApiServiceError('NOT_FOUND', 'errors.conversationNotFound')
  }

  return toTranscript(conversation)
}

/** Transcript of the conversation linked to a reservation, or null. */
export async function getAdvisorConversationByReservation(params: {
  db: Database
  storeId: string
  reservationId: string
}) {
  const conversation = await findConversationWithMessages(
    params.db,
    and(
      eq(aiAdvisorConversations.reservationId, params.reservationId),
      eq(aiAdvisorConversations.storeId, params.storeId),
    ),
  )

  return conversation ? toTranscript(conversation) : null
}

/**
 * Validation state of a conversation, consumed by the checkout gate.
 * Possession of the 21-char conversation id is the anonymous access model
 * (same as the cart); only validation state is disclosed, never content.
 */
export async function getAdvisorConversationStatus(params: {
  db: Database
  storeId: string
  conversationId: string
}) {
  const conversation =
    await params.db.query.aiAdvisorConversations.findFirst({
      where: and(
        eq(aiAdvisorConversations.id, params.conversationId),
        eq(aiAdvisorConversations.storeId, params.storeId),
      ),
      columns: { validatedAt: true, validatedCart: true },
    })

  if (!conversation) {
    throw new ApiServiceError('NOT_FOUND', 'errors.conversationNotFound')
  }

  return {
    validated: conversation.validatedAt !== null,
    validatedCart: conversation.validatedAt !== null
      ? (conversation.validatedCart ?? null)
      : null,
  }
}

/**
 * Messages of a conversation, for widget rehydration after a page reload.
 * Same anonymous access model as above: possession of the id grants access.
 */
export async function getAdvisorConversationMessages(params: {
  db: Database
  storeId: string
  conversationId: string
}) {
  const conversation =
    await params.db.query.aiAdvisorConversations.findFirst({
      where: and(
        eq(aiAdvisorConversations.id, params.conversationId),
        eq(aiAdvisorConversations.storeId, params.storeId),
      ),
      columns: { id: true },
      with: {
        messages: {
          columns: { id: true, role: true, content: true },
          orderBy: (messages, { asc }) => [asc(messages.createdAt)],
        },
      },
    })

  if (!conversation) {
    throw new ApiServiceError('NOT_FOUND', 'errors.conversationNotFound')
  }

  return {
    messages: conversation.messages
      .filter(
        (
          message,
        ): message is (typeof conversation.messages)[number] & {
          role: 'user' | 'assistant'
        } =>
          (message.role === 'user' || message.role === 'assistant') &&
          Boolean(message.content),
      )
      .map((message) => ({
        id: message.id,
        role: message.role,
        content: message.content ?? '',
      })),
  }
}
