import {
  boolean,
  index,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  timestamp,
  unique,
  varchar,
} from "drizzle-orm/mysql-core";

// One durable media session per provider call. Stream/connection claims prevent
// replay from opening additional paid sessions. Usage remains distinguishable
// from the full PSTN duration, which can include a transfer to a human.
export const voiceSessionsTable = mysqlTable(
  "voice_session",
  {
    conversationId: varchar("conversation_id", { length: 21 }).primaryKey(),
    storeId: varchar("store_id", { length: 21 }).notNull(),
    providerCallId: varchar("provider_call_id", { length: 64 }).notNull(),
    streamId: varchar("stream_id", { length: 128 }),
    connectionId: varchar("connection_id", { length: 36 }),
    openaiSessionId: varchar("openai_session_id", { length: 128 }),
    status: mysqlEnum("status", ["pending", "active", "end", "transfer", "failed"])
      .notNull()
      .default("pending"),
    liveModel: varchar("live_model", { length: 80 }).notNull(),
    backendModel: varchar("backend_model", { length: 80 }).notNull(),
    voice: varchar("voice", { length: 40 }).notNull(),
    backendUsage:
      json("backend_usage").$type<
        Record<string, { inputTokens: number; outputTokens: number; cachedInputTokens: number }>
      >(),
    audioSeconds: int("audio_seconds").notNull().default(0),
    usageFinalized: boolean("usage_finalized").notNull().default(false),
    settled: boolean("settled").notNull().default(false),
    toolCount: int("tool_count").notNull().default(0),
    maxSeconds: int("max_seconds").notNull(),
    pstnEndedAt: timestamp("pstn_ended_at", { mode: "date" }),
    startedAt: timestamp("started_at", { mode: "date" }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => ({
    callUnique: unique("voice_sessions_call_unique").on(table.providerCallId),
    unsettledIdx: index("voice_sessions_unsettled_idx").on(table.settled, table.createdAt),
    storeStatusIdx: index("voice_sessions_store_status_idx").on(table.storeId, table.status),
  }),
);

// A claimed operation is never executed twice, even after an HTTP retry or a
// worker restart. An interrupted "started" operation has an uncertain result;
// it requires reconciliation, never an automatic retry of the side effect.
export const voiceToolExecutionsTable = mysqlTable(
  "voice_tool_execution",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    conversationId: varchar("conversation_id", { length: 21 }).notNull(),
    inputHash: varchar("input_hash", { length: 64 }).notNull(),
    name: varchar("name", { length: 80 }).notNull(),
    status: mysqlEnum("status", ["started", "completed"]).notNull().default("started"),
    output: json("output").$type<unknown>(),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => ({
    conversationIdx: index("voice_tool_executions_conversation_idx").on(table.conversationId),
  }),
);
