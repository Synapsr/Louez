import { z } from "zod";

import { env } from "@/env";

const MONDAY_API_URL = "https://api.monday.com/v2";

export type MondayApiCredentials = {
  apiToken: string;
  apiVersion?: string;
};

const mondayErrorExtensionSchema = z
  .object({
    code: z.string().optional(),
    status_code: z.number().optional(),
    retry_in_seconds: z.number().optional(),
  })
  .passthrough();

const mondayGraphQLErrorSchema = z
  .object({
    message: z.string(),
    extensions: mondayErrorExtensionSchema.optional(),
  })
  .passthrough();

const mondayComplexitySchema = z
  .object({
    before: z.number().optional(),
    after: z.number().optional(),
    query: z.number().optional(),
    reset_in_x_seconds: z.number().optional(),
  })
  .optional();

const mondayEnvelopeSchema = z.object({
  data: z.record(z.string(), z.unknown()).nullable().optional(),
  errors: z.array(mondayGraphQLErrorSchema).optional(),
  error_code: z.string().optional(),
  error_message: z.string().optional(),
  status_code: z.number().optional(),
  complexity: mondayComplexitySchema,
});

const createItemDataSchema = z.object({
  create_item: z.object({
    id: z.string(),
  }),
});

const changeColumnsDataSchema = z.object({
  change_multiple_column_values: z.object({
    id: z.string(),
  }),
});

const createSubitemDataSchema = z.object({
  create_subitem: z.object({
    id: z.string(),
    board: z
      .object({
        id: z.string(),
      })
      .optional(),
  }),
});

const createUpdateDataSchema = z.object({
  create_update: z.object({
    id: z.string(),
  }),
});

const queryItemStatusDataSchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      board: z
        .object({
          id: z.string(),
        })
        .optional(),
      column_values: z.array(
        z.object({
          id: z.string(),
          text: z.string().nullable().optional(),
          value: z.string().nullable().optional(),
        }),
      ),
    }),
  ),
});

const inspectBoardDataSchema = z.object({
  me: z
    .object({
      id: z.union([z.string(), z.number()]),
      name: z.string().optional(),
      email: z.string().optional(),
    })
    .optional(),
  boards: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      groups: z
        .array(
          z.object({
            id: z.string(),
            title: z.string(),
          }),
        )
        .optional(),
      columns: z.array(
        z.object({
          id: z.string(),
          title: z.string(),
          type: z.string(),
          settings_str: z.string().nullable().optional(),
        }),
      ),
    }),
  ),
});

export type MondayErrorKind =
  | "rate_limit"
  | "complexity_limit"
  | "not_found"
  | "unauthorized"
  | "validation"
  | "network"
  | "unknown";

export class MondayApiError extends Error {
  public readonly status: number;
  public readonly kind: MondayErrorKind;
  public readonly retryable: boolean;
  public readonly retryAfterSeconds?: number;

  constructor(params: {
    message: string;
    status: number;
    kind: MondayErrorKind;
    retryable: boolean;
    retryAfterSeconds?: number;
  }) {
    super(params.message);
    this.name = "MondayApiError";
    this.status = params.status;
    this.kind = params.kind;
    this.retryable = params.retryable;
    this.retryAfterSeconds = params.retryAfterSeconds;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

function resolveCredentials(credentials?: MondayApiCredentials): {
  apiToken: string;
  apiVersion: string;
} {
  const apiToken = credentials?.apiToken?.trim() || env.MONDAY_API_TOKEN?.trim() || "";
  if (!apiToken) {
    throw new MondayApiError({
      message: "Brak skonfigurowanego tokena API monday.com (MONDAY_API_TOKEN)",
      status: 401,
      kind: "unauthorized",
      retryable: false,
    });
  }

  return {
    apiToken,
    apiVersion: credentials?.apiVersion?.trim() || env.MONDAY_API_VERSION || "2024-10",
  };
}

function parseRetryInSecondsFromMessage(message: string): number | undefined {
  const match =
    message.match(/reset in (\d+) seconds/i) ?? message.match(/retry in (\d+) seconds/i);
  if (!match?.[1]) return undefined;
  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function classifyMondayGraphQLError(params: {
  httpStatus: number;
  retryAfterHeader: string | null;
  envelope: z.infer<typeof mondayEnvelopeSchema>;
}): MondayApiError {
  const firstError = params.envelope.errors?.[0];
  const extCode = firstError?.extensions?.code ?? params.envelope.error_code ?? "";
  const message =
    firstError?.message ??
    params.envelope.error_message ??
    `monday.com GraphQL request failed (${params.httpStatus})`;

  const headerRetrySeconds = params.retryAfterHeader
    ? Number.parseInt(params.retryAfterHeader, 10)
    : undefined;
  const extRetrySeconds =
    firstError?.extensions?.retry_in_seconds ??
    params.envelope.complexity?.reset_in_x_seconds ??
    parseRetryInSecondsFromMessage(message);
  const retryAfterSeconds =
    headerRetrySeconds && Number.isFinite(headerRetrySeconds)
      ? headerRetrySeconds
      : extRetrySeconds;

  const normalizedCode = extCode.toUpperCase();
  const normalizedMsg = message.toLowerCase();

  if (
    normalizedCode.includes("COMPLEXITY") ||
    normalizedMsg.includes("complexity budget exhausted")
  ) {
    return new MondayApiError({
      message,
      status: 429,
      kind: "complexity_limit",
      retryable: true,
      retryAfterSeconds: retryAfterSeconds ?? 60,
    });
  }

  if (
    params.httpStatus === 429 ||
    normalizedCode.includes("RATE_LIMIT") ||
    normalizedCode.includes("MAX_CONCURRENCY") ||
    normalizedMsg.includes("rate limit") ||
    normalizedMsg.includes("too many requests")
  ) {
    return new MondayApiError({
      message,
      status: 429,
      kind: "rate_limit",
      retryable: true,
      retryAfterSeconds: retryAfterSeconds ?? 60,
    });
  }

  if (
    params.httpStatus === 401 ||
    params.httpStatus === 403 ||
    normalizedCode.includes("UNAUTHORIZED") ||
    normalizedMsg.includes("not authenticated")
  ) {
    return new MondayApiError({
      message,
      status: params.httpStatus === 200 ? 401 : params.httpStatus,
      kind: "unauthorized",
      retryable: false,
    });
  }

  if (
    params.httpStatus === 404 ||
    normalizedCode.includes("RESOURCE_NOT_FOUND") ||
    normalizedCode.includes("INVALID_ITEM_ID") ||
    normalizedMsg.includes("not found") ||
    normalizedMsg.includes("could not find") ||
    normalizedMsg.includes("inactive") ||
    normalizedMsg.includes("deleted")
  ) {
    return new MondayApiError({
      message,
      status: 404,
      kind: "not_found",
      retryable: false,
    });
  }

  if (
    normalizedCode.includes("COLUMN_VALUE_EXCEPTION") ||
    normalizedCode.includes("INVALID_ARGUMENT") ||
    normalizedCode.includes("PARSE_ERROR")
  ) {
    return new MondayApiError({
      message,
      status: 400,
      kind: "validation",
      retryable: false,
    });
  }

  const isServerFault = params.httpStatus >= 500 || normalizedCode.includes("INTERNAL");
  return new MondayApiError({
    message,
    status: params.httpStatus,
    kind: "unknown",
    retryable: isServerFault,
    retryAfterSeconds,
  });
}

export async function executeMondayGraphQL<T>(params: {
  query: string;
  variables?: Record<string, unknown>;
  schema: z.ZodType<T>;
  credentials?: MondayApiCredentials;
}): Promise<T> {
  const { apiToken, apiVersion } = resolveCredentials(params.credentials);

  let response: Response;
  try {
    response = await fetch(MONDAY_API_URL, {
      method: "POST",
      headers: {
        Authorization: apiToken,
        "Content-Type": "application/json",
        "API-Version": apiVersion,
      },
      body: JSON.stringify({
        query: params.query,
        variables: params.variables ?? {},
      }),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Network error connecting to monday.com";
    throw new MondayApiError({
      message,
      status: 503,
      kind: "network",
      retryable: true,
      retryAfterSeconds: 30,
    });
  }

  const retryAfterHeader = response.headers.get("retry-after");
  let rawBody: unknown;
  try {
    rawBody = await response.json();
  } catch {
    throw new MondayApiError({
      message: `monday.com returned non-JSON response (HTTP ${response.status})`,
      status: response.status,
      kind: response.status === 429 ? "rate_limit" : "network",
      retryable: response.status === 429 || response.status >= 500,
      retryAfterSeconds: retryAfterHeader ? Number.parseInt(retryAfterHeader, 10) : 60,
    });
  }

  const parsedEnvelope = mondayEnvelopeSchema.safeParse(rawBody);
  if (!parsedEnvelope.success) {
    throw new MondayApiError({
      message: `Unexpected monday.com response structure (HTTP ${response.status})`,
      status: response.status,
      kind: "unknown",
      retryable: response.status >= 500,
    });
  }

  const envelope = parsedEnvelope.data;
  if (
    !response.ok ||
    (envelope.errors && envelope.errors.length > 0) ||
    envelope.error_code ||
    envelope.error_message
  ) {
    throw classifyMondayGraphQLError({
      httpStatus: response.status,
      retryAfterHeader,
      envelope,
    });
  }

  return params.schema.parse(envelope.data);
}

/**
 * Creates a main reservation Item on the target monday.com board.
 */
export async function createMondayItem(params: {
  boardId: string;
  groupId?: string | null;
  itemName: string;
  columnValues: Record<string, unknown>;
  credentials?: MondayApiCredentials;
}): Promise<{ id: string }> {
  const query = `
    mutation CreateReservationItem(
      $boardId: ID!,
      $groupId: String,
      $itemName: String!,
      $columnValues: JSON!
    ) {
      create_item(
        board_id: $boardId,
        group_id: $groupId,
        item_name: $itemName,
        column_values: $columnValues,
        create_labels_if_missing: true
      ) {
        id
      }
    }
  `;

  const data = await executeMondayGraphQL({
    query,
    variables: {
      boardId: params.boardId,
      ...(params.groupId ? { groupId: params.groupId } : {}),
      itemName: params.itemName,
      columnValues: JSON.stringify(params.columnValues),
    },
    schema: createItemDataSchema,
    credentials: params.credentials,
  });

  return { id: data.create_item.id };
}

/**
 * Updates an existing main Item or Subitem on a monday.com board.
 */
export async function updateMondayItemColumns(params: {
  boardId: string;
  itemId: string;
  columnValues: Record<string, unknown>;
  credentials?: MondayApiCredentials;
}): Promise<{ id: string }> {
  const query = `
    mutation UpdateItemColumns(
      $boardId: ID!,
      $itemId: ID!,
      $columnValues: JSON!
    ) {
      change_multiple_column_values(
        board_id: $boardId,
        item_id: $itemId,
        column_values: $columnValues,
        create_labels_if_missing: true
      ) {
        id
      }
    }
  `;

  const data = await executeMondayGraphQL({
    query,
    variables: {
      boardId: params.boardId,
      itemId: params.itemId,
      columnValues: JSON.stringify(params.columnValues),
    },
    schema: changeColumnsDataSchema,
    credentials: params.credentials,
  });

  return { id: data.change_multiple_column_values.id };
}

/**
 * Creates a Subitem (equipment product or room to prepare) under a main reservation Item.
 */
export async function createMondaySubitem(params: {
  parentItemId: string;
  itemName: string;
  columnValues?: Record<string, unknown>;
  credentials?: MondayApiCredentials;
}): Promise<{ id: string; subitemBoardId: string | null }> {
  const hasColumns = params.columnValues && Object.keys(params.columnValues).length > 0;

  const query = `
    mutation CreateReservationSubitem(
      $parentItemId: ID!,
      $itemName: String!,
      $columnValues: JSON
    ) {
      create_subitem(
        parent_item_id: $parentItemId,
        item_name: $itemName,
        column_values: $columnValues,
        create_labels_if_missing: true
      ) {
        id
        board {
          id
        }
      }
    }
  `;

  const data = await executeMondayGraphQL({
    query,
    variables: {
      parentItemId: params.parentItemId,
      itemName: params.itemName,
      ...(hasColumns ? { columnValues: JSON.stringify(params.columnValues) } : {}),
    },
    schema: createSubitemDataSchema,
    credentials: params.credentials,
  });

  return {
    id: data.create_subitem.id,
    subitemBoardId: data.create_subitem.board?.id ?? null,
  };
}

/**
 * Posts an Update on a monday.com Item.
 */
export async function createMondayItemUpdate(params: {
  itemId: string;
  body: string;
  credentials?: MondayApiCredentials;
}): Promise<{ id: string }> {
  const query = `
    mutation CreateReservationUpdate($itemId: ID!, $body: String!) {
      create_update(item_id: $itemId, body: $body) {
        id
      }
    }
  `;

  const data = await executeMondayGraphQL({
    query,
    variables: {
      itemId: params.itemId,
      body: params.body,
    },
    schema: createUpdateDataSchema,
    credentials: params.credentials,
  });

  return { id: data.create_update.id };
}

/**
 * Fetches the current status column text of a single Item from monday.com.
 */
export async function fetchMondayItemColumnText(params: {
  itemId: string;
  columnId: string;
  credentials?: MondayApiCredentials;
}): Promise<{ boardId: string | null; statusText: string | null } | null> {
  const query = `
    query GetMondayItemStatus($itemIds: [ID!]!, $columnIds: [String!]!) {
      items(ids: $itemIds) {
        id
        name
        board {
          id
        }
        column_values(ids: $columnIds) {
          id
          text
          value
        }
      }
    }
  `;

  const data = await executeMondayGraphQL({
    query,
    variables: {
      itemIds: [params.itemId],
      columnIds: [params.columnId],
    },
    schema: queryItemStatusDataSchema,
    credentials: params.credentials,
  });

  const item = data.items[0];
  if (!item) return null;

  const col = item.column_values[0];
  return {
    boardId: item.board?.id ?? null,
    statusText: col?.text?.trim() || null,
  };
}

export type MondayBoardColumnInfo = {
  id: string;
  title: string;
  type: string;
};

export type MondayBoardInspectionResult = {
  currentUser: {
    id: string;
    name: string;
    email: string;
  } | null;
  board: {
    id: string;
    name: string;
    groups: Array<{ id: string; title: string }>;
    columns: MondayBoardColumnInfo[];
    detectedSubitemBoardId: string | null;
  } | null;
  subitemBoard: {
    id: string;
    name: string;
    columns: MondayBoardColumnInfo[];
  } | null;
};

/**
 * Inspects the monday.com account (`me`) and target board columns/groups so admins can
 * test connectivity and auto-fill column IDs & Bot User ID directly in the Dashboard UI.
 */
export async function inspectMondayBoardAndAccount(params: {
  boardId: string;
  subitemBoardId?: string | null;
  credentials: MondayApiCredentials;
}): Promise<MondayBoardInspectionResult> {
  const boardIds = [params.boardId.trim()];
  if (params.subitemBoardId?.trim()) {
    boardIds.push(params.subitemBoardId.trim());
  }

  const query = `
    query InspectMondayWorkspace($boardIds: [ID!]!) {
      me {
        id
        name
        email
      }
      boards(ids: $boardIds) {
        id
        name
        groups {
          id
          title
        }
        columns {
          id
          title
          type
          settings_str
        }
      }
    }
  `;

  const data = await executeMondayGraphQL({
    query,
    variables: { boardIds },
    schema: inspectBoardDataSchema,
    credentials: params.credentials,
  });

  const mainBoard =
    data.boards.find((b) => String(b.id) === params.boardId.trim()) ?? data.boards[0] ?? null;

  // Try to detect hidden subitems board ID from the `subtasks` column settings_str
  let detectedSubitemBoardId: string | null = params.subitemBoardId?.trim() || null;
  if (mainBoard) {
    const subtasksCol = mainBoard.columns.find((c) => c.type === "subtasks" || c.id === "subitems");
    if (subtasksCol?.settings_str) {
      try {
        const parsedSettings: unknown = JSON.parse(subtasksCol.settings_str);
        if (
          parsedSettings &&
          typeof parsedSettings === "object" &&
          "boardIds" in parsedSettings &&
          Array.isArray((parsedSettings as { boardIds: unknown[] }).boardIds)
        ) {
          const firstSubBoardId = (parsedSettings as { boardIds: unknown[] }).boardIds[0];
          if (firstSubBoardId !== undefined && firstSubBoardId !== null) {
            detectedSubitemBoardId = String(firstSubBoardId);
          }
        }
      } catch {
        // Ignore
      }
    }
  }

  let subitemBoard = detectedSubitemBoardId
    ? (data.boards.find((b) => String(b.id) === detectedSubitemBoardId) ?? null)
    : null;

  if (!subitemBoard && detectedSubitemBoardId && !boardIds.includes(detectedSubitemBoardId)) {
    try {
      const subData = await executeMondayGraphQL({
        query: `
          query InspectSubitemBoard($boardIds: [ID!]!) {
            boards(ids: $boardIds) {
              id
              name
              columns {
                id
                title
                type
              }
            }
          }
        `,
        variables: { boardIds: [detectedSubitemBoardId] },
        schema: inspectBoardDataSchema,
        credentials: params.credentials,
      });
      subitemBoard = subData.boards[0] ?? null;
    } catch {
      subitemBoard = null;
    }
  }

  return {
    currentUser: data.me
      ? {
          id: String(data.me.id),
          name: data.me.name ?? "",
          email: data.me.email ?? "",
        }
      : null,
    board: mainBoard
      ? {
          id: String(mainBoard.id),
          name: mainBoard.name,
          groups: (mainBoard.groups ?? []).map((g) => ({ id: g.id, title: g.title })),
          columns: mainBoard.columns.map((c) => ({ id: c.id, title: c.title, type: c.type })),
          detectedSubitemBoardId,
        }
      : null,
    subitemBoard: subitemBoard
      ? {
          id: String(subitemBoard.id),
          name: subitemBoard.name,
          columns: subitemBoard.columns.map((c) => ({ id: c.id, title: c.title, type: c.type })),
        }
      : null,
  };
}
