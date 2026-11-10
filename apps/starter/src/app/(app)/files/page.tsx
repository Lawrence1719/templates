import { can, requireOrg } from "@templates/auth/guards"
import { formatBytes, listFiles, MAX_FILE_BYTES } from "@templates/files"
import { Card, PageHeader } from "@templates/ui/card"
import { FileArchive, File as FileIcon, FileImage, FileSpreadsheet, FileText } from "lucide-react"
import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { DeleteFileButton, FileDropzone } from "@/components/files"
import { timeAgo } from "@/components/time-ago"

export const metadata: Metadata = { title: "Files" }

function iconFor(mime: string) {
  if (mime.startsWith("image/")) return FileImage
  if (mime.includes("spreadsheet") || mime === "text/csv") return FileSpreadsheet
  if (mime === "application/zip") return FileArchive
  if (mime.startsWith("text/") || mime.includes("pdf") || mime.includes("word")) return FileText
  return FileIcon
}

export default async function FilesPage() {
  const { user, orgId } = await requireOrg()
  const [canRead, canUpload, canDeleteAny] = await Promise.all([
    can({ file: ["read"] }),
    can({ file: ["upload"] }),
    can({ file: ["delete"] }),
  ])
  if (!canRead) redirect("/dashboard")
  const files = await listFiles({ orgId })

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
      <PageHeader title="Files" description="Documents and images shared in this organization." />
      {canUpload && <FileDropzone maxBytes={MAX_FILE_BYTES} />}
      <Card className="overflow-hidden p-0">
        {files.length === 0 ? (
          <p className="p-10 text-center text-sm text-muted-foreground">No files yet.</p>
        ) : (
          <ul className="divide-y">
            {files.map((f) => {
              const Icon = iconFor(f.mimeType)
              const canDelete = canDeleteAny || f.uploadedBy === user.id
              return (
                <li key={f.id} className="flex items-center gap-3 px-5 py-3">
                  <Icon className="size-5 shrink-0 text-muted-foreground" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <a
                      href={`/api/files/${f.id}`}
                      className="block truncate text-sm font-medium hover:underline"
                    >
                      {f.name}
                    </a>
                    <p className="text-xs text-muted-foreground">
                      {formatBytes(f.size)} · {f.uploaderName ?? "Former member"} ·{" "}
                      {timeAgo(f.createdAt)}
                    </p>
                  </div>
                  {/^image\/|pdf$/.test(f.mimeType) && (
                    <a
                      href={`/api/files/${f.id}?inline=1`}
                      target="_blank"
                      rel="noopener"
                      className="hidden text-sm text-muted-foreground hover:text-foreground sm:inline"
                    >
                      Preview
                    </a>
                  )}
                  {canDelete && <DeleteFileButton id={f.id} name={f.name} />}
                </li>
              )
            })}
          </ul>
        )}
      </Card>
    </div>
  )
}
