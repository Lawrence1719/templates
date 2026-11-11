"use client"

import {
  BUCKET_LABELS,
  type DueBucket,
  dueBucket,
  PRIORITY_LABELS,
  RECURRENCE_LABELS,
  STATUS_LABELS,
  TASK_PRIORITIES,
  TASK_RECURRENCES,
  TASK_STATUSES,
  type TaskInput,
  type TaskPriority,
  type TaskStatus,
  today,
} from "@templates/tasks/definitions"
import { Button } from "@templates/ui/button"
import { cn } from "@templates/ui/cn"
import { ErrorText, Select } from "@templates/ui/form"
import { CheckSquare, MessageSquare, Plus, Repeat, Trash2, X } from "lucide-react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useEffect, useState, useTransition } from "react"

import {
  addChecklistItemAction,
  addCommentAction,
  createProjectAction,
  createTaskAction,
  deleteChecklistItemAction,
  deleteCommentAction,
  deleteProjectAction,
  deleteTaskAction,
  setChecklistItemDoneAction,
  setProjectStatusAction,
  setTaskStatusAction,
  type TaskResult,
  updateTaskAction,
} from "@/app/actions/tasks"
import { Choice, control, Input, Labeled } from "@/components/fields"

type Member = { id: string; name: string }
type Option = { id: string; name: string }

function useTaskAction() {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [result, setResult] = useState<TaskResult | null>(null)
  const submit = (fn: () => Promise<TaskResult>, onOk?: (r: TaskResult & { ok: true }) => void) =>
    start(async () => {
      const r = await fn()
      setResult(r)
      if (r.ok) {
        onOk?.(r)
        router.refresh()
      }
    })
  const errors = result && !result.ok ? (result.fieldErrors ?? {}) : {}
  const formError = result && !result.ok && !result.fieldErrors ? result.error : null
  return { pending, submit, errors, formError, reset: () => setResult(null) }
}

/** Today in the viewer's own timezone, so "due today" matches their calendar. */
function useToday() {
  const [t, setT] = useState<string | null>(null)
  useEffect(() => setT(today()), [])
  return t
}

const dayFmt = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone: "UTC" })
const formatDue = (d: string) => dayFmt.format(new Date(`${d}T00:00:00Z`))

export function PriorityBadge({ priority }: { priority: TaskPriority }) {
  if (priority === "normal") return null
  return (
    <span
      className={cn(
        "rounded-full border px-1.5 py-0.5 text-[11px]",
        priority === "urgent" && "border-danger/50 text-danger",
        priority === "high" && "border-foreground/30",
        priority === "low" && "text-muted-foreground",
      )}
    >
      {PRIORITY_LABELS[priority]}
    </span>
  )
}

export function DueLabel({ dueOn, done }: { dueOn: string | null; done?: boolean }) {
  const t = useToday()
  if (!dueOn) return null
  const overdue = !done && t !== null && dueOn < t
  const isToday = !done && t === dueOn
  return (
    <span className={cn("tabular-nums", overdue && "font-medium text-danger")}>
      {isToday ? "Today" : overdue ? `Due ${formatDue(dueOn)}` : formatDue(dueOn)}
    </span>
  )
}

/** A round checkbox that completes or reopens a task. */
export function CompleteToggle({
  id,
  status,
  title,
}: {
  id: string
  status: TaskStatus
  title: string
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [optimistic, setOptimistic] = useState(status === "done")
  useEffect(() => setOptimistic(status === "done"), [status])
  return (
    <input
      type="checkbox"
      aria-label={optimistic ? `Reopen ${title}` : `Complete ${title}`}
      checked={optimistic}
      disabled={pending}
      onChange={(e) => {
        const done = e.target.checked
        setOptimistic(done)
        start(async () => {
          const r = await setTaskStatusAction(id, done ? "done" : "todo")
          if (!r.ok) {
            setOptimistic(!done)
            alert(r.error)
          }
          router.refresh()
        })
      }}
      className="mt-0.5 size-4 shrink-0 cursor-pointer rounded-full accent-current"
    />
  )
}

export type TaskRow = {
  id: string
  title: string
  status: TaskStatus
  priority: TaskPriority
  dueOn: string | null
  recurrence: string
  assigneeName: string | null
  projectId: string | null
  projectName: string | null
  checklistTotal: number
  checklistDone: number
  comments: number
}

function TaskLine({ t, showAssignee }: { t: TaskRow; showAssignee: boolean }) {
  const done = t.status === "done"
  return (
    <li className="flex items-start gap-3 px-4 py-3">
      <CompleteToggle id={t.id} status={t.status} title={t.title} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Link
            href={`/tasks/${t.id}`}
            className={cn(
              "text-sm font-medium hover:underline",
              done && "text-muted-foreground line-through",
            )}
          >
            {t.title}
          </Link>
          <PriorityBadge priority={t.priority} />
          {t.status === "in_progress" && (
            <span className="rounded-full bg-accent px-1.5 py-0.5 text-[11px]">In progress</span>
          )}
        </div>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground [&_svg]:size-3">
          <DueLabel dueOn={t.dueOn} done={done} />
          {t.recurrence !== "none" && (
            <span className="inline-flex items-center gap-1">
              <Repeat aria-hidden /> {RECURRENCE_LABELS[t.recurrence as "daily"]}
            </span>
          )}
          {t.projectName && t.projectId && (
            <Link href={`/projects/${t.projectId}`} className="hover:text-foreground">
              {t.projectName}
            </Link>
          )}
          {showAssignee && <span>{t.assigneeName ?? "Unassigned"}</span>}
          {t.checklistTotal > 0 && (
            <span className="inline-flex items-center gap-1">
              <CheckSquare aria-hidden /> {t.checklistDone}/{t.checklistTotal}
            </span>
          )}
          {t.comments > 0 && (
            <span className="inline-flex items-center gap-1">
              <MessageSquare aria-hidden /> {t.comments}
            </span>
          )}
        </p>
      </div>
    </li>
  )
}

const BUCKETS: DueBucket[] = ["overdue", "today", "week", "later", "none"]

/** Open tasks grouped by when they're due, using the viewer's own "today". */
export function TaskList({
  tasks,
  grouped,
  showAssignee,
  empty,
}: {
  tasks: TaskRow[]
  grouped: boolean
  showAssignee: boolean
  empty: string
}) {
  const t = useToday()
  if (tasks.length === 0)
    return (
      <p className="rounded-xl border p-10 text-center text-sm text-muted-foreground">{empty}</p>
    )
  if (!grouped || t === null)
    return (
      <ul className="divide-y rounded-xl border">
        {tasks.map((x) => (
          <TaskLine key={x.id} t={x} showAssignee={showAssignee} />
        ))}
      </ul>
    )
  return (
    <div className="grid gap-5">
      {BUCKETS.map((b) => {
        const items = tasks.filter((x) => dueBucket(x.dueOn, t) === b)
        if (!items.length) return null
        return (
          <section key={b} aria-label={BUCKET_LABELS[b]} className="grid gap-2">
            <h2
              className={cn(
                "px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground",
                b === "overdue" && "text-danger",
              )}
            >
              {BUCKET_LABELS[b]} <span className="font-normal">{items.length}</span>
            </h2>
            <ul className="divide-y rounded-xl border">
              {items.map((x) => (
                <TaskLine key={x.id} t={x} showAssignee={showAssignee} />
              ))}
            </ul>
          </section>
        )
      })}
    </div>
  )
}

/** One-line "add a task": title, optional due date; Enter saves. */
export function QuickAdd({
  assigneeId,
  projectId,
  placeholder = "Add a task…",
}: {
  assigneeId?: string
  projectId?: string
  placeholder?: string
}) {
  const { pending, submit, errors, formError } = useTaskAction()
  const [key, setKey] = useState(0)
  return (
    <form
      key={key}
      noValidate
      className="grid gap-1.5"
      onSubmit={(e) => {
        e.preventDefault()
        const f = new FormData(e.currentTarget)
        submit(
          () =>
            createTaskAction({
              title: String(f.get("title") ?? ""),
              dueOn: String(f.get("dueOn") ?? ""),
              assigneeId,
              projectId,
            }),
          () => setKey((k) => k + 1),
        )
      }}
    >
      <div className="flex flex-wrap gap-2">
        <div className="relative min-w-0 basis-full sm:basis-0 sm:grow">
          <Plus className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            name="title"
            aria-label="New task"
            placeholder={placeholder}
            maxLength={200}
            aria-invalid={!!errors.title || undefined}
            className={cn(control, "h-10 pl-9")}
          />
        </div>
        <input
          name="dueOn"
          type="date"
          aria-label="Due date"
          className={cn(control, "h-10 w-auto")}
        />
        <Button className="h-10" disabled={pending}>
          Add
        </Button>
      </div>
      {(errors.title || errors.dueOn || formError) && (
        <span className="text-xs text-danger">{errors.title ?? errors.dueOn ?? formError}</span>
      )}
    </form>
  )
}

export function TaskFilters({ members, projects }: { members: Member[]; projects: Option[] }) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const set = (k: string, v: string) => {
    const p = new URLSearchParams(params)
    if (v) p.set(k, v)
    else p.delete(k)
    router.push(`${pathname}${p.size ? `?${p}` : ""}`)
  }
  return (
    <div className="flex flex-wrap gap-2 [&>*]:min-w-0">
      <form
        role="search"
        className="basis-full sm:basis-56 sm:grow"
        onSubmit={(e) => {
          e.preventDefault()
          set("q", String(new FormData(e.currentTarget).get("q") ?? "").trim())
        }}
      >
        <input
          name="q"
          type="search"
          aria-label="Search tasks"
          placeholder="Search tasks…"
          defaultValue={params.get("q") ?? ""}
          className={cn(control, "h-9")}
        />
      </form>
      <Select
        aria-label="Assignee"
        className="grow basis-[calc(50%-0.25rem)] sm:grow-0 sm:basis-auto"
        value={params.get("assignee") ?? "me"}
        onChange={(e) => set("assignee", e.target.value === "me" ? "" : e.target.value)}
      >
        <option value="me">My tasks</option>
        <option value="all">Everyone's</option>
        <option value="none">Unassigned</option>
        {members.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </Select>
      <Select
        aria-label="Status"
        className="grow basis-[calc(50%-0.25rem)] sm:grow-0 sm:basis-auto"
        value={params.get("status") ?? "open"}
        onChange={(e) => set("status", e.target.value === "open" ? "" : e.target.value)}
      >
        <option value="open">Open</option>
        {TASK_STATUSES.map((s) => (
          <option key={s} value={s}>
            {STATUS_LABELS[s]}
          </option>
        ))}
      </Select>
      <Select
        aria-label="Priority"
        className="grow basis-[calc(50%-0.25rem)] sm:grow-0 sm:basis-auto"
        value={params.get("priority") ?? ""}
        onChange={(e) => set("priority", e.target.value)}
      >
        <option value="">Any priority</option>
        {[...TASK_PRIORITIES].reverse().map((p) => (
          <option key={p} value={p}>
            {PRIORITY_LABELS[p]}
          </option>
        ))}
      </Select>
      {projects.length > 0 && (
        <Select
          aria-label="Project"
          className="grow basis-[calc(50%-0.25rem)] sm:grow-0 sm:basis-auto"
          value={params.get("project") ?? ""}
          onChange={(e) => set("project", e.target.value)}
        >
          <option value="">Any project</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
      )}
    </div>
  )
}

// ---------- Task detail ----------

export type TaskFormValues = {
  title: string
  description: string
  status: TaskStatus
  priority: TaskPriority
  assigneeId: string
  projectId: string
  dueOn: string
  recurrence: string
  recurrenceInterval: string
}

export function TaskEditor({
  id,
  initial,
  members,
  projects,
  canEdit,
}: {
  id: string
  initial: TaskFormValues
  members: Member[]
  projects: Option[]
  canEdit: boolean
}) {
  const { pending, submit, errors, formError } = useTaskAction()
  const [saved, setSaved] = useState(false)
  const [recurrence, setRecurrence] = useState(initial.recurrence)
  return (
    <form
      noValidate
      className="grid gap-4"
      onChange={() => setSaved(false)}
      onSubmit={(e) => {
        e.preventDefault()
        // The server re-validates every field; this cast only satisfies the action's type.
        const v = Object.fromEntries(new FormData(e.currentTarget)) as unknown as TaskInput
        submit(
          () => updateTaskAction(id, v),
          () => setSaved(true),
        )
      }}
    >
      <fieldset disabled={!canEdit} className="grid gap-4">
        <Input
          label="Title"
          name="title"
          defaultValue={initial.title}
          error={errors.title}
          maxLength={200}
        />
        <Labeled label="Description" error={errors.description}>
          {(fid, d) => (
            <textarea
              id={fid}
              name="description"
              rows={5}
              maxLength={10_000}
              defaultValue={initial.description}
              aria-describedby={d}
              placeholder="Details, links, what done looks like…"
              className={cn(control, "py-2")}
            />
          )}
        </Labeled>
        <div className="grid gap-4 sm:grid-cols-3">
          <Choice label="Status" name="status" defaultValue={initial.status} error={errors.status}>
            {TASK_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </Choice>
          <Choice
            label="Priority"
            name="priority"
            defaultValue={initial.priority}
            error={errors.priority}
          >
            {TASK_PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {PRIORITY_LABELS[p]}
              </option>
            ))}
          </Choice>
          <Input
            label="Due"
            name="dueOn"
            type="date"
            defaultValue={initial.dueOn}
            error={errors.dueOn}
          />
          <Choice
            label="Assignee"
            name="assigneeId"
            defaultValue={initial.assigneeId}
            error={errors.assigneeId}
          >
            <option value="">Unassigned</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </Choice>
          <Choice
            label="Project"
            name="projectId"
            defaultValue={initial.projectId}
            error={errors.projectId}
          >
            <option value="">No project</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Choice>
          <div className="grid grid-cols-[minmax(0,1fr)_4.5rem] gap-2">
            <Choice
              label="Repeats"
              name="recurrence"
              value={recurrence}
              onChange={(e) => setRecurrence(e.target.value)}
              error={errors.recurrence}
            >
              {TASK_RECURRENCES.map((r) => (
                <option key={r} value={r}>
                  {RECURRENCE_LABELS[r]}
                </option>
              ))}
            </Choice>
            <Input
              label="Every"
              name="recurrenceInterval"
              type="number"
              min={1}
              max={365}
              defaultValue={initial.recurrenceInterval}
              disabled={recurrence === "none"}
              error={errors.recurrenceInterval}
            />
          </div>
        </div>
      </fieldset>
      {canEdit && (
        <div className="flex flex-wrap items-center gap-3">
          <Button disabled={pending}>{pending ? "Saving…" : "Save"}</Button>
          {saved && <span className="text-sm text-success">Saved</span>}
          {Object.keys(errors).length > 0 && (
            <span className="text-sm text-danger">Please fix the highlighted fields.</span>
          )}
          <ErrorText>{formError}</ErrorText>
        </div>
      )}
    </form>
  )
}

export function Checklist({
  taskId,
  items,
  canEdit,
}: {
  taskId: string
  items: { id: string; text: string; done: boolean }[]
  canEdit: boolean
}) {
  const router = useRouter()
  const { pending, submit, errors, formError } = useTaskAction()
  const [busy, start] = useTransition()
  const [key, setKey] = useState(0)
  const done = items.filter((i) => i.done).length
  const act = (fn: () => Promise<TaskResult>) =>
    start(async () => {
      const r = await fn()
      if (!r.ok) alert(r.error)
      router.refresh()
    })
  return (
    <div className="grid gap-3">
      {items.length > 0 && (
        <div className="flex items-center gap-3">
          <div
            className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-label="Checklist progress"
            aria-valuenow={done}
            aria-valuemax={items.length}
          >
            <div
              className="h-full bg-success"
              style={{ width: `${(done / items.length) * 100}%` }}
            />
          </div>
          <span className="text-xs tabular-nums text-muted-foreground">
            {done}/{items.length}
          </span>
        </div>
      )}
      <ul className="grid gap-1">
        {items.map((i) => (
          <li
            key={i.id}
            className="group flex items-center gap-2.5 rounded-md px-1 py-1 hover:bg-muted/50"
          >
            <input
              type="checkbox"
              checked={i.done}
              disabled={!canEdit || busy}
              aria-label={i.text}
              onChange={(e) => act(() => setChecklistItemDoneAction(i.id, e.target.checked))}
              className="size-4"
            />
            <span className={cn("flex-1 text-sm", i.done && "text-muted-foreground line-through")}>
              {i.text}
            </span>
            {canEdit && (
              <button
                type="button"
                aria-label={`Remove ${i.text}`}
                disabled={busy}
                onClick={() => act(() => deleteChecklistItemAction(i.id))}
                className="rounded p-1 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-danger focus-visible:opacity-100"
              >
                <X className="size-3.5" />
              </button>
            )}
          </li>
        ))}
      </ul>
      {canEdit && (
        <form
          key={key}
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            const text = String(new FormData(e.currentTarget).get("text") ?? "")
            submit(
              () => addChecklistItemAction(taskId, text),
              () => setKey((k) => k + 1),
            )
          }}
        >
          <input
            name="text"
            aria-label="New checklist item"
            placeholder="Add an item…"
            maxLength={300}
            className={cn(control, "h-8 flex-1")}
          />
          <Button size="sm" variant="ghost" disabled={pending}>
            Add
          </Button>
        </form>
      )}
      {(errors.text || formError) && (
        <span className="text-xs text-danger">{errors.text ?? formError}</span>
      )}
    </div>
  )
}

export function CommentBox({ taskId }: { taskId: string }) {
  const { pending, submit, errors, formError } = useTaskAction()
  const [key, setKey] = useState(0)
  return (
    <form
      key={key}
      className="grid gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        const body = String(new FormData(e.currentTarget).get("body") ?? "")
        submit(
          () => addCommentAction(taskId, body),
          () => setKey((k) => k + 1),
        )
      }}
    >
      <textarea
        name="body"
        rows={2}
        maxLength={5000}
        aria-label="Comment"
        placeholder="Write a comment…"
        className={cn(control, "py-2")}
      />
      <div className="flex items-center gap-3">
        <Button size="sm" disabled={pending}>
          {pending ? "Posting…" : "Comment"}
        </Button>
        {(errors.body || formError) && (
          <span className="text-xs text-danger">{errors.body ?? formError}</span>
        )}
      </div>
    </form>
  )
}

function ConfirmButton({
  label,
  confirmText,
  run,
  variant = "danger",
  size = "md",
  icon = true,
}: {
  label: string
  confirmText?: string
  run: () => Promise<TaskResult | undefined>
  variant?: "danger" | "ghost" | "quiet"
  size?: "md" | "sm" | "icon"
  icon?: boolean
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  return (
    <Button
      variant={variant}
      size={size}
      disabled={pending}
      aria-label={size === "icon" ? label : undefined}
      onClick={() => {
        if (confirmText && !confirm(confirmText)) return
        start(async () => {
          const r = await run()
          if (r && !r.ok) alert(r.error)
          router.refresh()
        })
      }}
    >
      {icon && <Trash2 />}
      {size !== "icon" && label}
    </Button>
  )
}

export const DeleteTaskButton = ({ id, title }: { id: string; title: string }) => (
  <ConfirmButton
    label="Delete task"
    confirmText={`Delete "${title}"? This can't be undone.`}
    run={() => deleteTaskAction(id)}
  />
)

export const DeleteCommentButton = ({ id }: { id: string }) => (
  <ConfirmButton
    label="Delete comment"
    size="icon"
    variant="quiet"
    confirmText="Delete this comment?"
    run={() => deleteCommentAction(id)}
  />
)

// ---------- Projects ----------

export function NewProjectForm() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const { pending, submit, errors, formError, reset } = useTaskAction()
  if (!open)
    return (
      <Button onClick={() => setOpen(true)}>
        <Plus /> New project
      </Button>
    )
  return (
    <form
      noValidate
      className="grid w-full gap-3 rounded-xl border p-4 sm:max-w-md"
      onSubmit={(e) => {
        e.preventDefault()
        const f = new FormData(e.currentTarget)
        submit(
          () =>
            createProjectAction({
              name: String(f.get("name") ?? ""),
              description: String(f.get("description") ?? ""),
            }),
          (r) => router.push(`/projects/${r.id}`),
        )
      }}
    >
      <Input label="Project name" name="name" autoFocus maxLength={120} error={errors.name} />
      <Input label="Description" name="description" maxLength={2000} error={errors.description} />
      <ErrorText>{formError}</ErrorText>
      <div className="flex gap-2">
        <Button disabled={pending}>{pending ? "Creating…" : "Create"}</Button>
        <Button
          type="button"
          variant="quiet"
          onClick={() => {
            reset()
            setOpen(false)
          }}
        >
          Cancel
        </Button>
      </div>
    </form>
  )
}

export function ProjectActions({
  id,
  name,
  archived,
}: {
  id: string
  name: string
  archived: boolean
}) {
  return (
    <div className="flex gap-2">
      <ConfirmButton
        label={archived ? "Restore" : "Archive"}
        variant="ghost"
        icon={false}
        run={() => setProjectStatusAction(id, !archived)}
      />
      <ConfirmButton
        label="Delete"
        confirmText={`Delete "${name}" and every task in it? This can't be undone. Archive it to keep the tasks.`}
        run={() => deleteProjectAction(id)}
      />
    </div>
  )
}

/** Moves a task between board columns from a keyboard-friendly select. */
export function StatusSelect({
  id,
  status,
  title,
}: {
  id: string
  status: TaskStatus
  title: string
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  return (
    <Select
      aria-label={`Status for ${title}`}
      value={status}
      disabled={pending}
      className="h-8 text-xs"
      onChange={(e) => {
        const next = e.target.value
        start(async () => {
          const r = await setTaskStatusAction(id, next)
          if (!r.ok) alert(r.error)
          router.refresh()
        })
      }}
    >
      {TASK_STATUSES.map((s) => (
        <option key={s} value={s}>
          {STATUS_LABELS[s]}
        </option>
      ))}
    </Select>
  )
}
