"use client"

import { useState, useTransition } from "react"

import { saveNotificationPreference } from "@/app/actions/notifications"

type Pref = {
  type: string
  label: string
  description: string
  required: boolean
  channels: { inApp: boolean; email: boolean }
}

export function PreferenceRow({ pref }: { pref: Pref }) {
  const [channels, setChannels] = useState(pref.channels)
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function toggle(key: "inApp" | "email") {
    const next = { ...channels, [key]: !channels[key] }
    setChannels(next)
    setError(null)
    start(async () => {
      try {
        await saveNotificationPreference({ type: pref.type, ...next })
      } catch {
        setChannels(channels) // roll back
        setError("Couldn't save. Try again.")
      }
    })
  }

  const box = "mx-auto size-4 accent-[var(--chart-1)] disabled:opacity-50"
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_4rem_4rem] items-center gap-x-2 px-5 py-3.5">
      <div>
        <p className="text-sm font-medium">{pref.label}</p>
        <p className="text-xs text-muted-foreground">
          {pref.description}
          {pref.required && " Always on."}
        </p>
        {error && (
          <p role="alert" className="text-xs text-danger">
            {error}
          </p>
        )}
      </div>
      <input
        type="checkbox"
        aria-label={`${pref.label}: in app`}
        checked={channels.inApp}
        disabled={pref.required || pending}
        onChange={() => toggle("inApp")}
        className={box}
      />
      <input
        type="checkbox"
        aria-label={`${pref.label}: email`}
        checked={channels.email}
        disabled={pref.required || pending}
        onChange={() => toggle("email")}
        className={box}
      />
    </li>
  )
}
