"use client"

import { useEffect } from "react"

/** Opens the print dialog once the page has rendered. */
export function AutoPrint() {
  useEffect(() => {
    const t = setTimeout(() => window.print(), 300)
    return () => clearTimeout(t)
  }, [])
  return null
}
