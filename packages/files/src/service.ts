import "server-only"

import { createHash, randomUUID } from "node:crypto"

import { audit } from "@templates/audit"
import { db } from "@templates/db"
import { type FileRecord, file, user } from "@templates/db/schema"
import { and, desc, eq } from "drizzle-orm"
import { z } from "zod"

import { detectType } from "./detect"
import { contentDisposition, sanitizeName } from "./names"
import { type Bytes, getStorage } from "./storage"

export const MAX_FILE_BYTES = Number(process.env.MAX_FILE_BYTES ?? 10 * 1024 * 1024)

/** Who is acting. Built by the caller from the session (see starter routes). */
export type FilesContext = {
  orgId: string
  user: { id: string; name: string; email: string }
  /** True for roles allowed to delete anyone's files. Uploaders can always delete their own. */
  canDeleteAny: boolean
}

export class FileError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 403 | 404 | 413 | 415,
  ) {
    super(message)
  }
}

const attachSchema = z.object({
  type: z.string().regex(/^[a-z][a-z0-9_.-]{0,40}$/),
  id: z.string().min(1).max(100),
})

/** Validates, stores and records one file. */
export async function uploadFile(
  ctx: FilesContext,
  input: { name: string; bytes: Bytes; attachTo?: { type: string; id: string } },
): Promise<FileRecord> {
  if (input.bytes.byteLength === 0) throw new FileError("The file is empty.", 400)
  if (input.bytes.byteLength > MAX_FILE_BYTES)
    throw new FileError(`Files can be up to ${Math.round(MAX_FILE_BYTES / 1024 / 1024)} MB.`, 413)

  const type = detectType(input.bytes, input.name)
  if (!type) throw new FileError("This file type isn't allowed.", 415)
  const attach = input.attachTo ? attachSchema.safeParse(input.attachTo) : null
  if (attach && !attach.success) throw new FileError("Invalid attachment target.", 400)

  const name = sanitizeName(input.name, type.ext)
  const storageKey = `${ctx.orgId}/${randomUUID()}`
  const sha256 = createHash("sha256").update(input.bytes).digest("hex")

  const storage = getStorage()
  await storage.put(storageKey, input.bytes, type.mime)
  let row: FileRecord | undefined
  try {
    ;[row] = await db
      .insert(file)
      .values({
        orgId: ctx.orgId,
        uploadedBy: ctx.user.id,
        name,
        mimeType: type.mime,
        size: input.bytes.byteLength,
        sha256,
        storageKey,
        attachedToType: attach?.data?.type ?? null,
        attachedToId: attach?.data?.id ?? null,
      })
      .returning()
  } catch (e) {
    await storage.delete(storageKey).catch(() => {})
    throw e
  }
  if (!row) throw new Error("File insert returned nothing")
  await audit(ctx, "file.uploaded", `Uploaded ${name}`, {
    target: { type: "file", id: row.id },
    metadata: { size: row.size, mimeType: row.mimeType },
  })
  return row
}

/** Parses a multipart upload request (field "file", optional "attachType"/"attachId"). */
export async function uploadFromRequest(ctx: FilesContext, request: Request) {
  const declared = Number(request.headers.get("content-length") ?? 0)
  if (declared > MAX_FILE_BYTES + 64 * 1024) throw new FileError("File too large.", 413)
  const form = await request.formData().catch(() => null)
  const f = form?.get("file")
  if (!f || typeof f === "string") throw new FileError("No file in the request.", 400)
  const attachType = form?.get("attachType")
  const attachId = form?.get("attachId")
  return uploadFile(ctx, {
    name: f.name,
    bytes: new Uint8Array(await f.arrayBuffer()),
    attachTo:
      typeof attachType === "string" && typeof attachId === "string"
        ? { type: attachType, id: attachId }
        : undefined,
  })
}

/** A file in the caller's org, or a 404 (never reveals that it exists elsewhere). */
async function findOwn(ctx: Pick<FilesContext, "orgId">, id: string) {
  if (!z.uuid().safeParse(id).success) throw new FileError("Not found", 404)
  const [row] = await db
    .select()
    .from(file)
    .where(and(eq(file.id, id), eq(file.orgId, ctx.orgId)))
  if (!row) throw new FileError("Not found", 404)
  return row
}

/** Builds the download response with headers that stop the browser running anything. */
export async function downloadResponse(
  ctx: Pick<FilesContext, "orgId">,
  id: string,
  opts: { inline?: boolean } = {},
) {
  const row = await findOwn(ctx, id)
  const bytes = await getStorage().get(row.storageKey)
  if (!bytes) throw new FileError("Not found", 404)
  const inlineAllowed = /^image\/(png|jpeg|gif|webp)$|^application\/pdf$/.test(row.mimeType)
  const type = row.mimeType.startsWith("text/") ? `${row.mimeType}; charset=utf-8` : row.mimeType
  return new Response(bytes, {
    headers: {
      "Content-Type": type,
      "Content-Length": String(bytes.byteLength),
      "Content-Disposition": contentDisposition(row.name, !!opts.inline && inlineAllowed),
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy":
        "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
      "Cache-Control": "private, no-store",
    },
  })
}

export async function deleteFile(ctx: FilesContext, id: string) {
  const row = await findOwn(ctx, id)
  if (!ctx.canDeleteAny && row.uploadedBy !== ctx.user.id)
    throw new FileError("You can only delete files you uploaded.", 403)
  await db.delete(file).where(and(eq(file.id, row.id), eq(file.orgId, ctx.orgId)))
  await getStorage().delete(row.storageKey)
  await audit(ctx, "file.deleted", `Deleted ${row.name}`, { target: { type: "file", id: row.id } })
}

/** Files in the org, newest first, optionally only those attached to one record. */
export async function listFiles(
  ctx: Pick<FilesContext, "orgId">,
  opts: { attachedTo?: { type: string; id: string }; limit?: number } = {},
) {
  return db
    .select({
      id: file.id,
      name: file.name,
      mimeType: file.mimeType,
      size: file.size,
      createdAt: file.createdAt,
      uploadedBy: file.uploadedBy,
      uploaderName: user.name,
      attachedToType: file.attachedToType,
      attachedToId: file.attachedToId,
    })
    .from(file)
    .leftJoin(user, eq(user.id, file.uploadedBy))
    .where(
      and(
        eq(file.orgId, ctx.orgId),
        opts.attachedTo ? eq(file.attachedToType, opts.attachedTo.type) : undefined,
        opts.attachedTo ? eq(file.attachedToId, opts.attachedTo.id) : undefined,
      ),
    )
    .orderBy(desc(file.createdAt))
    .limit(Math.min(opts.limit ?? 100, 500))
}

export type FileListItem = Awaited<ReturnType<typeof listFiles>>[number]
