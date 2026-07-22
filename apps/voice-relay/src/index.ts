/**
 * Voice Relay — a thin WebSocket bridge between Twilio ConversationRelay and
 * the app's Server-Sent-Events turn endpoint.
 *
 * Twilio ConversationRelay owns the call media (Deepgram STT, ElevenLabs TTS,
 * endpointing and barge-in) and opens ONE WebSocket to this worker, exchanging
 * JSON text messages. For each finished caller utterance this worker POSTs the
 * text to the app's `/api/voice/turn` endpoint (an SSE stream) and relays the
 * assistant tokens back to Twilio as they arrive, so Twilio can synthesize
 * speech token-by-token. On barge-in it aborts the in-flight turn.
 *
 * Design constraints:
 *   - ZERO business logic, ZERO database access.
 *   - Fully standalone: no imports from the rest of the monorepo.
 *   - Minimal dependencies: `ws` plus the Node standard library
 *     (global `fetch`, `node:crypto`, `node:http`).
 *   - All configuration comes from the environment; nothing is hardcoded.
 */

import { createHmac, timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import { WebSocket, WebSocketServer } from 'ws'

// ---------------------------------------------------------------------------
// Configuration (env-only, fail fast)
// ---------------------------------------------------------------------------

interface Config {
  /** TCP port the HTTP/WebSocket server listens on. */
  readonly port: number
  /** Absolute https URL of the app's SSE turn endpoint. */
  readonly turnEndpointUrl: string
  /** HMAC secret shared with the app, used in both directions. */
  readonly signingSecret: string
}

/** Load and validate configuration from the environment. Exits on error. */
function loadConfig(): Config {
  const turnEndpointUrl = process.env.TURN_ENDPOINT_URL?.trim()
  const signingSecret = process.env.VOICE_RELAY_SIGNING_SECRET?.trim()

  const missing: string[] = []
  if (!turnEndpointUrl) missing.push('TURN_ENDPOINT_URL')
  if (!signingSecret) missing.push('VOICE_RELAY_SIGNING_SECRET')
  if (!turnEndpointUrl || !signingSecret) {
    console.error(
      `[voice-relay] Missing required environment variables: ${missing.join(', ')}`,
    )
    process.exit(1)
  }

  const port = Number(process.env.PORT ?? '8080')
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    console.error(`[voice-relay] Invalid PORT: ${process.env.PORT}`)
    process.exit(1)
  }

  return { port, turnEndpointUrl, signingSecret }
}

const config = loadConfig()

// ---------------------------------------------------------------------------
// Crypto helpers
// ---------------------------------------------------------------------------

/** base64url( HMAC-SHA256(secret, data) ) as a string. */
function signBase64Url(data: string): string {
  return createHmac('sha256', config.signingSecret).update(data).digest('base64url')
}

/**
 * Constant-time validation of the handshake token.
 * `token` must equal base64url(HMAC-SHA256(secret, `${conversationId}.${expiresAt}`)).
 * Comparison is done on the raw HMAC bytes to avoid a timing side channel.
 * (The caller checks expiry separately, before this.)
 */
function isValidHandshakeToken(
  conversationId: string,
  expiresAt: string,
  token: string,
): boolean {
  const expected = createHmac('sha256', config.signingSecret)
    .update(`${conversationId}.${expiresAt}`)
    .digest()
  // Buffer.from(..., 'base64url') decodes leniently and never throws; a
  // malformed/short token simply yields the wrong length and fails below.
  const provided = Buffer.from(token, 'base64url')
  if (provided.length !== expected.length) return false
  return timingSafeEqual(expected, provided)
}

// ---------------------------------------------------------------------------
// ConversationRelay protocol — typed message unions
// ---------------------------------------------------------------------------

/** Messages Twilio ConversationRelay sends TO this worker. */
interface CrSetup {
  type: 'setup'
  callSid: string
  from: string
  to: string
  sessionId?: string
  customParameters?: Record<string, string>
}
interface CrPrompt {
  type: 'prompt'
  /** Recognized caller speech for this turn. */
  voicePrompt: string
  lang?: string
  /** True once endpointing decides the utterance is complete. */
  last: boolean
}
interface CrInterrupt {
  type: 'interrupt'
  utteranceUntilInterrupt?: string
  durationUntilInterruptMs?: number
}
interface CrDtmf {
  type: 'dtmf'
  digit: string
}
interface CrError {
  type: 'error'
  description?: string
}
type CrInbound = CrSetup | CrPrompt | CrInterrupt | CrDtmf | CrError

/** Messages this worker sends TO Twilio ConversationRelay. */
interface OutText {
  type: 'text'
  /** A text delta to speak (empty string with last:true closes the turn). */
  token: string
  last: boolean
}
interface OutEnd {
  type: 'end'
  /** Opaque JSON string handed back to the app's action URL on session end. */
  handoffData?: string
}
type Outbound = OutText | OutEnd

/** Best-effort structural check that an incoming JSON value is a CR message. */
function asCrInbound(value: unknown): CrInbound | null {
  if (typeof value !== 'object' || value === null) return null
  const type = (value as { type?: unknown }).type
  if (typeof type !== 'string') return null
  switch (type) {
    case 'setup':
    case 'prompt':
    case 'interrupt':
    case 'dtmf':
    case 'error':
      return value as CrInbound
    default:
      return null
  }
}

// ---------------------------------------------------------------------------
// SSE payloads emitted by the app's turn endpoint
// ---------------------------------------------------------------------------

type TurnControl = 'continue' | 'end' | 'transfer'

interface SseToken {
  type: 'token'
  token: string
}
interface SseEnd {
  type: 'end'
  control: TurnControl
  transferNumber?: string | null
}
type SseEvent = SseToken | SseEnd

function asSseEvent(value: unknown): SseEvent | null {
  if (typeof value !== 'object' || value === null) return null
  const type = (value as { type?: unknown }).type
  if (type === 'token' || type === 'end') return value as SseEvent
  return null
}

// ---------------------------------------------------------------------------
// Per-connection state
// ---------------------------------------------------------------------------

interface Connection {
  readonly ws: WebSocket
  readonly conversationId: string
  /** Twilio call identifiers, populated by the `setup` message. */
  callSid: string
  from: string
  to: string
  /** AbortController for the turn currently streaming from the app, if any. */
  turn: AbortController | null
  /** Liveness flag for the ping/pong heartbeat. */
  alive: boolean
}

/** Send a typed message to Twilio, guarding against a closed socket. */
function send(conn: Connection, message: Outbound): void {
  if (conn.ws.readyState !== WebSocket.OPEN) return
  conn.ws.send(JSON.stringify(message))
}

/** Abort the in-flight turn (if any) without emitting anything to Twilio. */
function abortTurn(conn: Connection): void {
  if (conn.turn) {
    conn.turn.abort()
    conn.turn = null
  }
}

// ---------------------------------------------------------------------------
// SSE parsing (chunked, frames separated by a blank line)
// ---------------------------------------------------------------------------

/**
 * Extract the concatenated `data:` payload from a single SSE frame, or null
 * when the frame carries no data lines (comments / keep-alives / other fields).
 */
function extractSseData(frame: string): string | null {
  const dataLines: string[] = []
  for (const rawLine of frame.split('\n')) {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine
    if (line.startsWith('data:')) {
      // A single optional space after the colon is part of the SSE framing.
      dataLines.push(line.slice(line.startsWith('data: ') ? 6 : 5))
    } else if (line === 'data') {
      dataLines.push('')
    }
  }
  return dataLines.length > 0 ? dataLines.join('\n') : null
}

// ---------------------------------------------------------------------------
// A turn: worker -> app SSE -> worker -> Twilio
// ---------------------------------------------------------------------------

/**
 * Run one conversational turn: POST the caller text to the app's SSE turn
 * endpoint and relay assistant tokens back to Twilio until the stream ends or
 * the turn is aborted (barge-in). Never throws — all failures are contained.
 */
async function runTurn(conn: Connection, text: string): Promise<void> {
  // Any previous turn is superseded by this one.
  abortTurn(conn)

  const controller = new AbortController()
  conn.turn = controller

  const body = JSON.stringify({
    conversationId: conn.conversationId,
    callSid: conn.callSid,
    text,
  })
  // Sign `${timestamp}.${body}` so the app can reject stale/replayed requests.
  const timestamp = Date.now().toString()

  try {
    const response = await fetch(config.turnEndpointUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-relay-timestamp': timestamp,
        'x-relay-signature': signBase64Url(`${timestamp}.${body}`),
      },
      body,
      signal: controller.signal,
    })

    if (!response.ok || !response.body) {
      console.error(
        `[voice-relay] turn request failed (status ${response.status}) call=${conn.callSid}`,
      )
      // Fail safe: close the spoken turn and end the session cleanly.
      send(conn, { type: 'text', token: '', last: true })
      send(conn, { type: 'end' })
      return
    }

    await relaySseStream(conn, response.body, controller.signal)
  } catch (err) {
    // Barge-in / supersede aborts arrive here as an AbortError — stay silent.
    if (isAbortError(err)) return
    console.error(
      `[voice-relay] turn error call=${conn.callSid}:`,
      err instanceof Error ? err.message : err,
    )
    // Non-abort failure: fail safe so the caller is not left hanging.
    send(conn, { type: 'text', token: '', last: true })
    send(conn, { type: 'end' })
  } finally {
    // Only clear if this controller is still the active one (a newer turn may
    // have replaced it while we were awaiting).
    if (conn.turn === controller) conn.turn = null
  }
}

/** Read the SSE body, decode frames and act on each app event. */
async function relaySseStream(
  conn: Connection,
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
): Promise<void> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      // Normalize CRLF so frame/line splitting is uniform.
      buffer = buffer.replace(/\r\n/g, '\n')

      let boundary: number
      while ((boundary = buffer.indexOf('\n\n')) !== -1) {
        const frame = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary + 2)
        // A `true` return means the turn is finished — stop reading.
        if (handleSseFrame(conn, frame)) return
      }

      // Defensive: an aborted signal unblocks us even if read() has not yet
      // rejected (e.g. the app keeps the socket open past the end event).
      if (signal.aborted) return
    }

    // Flush any trailing frame that was not terminated by a blank line.
    buffer += decoder.decode()
    if (buffer.trim().length > 0) handleSseFrame(conn, buffer)
  } finally {
    // Release the stream; ignore errors from an already-aborted body.
    void reader.cancel().catch(() => {})
  }
}

/**
 * Handle a single SSE frame. Returns true when the turn is complete and the
 * caller should stop reading the stream.
 */
function handleSseFrame(conn: Connection, frame: string): boolean {
  const data = extractSseData(frame)
  if (data === null) return false

  let parsed: unknown
  try {
    parsed = JSON.parse(data)
  } catch {
    console.warn(`[voice-relay] ignoring non-JSON SSE frame call=${conn.callSid}`)
    return false
  }

  const event = asSseEvent(parsed)
  if (!event) return false

  if (event.type === 'token') {
    if (typeof event.token === 'string' && event.token.length > 0) {
      send(conn, { type: 'text', token: event.token, last: false })
    }
    return false
  }

  // event.type === 'end' — close the spoken turn, then act on the control.
  send(conn, { type: 'text', token: '', last: true })
  switch (event.control) {
    case 'end':
      send(conn, { type: 'end' })
      break
    case 'transfer':
      // The app's action URL renders the <Dial> when Twilio POSTs handoffData.
      send(conn, { type: 'end', handoffData: JSON.stringify({ action: 'transfer' }) })
      break
    case 'continue':
      // Nothing further — await the caller's next prompt.
      break
    default:
      break
  }
  return true
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError'
}

// ---------------------------------------------------------------------------
// Connection message dispatch
// ---------------------------------------------------------------------------

/** Dispatch a single decoded ConversationRelay message. Never throws. */
function handleMessage(conn: Connection, message: CrInbound): void {
  switch (message.type) {
    case 'setup':
      // Twilio already spoke the welcomeGreeting from the TwiML; no turn yet.
      conn.callSid = message.callSid
      conn.from = message.from
      conn.to = message.to
      console.log(
        `[voice-relay] setup conversation=${conn.conversationId} call=${conn.callSid}`,
      )
      break

    case 'prompt':
      // Twilio owns endpointing: ignore partials, act only on the final chunk.
      if (message.last === true && typeof message.voicePrompt === 'string') {
        const text = message.voicePrompt.trim()
        if (text.length > 0) void runTurn(conn, text)
      }
      break

    case 'interrupt':
      // Barge-in: stop relaying tokens for the current turn immediately.
      abortTurn(conn)
      break

    case 'dtmf':
      // No keypad handling in this bridge; the app owns any DTMF semantics.
      break

    case 'error':
      console.error(
        `[voice-relay] ConversationRelay error call=${conn.callSid}: ${message.description ?? 'unknown'}`,
      )
      abortTurn(conn)
      break

    default: {
      // Exhaustiveness guard — unreachable for a well-formed union.
      const _exhaustive: never = message
      void _exhaustive
      break
    }
  }
}

/** Live connections, tracked for the heartbeat sweep. */
const connections = new Set<Connection>()

/** Wire up a validated WebSocket connection. */
function onConnection(ws: WebSocket, conversationId: string): void {
  const conn: Connection = {
    ws,
    conversationId,
    callSid: '',
    from: '',
    to: '',
    turn: null,
    alive: true,
  }
  connections.add(conn)
  console.log(`[voice-relay] connected conversation=${conversationId}`)

  ws.on('message', (raw: Buffer) => {
    // Guard the entire handler: a bad frame must never crash the worker.
    try {
      const parsed: unknown = JSON.parse(raw.toString('utf8'))
      const message = asCrInbound(parsed)
      if (message) handleMessage(conn, message)
    } catch (err) {
      console.error(
        `[voice-relay] failed to handle message call=${conn.callSid}:`,
        err instanceof Error ? err.message : err,
      )
    }
  })

  ws.on('pong', () => {
    conn.alive = true
  })

  ws.on('error', (err: Error) => {
    console.error(`[voice-relay] socket error call=${conn.callSid}: ${err.message}`)
    abortTurn(conn)
  })

  ws.on('close', () => {
    abortTurn(conn)
    connections.delete(conn)
    console.log(
      `[voice-relay] closed conversation=${conn.conversationId} call=${conn.callSid}`,
    )
  })
}

// ---------------------------------------------------------------------------
// HTTP server + WebSocket upgrade
// ---------------------------------------------------------------------------

const wss = new WebSocketServer({ noServer: true })

const httpServer = createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'content-type': 'text/plain' })
    res.end('ok')
    return
  }
  res.writeHead(404, { 'content-type': 'text/plain' })
  res.end('not found')
})

httpServer.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
  const url = new URL(req.url ?? '', 'http://localhost')

  // Only `/relay` paths may upgrade; anything else is dropped outright.
  if (!url.pathname.startsWith('/relay')) {
    socket.destroy()
    return
  }

  const conversationId = url.searchParams.get('c')
  const expiresAt = url.searchParams.get('e')
  const token = url.searchParams.get('t')
  const expiryMs = expiresAt ? Number(expiresAt) : Number.NaN

  if (
    !conversationId ||
    !expiresAt ||
    !token ||
    !Number.isFinite(expiryMs) ||
    Date.now() > expiryMs ||
    !isValidHandshakeToken(conversationId, expiresAt, token)
  ) {
    // Complete the handshake only to close it with a Policy Violation (1008).
    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.close(1008, 'unauthorized')
    })
    return
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    onConnection(ws, conversationId)
  })
})

// Heartbeat: terminate connections that stop answering pings. Twilio keeps the
// socket busy during a call, but this reaps half-open sockets behind proxies.
const HEARTBEAT_MS = 30_000
const heartbeat = setInterval(() => {
  for (const conn of connections) {
    if (!conn.alive) {
      conn.ws.terminate()
      continue
    }
    conn.alive = false
    conn.ws.ping()
  }
}, HEARTBEAT_MS)
heartbeat.unref()

httpServer.listen(config.port, () => {
  console.log(`[voice-relay] listening on :${config.port}`)
})

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------

function shutdown(signalName: string): void {
  console.log(`[voice-relay] ${signalName} received, shutting down`)
  clearInterval(heartbeat)
  for (const ws of wss.clients) ws.close(1001, 'server shutting down')
  httpServer.close(() => process.exit(0))
  // Hard stop if connections do not drain promptly.
  setTimeout(() => process.exit(0), 5_000).unref()
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
