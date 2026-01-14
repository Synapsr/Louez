'use client'

import { useEffect } from 'react'

interface ThemeWrapperProps {
  mode: 'light' | 'dark' | 'system'
  primaryColor: string
  children: React.ReactNode
}

export function ThemeWrapper({ mode, primaryColor, children }: ThemeWrapperProps) {
  useEffect(() => {
    const root = document.documentElement

    // Apply primary color as CSS variable
    root.style.setProperty('--primary', primaryColor)

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
