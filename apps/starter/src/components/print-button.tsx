"use client"

import { Button } from "@templates/ui/button"
import { Printer } from "lucide-react"

export function PrintButton() {
  return (
    <Button variant="ghost" onClick={() => window.print()}>
      <Printer /> Print or save PDF
    </Button>
  )
}
