"use client"

import { ACCEPT, formatBytes } from "@templates/files/client"
import { Button } from "@templates/ui/button"
import { cn } from "@templates/ui/cn"
import { CheckCircle2, Loader2, Trash2, Upload, XCircle } from "lucide-react"
import { useRouter } from "next/navigation"
import { useRef, useState, useTransition } from "react"

type Item = { key: string; name: string; status: "uploading" | "done" | "error"; message?: string }

/** Drag-and-drop or click to upload. Files go up one at a time; the server re-checks everything. */
export function FileDropzone({
  maxBytes,
  attachTo,
}: {
  maxBytes: number
  attachTo?: { type: string; id: string }
}) {
  const router = useRouter()
  const input = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  const [items, setItems] = useState<Item[]>([])

  const update = (key: string, patch: Partial<Item>) =>
    setItems((xs) => xs.map((x) => (x.key === key ? { ...x, ...patch } : x)))

  async function upload(files: FileList | File[]) {
    const list = Array.from(files)
    const queued = list.map((f) => ({
      key: crypto.randomUUID(),
      name: f.name,
      status: "uploading" as const,
    }))
    setItems((xs) => [...queued, ...xs].slice(0, 10))
    for (const [i, f] of list.entries()) {
      const key = queued[i]?.key ?? ""
      if (f.size > maxBytes) {
        update(key, { status: "error", message: `Larger than ${formatBytes(maxBytes)}` })
        continue
      }
      const body = new FormData()
      body.set("file", f)
      if (attachTo) {
        body.set("attachType", attachTo.type)
        body.set("attachId", attachTo.id)
      }
      const res = await fetch("/api/files", { method: "POST", body }).catch(() => null)
      if (res?.ok) update(key, { status: "done" })
      else {
        const msg = (await res?.json().catch(() => null))?.error ?? "Upload failed"
        update(key, { status: "error", message: msg })
      }
    }
    router.refresh()
  }

  return (
    <div className="grid gap-3">
      <button
        type="button"
        onClick={() => input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault()
          setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setOver(false)
          if (e.dataTransfer.files.length) upload(e.dataTransfer.files)
        }}
        className={cn(
          "grid place-items-center gap-2 rounded-xl border border-dashed px-6 py-10 text-center transition-colors hover:bg-accent",
          over && "border-chart-1 bg-accent",
        )}
      >
        <Upload className="size-5 text-muted-foreground" aria-hidden />
        <span className="text-sm font-medium">Drop files here or click to upload</span>
        <span className="text-xs text-muted-foreground">
          Images, PDF, Office documents, CSV, text or ZIP · up to {formatBytes(maxBytes)}
        </span>
      </button>
      <input
        ref={input}
        type="file"
        multiple
        accept={ACCEPT}
        className="sr-only"
        tabIndex={-1}
        onChange={(e) => {
          if (e.target.files?.length) upload(e.target.files)
          e.target.value = ""
        }}
      />
      {items.length > 0 && (
        <ul className="grid gap-1.5" aria-live="polite">
          {items.map((it) => (
            <li key={it.key} className="flex items-center gap-2 text-sm">
              {it.status === "uploading" && (
                <Loader2 className="size-4 animate-spin text-muted-foreground" />
              )}
              {it.status === "done" && <CheckCircle2 className="size-4 text-success" />}
              {it.status === "error" && <XCircle className="size-4 text-danger" />}
              <span className="truncate">{it.name}</span>
              {it.message && <span className="text-danger">— {it.message}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function DeleteFileButton({ id, name }: { id: string; name: string }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  return (
    <Button
      variant="danger"
      size="icon"
      aria-label={`Delete ${name}`}
      disabled={pending}
      onClick={() => {
        if (!confirm(`Delete "${name}"? This can't be undone.`)) return
        start(async () => {
          const res = await fetch(`/api/files/${id}`, { method: "DELETE" })
          if (!res.ok)
            alert((await res.json().catch(() => null))?.error ?? "Couldn't delete the file.")
          router.refresh()
        })
      }}
    >
      <Trash2 />
    </Button>
  )
}
