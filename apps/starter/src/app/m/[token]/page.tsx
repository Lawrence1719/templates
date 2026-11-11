import { getMemberCard } from "@templates/memberships"
import { formatCardCode, STATE_LABELS } from "@templates/memberships/definitions"
import { cn } from "@templates/ui/cn"
import type { Metadata } from "next"
import { notFound } from "next/navigation"

// The link is the credential: keep it out of search engines and other sites' logs.
export const metadata: Metadata = {
  title: "Membership card",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
}

const longDay = (d: string) =>
  new Intl.DateTimeFormat("en", { dateStyle: "long", timeZone: "UTC" }).format(
    new Date(`${d}T00:00:00Z`),
  )

/** The member's own card: show it at the desk. No account needed. */
export default async function MemberCardPage({ params }: PageProps<"/m/[token]">) {
  const card = await getMemberCard((await params).token)
  if (!card) notFound()
  const good = card.state === "active" || card.state === "expiring"
  return (
    <main className="grid min-h-dvh place-items-center bg-muted/40 px-4 py-10">
      <div className="grid w-full max-w-sm gap-5 rounded-2xl border bg-background p-6 shadow-sm">
        <p className="text-sm text-muted-foreground">{card.orgName}</p>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{card.memberName}</h1>
          <p className="text-muted-foreground">{card.planName}</p>
        </div>
        <p
          className={cn(
            "rounded-lg px-3 py-2 text-sm font-medium",
            good ? "bg-success/15 text-success" : "bg-muted text-muted-foreground",
          )}
        >
          {STATE_LABELS[card.state]}
          {card.state !== "cancelled" &&
            ` · ${card.state === "expired" ? "ended" : card.autoRenew ? "renews after" : "until"} ${longDay(card.periodEnd)}`}
          {card.visitsLeft !== null &&
            good &&
            ` · ${card.visitsLeft} ${card.visitsLeft === 1 ? "visit" : "visits"} left`}
        </p>
        <div className="grid gap-1 rounded-xl border border-dashed p-4 text-center">
          <p className="text-xs text-muted-foreground">Show this code at the desk</p>
          <p className="break-all font-mono text-xl font-semibold tracking-wider">
            {formatCardCode(card.cardToken)}
          </p>
        </div>
      </div>
    </main>
  )
}
