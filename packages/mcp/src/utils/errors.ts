import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js'

/**
 * Create a standardized MCP error response for tool calls.
 * Business errors return isError: true with a descriptive message.
 * System errors throw McpError to be handled by the SDK.
 */
export function toolError(message: string) {
  return {
    content: [{ type: 'text' as const, text: message }],
    isError: true,
  }
}

export function toolResult(text: string) {
  return {
    content: [{ type: 'text' as const, text }],
  }
}

export function systemError(message: string): never {
  throw new McpError(ErrorCode.InternalError, message)
}

