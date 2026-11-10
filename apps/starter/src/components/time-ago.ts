const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" })

export function timeAgo(date: Date, now = Date.now()) {
  const s = Math.round((date.getTime() - now) / 1000)
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["day", 86_400],
    ["hour", 3_600],
    ["minute", 60],
  ]
  for (const [unit, secs] of units)
    if (Math.abs(s) >= secs) return rtf.format(Math.round(s / secs), unit)
  return "just now"
}
