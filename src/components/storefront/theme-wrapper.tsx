'use client'

import { useEffect } from 'react'

interface ThemeWrapperProps {
  mode: 'light' | 'dark' | 'system'
  primaryColor: string
  children: React.ReactNode
}

/**
 * Calculate contrasting text color (white or black) based on background luminance.
 * Uses a threshold of 0.55 to favor white text on medium-dark colors like pink or purple.
 */
function getContrastForeground(hexColor: string): string {
  const hex = hexColor.replace('#', '')
  const r = parseInt(hex.slice(0, 2), 16)
  const g = parseInt(hex.slice(2, 4), 16)
  const b = parseInt(hex.slice(4, 6), 16)
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return luminance > 0.55 ? 'oklch(0.205 0 0)' : 'oklch(0.985 0 0)'
}

export function ThemeWrapper({ mode, primaryColor, children }: ThemeWrapperProps) {
  useEffect(() => {
    const root = document.documentElement

    // Apply primary color as CSS variable
    root.style.setProperty('--primary', primaryColor)

    // Calculate and apply contrasting foreground color
    root.style.setProperty('--primary-foreground', getContrastForeground(primaryColor))

    // Determine the actual theme to apply
    let isDark = false
    if (mode === 'dark') {
      isDark = true
    } else if (mode === 'system') {
      isDark = window.matchMedia('(prefers-color-scheme: dark)').matches
    }

    // Apply or remove dark class
    if (isDark) {
      root.classList.add('dark')
    } else {
      root.classList.remove('dark')
    }

    // Listen for system theme changes if mode is 'system'
    if (mode === 'system') {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
      const handleChange = (e: MediaQueryListEvent) => {
        if (e.matches) {
          root.classList.add('dark')
        } else {
          root.classList.remove('dark')
        }
      }
      mediaQuery.addEventListener('change', handleChange)
      return () => mediaQuery.removeEventListener('change', handleChange)
    }
  }, [mode, primaryColor])

  return <>{children}</>
}
