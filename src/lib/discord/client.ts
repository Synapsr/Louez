export interface DiscordEmbedField {
  name: string
  value: string
  inline?: boolean
}

export interface DiscordEmbed {
  title?: string
  description?: string
  color?: number
  fields?: DiscordEmbedField[]
  timestamp?: string
  footer?: {
    text: string
  }
}

export interface DiscordWebhookPayload {
  content?: string
  embeds?: DiscordEmbed[]
  username?: string
  avatar_url?: string
}

export interface DiscordSendResult {
  success: boolean
  error?: string
}

/**
 * Send a notification to a Discord webhook
 */
export async function sendDiscordNotification(
  webhookUrl: string,
  payload: DiscordWebhookPayload
): Promise<DiscordSendResult> {
  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ...payload,
        username: payload.username || 'Louez',
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      return {
        success: false,
        error: `Discord API error: ${response.status} - ${errorText}`,
      }
    }

    return { success: true }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * Validate a Discord webhook URL by making a GET request
 * Discord returns webhook info on GET request if valid
 */
export async function validateDiscordWebhook(webhookUrl: string): Promise<boolean> {
  if (!webhookUrl) return false

  // Basic URL format validation
  const webhookRegex = /^https:\/\/discord\.com\/api\/webhooks\/\d+\/[\w-]+$/
  if (!webhookRegex.test(webhookUrl)) {
    return false
  }

  try {
    const response = await fetch(webhookUrl, {
      method: 'GET',
    })
    return response.ok
  } catch {
    return false
  }
}

/**
 * Send a test notification to verify webhook works
 */
export async function sendTestDiscordNotification(
  webhookUrl: string,
  storeName: string
): Promise<DiscordSendResult> {
  return sendDiscordNotification(webhookUrl, {
    embeds: [
      {
        title: 'Test de connexion',
        description: `Les notifications Discord sont maintenant actives pour **${storeName}**.`,
        color: 0x22c55e, // green
        timestamp: new Date().toISOString(),
        footer: { text: 'Louez.io' },
      },
    ],
  })
}
