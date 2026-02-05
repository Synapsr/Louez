'use client'

import { useEffect } from 'react'

interface ThemeWrapperProps {
  mode: 'light' | 'dark'
  primaryColor: string
  children: React.ReactNode
}

/**
 * Convert hex color to OKLCH format for Tailwind CSS v4.
 * Uses the sRGB to OKLCH conversion algorithm.
 */
function hexToOklch(hexColor: string): string {
  const hex = hexColor.replace('#', '')
  const r = parseInt(hex.slice(0, 2), 16) / 255
  const g = parseInt(hex.slice(2, 4), 16) / 255
  const b = parseInt(hex.slice(4, 6), 16) / 255

  // Convert sRGB to linear RGB
  const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4))
  const lr = toLinear(r)
  const lg = toLinear(g)
  const lb = toLinear(b)

  // Convert linear RGB to XYZ (D65)
  const x = 0.4124564 * lr + 0.3575761 * lg + 0.1804375 * lb
  const y = 0.2126729 * lr + 0.7151522 * lg + 0.0721750 * lb
  const z = 0.0193339 * lr + 0.1191920 * lg + 0.9503041 * lb

  // Convert XYZ to LMS (using OKLab matrix)
  const l = 0.8189330101 * x + 0.3618667424 * y - 0.1288597137 * z
  const m = 0.0329845436 * x + 0.9293118715 * y + 0.0361456387 * z
  const s = 0.0482003018 * x + 0.2643662691 * y + 0.6338517070 * z

  // Apply cube root
  const l_ = Math.cbrt(l)
  const m_ = Math.cbrt(m)
  const s_ = Math.cbrt(s)

  // Convert to OKLab
  const L = 0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_
  const a = 1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_
  const okb = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_

  // Convert OKLab to OKLCH
  const C = Math.sqrt(a * a + okb * okb)
  let H = Math.atan2(okb, a) * (180 / Math.PI)
  if (H < 0) H += 360

  // Return OKLCH string (L is 0-1, C is typically 0-0.4, H is 0-360)
  return `oklch(${L.toFixed(3)} ${C.toFixed(3)} ${H.toFixed(1)})`
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

    // Apply primary color as CSS variable (convert hex to OKLCH for Tailwind v4)
    const oklchColor = hexToOklch(primaryColor)
    root.style.setProperty('--primary', oklchColor)
    root.style.setProperty('--ring', oklchColor)

    // Calculate and apply contrasting foreground color
    root.style.setProperty('--primary-foreground', getContrastForeground(primaryColor))

    // Apply dark class based on store theme choice
    if (mode === 'dark') {
      root.classList.add('dark')
    } else {
      root.classList.remove('dark')
    }
  }, [mode, primaryColor])

  return <>{children}</>
}
