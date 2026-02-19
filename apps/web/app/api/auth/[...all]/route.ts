import { toNextJsHandler } from '@louez/auth'

import { authInstance } from '@/lib/auth'

export const { POST, GET } = toNextJsHandler(authInstance)
