import { can, requirePermission } from "@templates/auth/guards"
import { ACTIVITY_LABELS, CrmError, crmMembers, formatMoney, getCustomer } from "@templates/crm"
import { formatBytes, listFiles, MAX_FILE_BYTES } from "@templates/files"
import { Card } from "@templates/ui/card"
import { cn } from "@templates/ui/cn"
import {
  Building2,
  CalendarDays,
  Globe,
  Mail,
  MapPin,
  Pencil,
  Phone,
  Plus,
  RefreshCw,
  StickyNote,
  UserRound,
  Users,
} from "lucide-react"
import type { Metadata } from "next"
import Link from "next/link"
import { notFound, redirect } from "next/navigation"

import {
  ActivityComposer,
  ContactEditor,
  DealDialog,
  DeleteActivityButton,
  DeleteCustomerButton,
  StageSelect,
} from "@/components/crm"
import { formatDay, StageBadge, StatusBadge, Tags } from "@/components/crm-badges"
import { DeleteFileButton, FileDropzone } from "@/components/files"
import { timeAgo } from "@/components/time-ago"

export const metadata: Metadata = { title: "Customer" }

const when = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" })
const KIND_ICONS = {
  note: StickyNote,
  call: Phone,
  email: Mail,
  meeting: Users,
  system: RefreshCw,
} as const

function Section({
  title,
  action,
  children,
  className,
}: {
  title: string
  action?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <Card className={cn("grid gap-4 p-5", className)}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        {action}
      </div>
      {children}
    </Card>
  )
}

export default async function CustomerPage({ params }: PageProps<"/customers/[id]">) {
  const { id } = await params
  const ctx = await requirePermission({ customer: ["read"] }).catch(() => redirect("/dashboard"))
  const data = await getCustomer(ctx, id).catch((e) => {
    if (e instanceof CrmError) notFound()
    throw e
  })
  const { customer: c, owner, contacts, deals, activity } = data
  const [
    canWrite,
    canDelete,
    canDealRead,
    canDealWrite,
    canDealDelete,
    canFiles,
    canUpload,
    canDeleteFiles,
  ] = await Promise.all([
    can({ customer: ["write"] }),
    can({ customer: ["delete"] }),
    can({ deal: ["read"] }),
    can({ deal: ["write"] }),
    can({ deal: ["delete"] }),
    can({ file: ["read"] }),
    can({ file: ["upload"] }),
    can({ file: ["delete"] }),
  ])
  const attachTo = { type: "customer", id: c.id }
  const [members, files] = await Promise.all([
    canWrite || canDealWrite ? crmMembers(ctx) : [],
    canFiles ? listFiles(ctx, { attachedTo: attachTo, limit: 50 }) : [],
  ])
  const KindIcon = c.kind === "company" ? Building2 : UserRound

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="grid gap-2">
          <Link href="/customers" className="text-sm text-muted-foreground hover:text-foreground">
            ← Customers
          </Link>
          <div className="flex flex-wrap items-center gap-3">
            <KindIcon className="size-6 text-muted-foreground" aria-hidden />
            <h1 className="text-2xl font-semibold tracking-tight">{c.name}</h1>
            <StatusBadge status={c.status} />
          </div>
          <Tags tags={c.tags} />
        </div>
        <div className="flex gap-2">
          {canWrite && (
            <Link
              href={`/customers/${c.id}/edit`}
              className="inline-flex h-9 items-center gap-2 rounded-md border px-4 text-sm font-medium hover:bg-accent [&_svg]:size-4"
            >
              <Pencil /> Edit
            </Link>
          )}
          {canDelete && <DeleteCustomerButton id={c.id} name={c.name} />}
        </div>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        {/* Timeline */}
        <div className="grid gap-4">
          {canWrite && (
            <Card className="p-4">
              <ActivityComposer customerId={c.id} />
            </Card>
          )}
          <Card className="p-0">
            <h2 className="border-b px-5 py-3 text-sm font-semibold">Timeline</h2>
            {activity.length === 0 ? (
              <p className="p-8 text-center text-sm text-muted-foreground">Nothing logged yet.</p>
            ) : (
              <ol className="divide-y">
                {activity.map((a) => {
                  const Icon = KIND_ICONS[a.kind]
                  const deletable =
                    a.kind !== "system" && canWrite && (canDelete || a.createdBy === ctx.user.id)
                  return (
                    <li key={a.id} className="flex gap-3 px-5 py-3.5">
                      <span
                        className={cn(
                          "mt-0.5 grid size-7 shrink-0 place-items-center rounded-full border",
                          a.kind === "system" && "border-transparent bg-muted",
                        )}
                      >
                        <Icon className="size-3.5 text-muted-foreground" aria-hidden />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs text-muted-foreground">
                          {a.kind !== "system" && (
                            <span className="font-medium text-foreground">
                              {ACTIVITY_LABELS[a.kind]}
                            </span>
                          )}
                          {a.kind !== "system" && " · "}
                          {a.kind !== "system" && `${a.authorName ?? "Former member"} · `}
                          <time
                            dateTime={a.occurredAt.toISOString()}
                            title={when.format(a.occurredAt)}
                          >
                            {a.occurredAt > new Date()
                              ? `planned ${when.format(a.occurredAt)}`
                              : timeAgo(a.occurredAt)}
                          </time>
                        </p>
                        <p
                          className={cn(
                            "mt-0.5 whitespace-pre-wrap break-words text-sm",
                            a.kind === "system" && "text-muted-foreground",
                          )}
                        >
                          {a.body}
                        </p>
                      </div>
                      {deletable && <DeleteActivityButton id={a.id} />}
                    </li>
                  )
                })}
              </ol>
            )}
          </Card>
        </div>

        {/* Side panel */}
        <div className="grid gap-4">
          <Section title="Details">
            <dl className="grid gap-2.5 text-sm [&_dd]:min-w-0 [&_dd]:break-words [&_div]:flex [&_div]:gap-2.5 [&_dt_svg]:mt-0.5 [&_dt_svg]:size-4 [&_dt_svg]:text-muted-foreground">
              {c.email && (
                <div>
                  <dt>
                    <Mail aria-label="Email" />
                  </dt>
                  <dd>
                    <a className="hover:underline" href={`mailto:${c.email}`}>
                      {c.email}
                    </a>
                  </dd>
                </div>
              )}
              {c.phone && (
                <div>
                  <dt>
                    <Phone aria-label="Phone" />
                  </dt>
                  <dd>
                    <a className="hover:underline" href={`tel:${c.phone.replace(/[^\d+]/g, "")}`}>
                      {c.phone}
                    </a>
                  </dd>
                </div>
              )}
              {c.website && (
                <div>
                  <dt>
                    <Globe aria-label="Website" />
                  </dt>
                  <dd>
                    {/* Only http(s) URLs are ever stored (see definitions.ts). */}
                    <a
                      className="hover:underline"
                      href={c.website}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                    >
                      {c.website.replace(/^https?:\/\//, "").replace(/\/$/, "")}
                    </a>
                  </dd>
                </div>
              )}
              {c.address && (
                <div>
                  <dt>
                    <MapPin aria-label="Address" />
                  </dt>
                  <dd className="whitespace-pre-line">{c.address}</dd>
                </div>
              )}
              <div>
                <dt>
                  <UserRound aria-label="Owner" />
                </dt>
                <dd>
                  {owner ? owner.name : <span className="text-muted-foreground">No owner</span>}
                </dd>
              </div>
              <div>
                <dt>
                  <CalendarDays aria-label="Added" />
                </dt>
                <dd className="text-muted-foreground">Added {timeAgo(c.createdAt)}</dd>
              </div>
            </dl>
          </Section>

          <Section title="Contacts">
            {contacts.length === 0 && (
              <p className="text-sm text-muted-foreground">No contacts yet.</p>
            )}
            {contacts.map((ct) => (
              <ContactEditor key={ct.id} customerId={c.id} contact={ct} canEdit={canWrite} />
            ))}
            <div>
              <ContactEditor customerId={c.id} canEdit={canWrite} />
            </div>
          </Section>

          {canDealRead && (
            <Section
              title="Deals"
              action={
                canDealWrite && (
                  <DealDialog
                    customerId={c.id}
                    members={members}
                    initial={{
                      title: "",
                      value: "",
                      currency: deals[0]?.currency ?? "USD",
                      stage: "new",
                      ownerId: c.ownerId ?? ctx.user.id,
                      expectedCloseOn: "",
                    }}
                    trigger={
                      <button
                        type="button"
                        className="inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-sm font-medium hover:bg-accent [&_svg]:size-4"
                      >
                        <Plus /> Deal
                      </button>
                    }
                  />
                )
              }
            >
              {deals.length === 0 ? (
                <p className="text-sm text-muted-foreground">No deals yet.</p>
              ) : (
                <ul className="grid gap-3">
                  {deals.map((d) => (
                    <li key={d.id} className="grid gap-1.5 rounded-lg border p-3">
                      <div className="flex items-start justify-between gap-2">
                        {canDealWrite ? (
                          <DealDialog
                            customerId={c.id}
                            members={members}
                            canDelete={canDealDelete}
                            initial={{
                              id: d.id,
                              title: d.title,
                              value: (d.valueCents / 100).toFixed(2),
                              currency: d.currency,
                              stage: d.stage,
                              ownerId: d.ownerId ?? "",
                              expectedCloseOn: d.expectedCloseOn ?? "",
                            }}
                            trigger={
                              <button
                                type="button"
                                className="text-left text-sm font-medium hover:underline"
                              >
                                {d.title}
                              </button>
                            }
                          />
                        ) : (
                          <span className="text-sm font-medium">{d.title}</span>
                        )}
                        <span className="text-sm tabular-nums">
                          {formatMoney(d.valueCents, d.currency)}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                        <span>
                          {d.ownerName ?? "No owner"}
                          {d.expectedCloseOn && ` · close ${formatDay(d.expectedCloseOn)}`}
                        </span>
                        {canDealWrite ? (
                          <div className="w-32">
                            <StageSelect id={d.id} stage={d.stage} title={d.title} />
                          </div>
                        ) : (
                          <StageBadge stage={d.stage} />
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          )}

          {canFiles && (
            <Section title="Files">
              {files.length > 0 && (
                <ul className="grid gap-2">
                  {files.map((f) => (
                    <li key={f.id} className="flex items-center gap-2 text-sm">
                      <div className="min-w-0 flex-1">
                        <a href={`/api/files/${f.id}`} className="block truncate hover:underline">
                          {f.name}
                        </a>
                        <p className="text-xs text-muted-foreground">
                          {formatBytes(f.size)} · {timeAgo(f.createdAt)}
                        </p>
                      </div>
                      {(canDeleteFiles || f.uploadedBy === ctx.user.id) && (
                        <DeleteFileButton id={f.id} name={f.name} />
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {canUpload && <FileDropzone maxBytes={MAX_FILE_BYTES} attachTo={attachTo} />}
            </Section>
          )}
        </div>
      </div>
    </div>
  )
}
