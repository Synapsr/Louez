'use client'

import { useEffect } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'
// Import translations directly since this component renders outside NextIntlProvider
import messages from '@/messages/fr.json'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('Global error:', error)
  }, [error])

  const t = messages.errors

  return (
    <html lang="fr">
      <body>
        <div className="flex min-h-screen items-center justify-center bg-gray-50 p-4">
          <div className="text-center max-w-md">
            <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-red-100">
              <AlertTriangle className="h-8 w-8 text-red-600" />
            </div>
            <h1 className="text-2xl font-bold text-gray-900 mb-2">
              {t.criticalError}
            </h1>
            <p className="text-gray-600 mb-6">
              {t.criticalErrorMessage}
            </p>
            <button
              onClick={reset}
              className="inline-flex items-center justify-center rounded-lg bg-blue-600 px-6 py-3 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              {t.reloadPage}
            </button>
          </div>
        </div>
      </body>
    </html>
  )
}
