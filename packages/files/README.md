# Files

Uploads and downloads for any organization, stored on S3-compatible storage (or local disk in development), with the file's real type checked from its bytes.

## Features

- **Files page** with drag-and-drop or click-to-upload, per-file progress and errors, preview for images/PDF, delete
- **Attach to any record**: `attachTo: { type: "customer", id }`, then `listFiles(ctx, { attachedTo })`
- **Storage**: AWS S3, Cloudflare R2, Supabase Storage or MinIO via `S3_*` settings; local disk (`.storage/`) otherwise. Implement `Storage` for anything else.
- **Allowed types**: PNG, JPEG, GIF, WebP, PDF, DOCX/XLSX/PPTX, ZIP, TXT, CSV, Markdown — up to `MAX_FILE_BYTES` (10 MB)
- **Permissions**: `file: ["read", "upload", "delete"]`. Members read and upload, and delete only what they uploaded; owners and admins delete anything.
- **Audit**: uploads and deletes are logged

## Security

| Threat                                       | Defense                                                                                                                                                  |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A script or program renamed `photo.png`      | Type is detected from the first bytes; anything off the allow-list (HTML, SVG, executables) is refused with 415                                          |
| Path traversal in names (`../../etc/passwd`) | Names are sanitized to a bare filename; storage keys are `<org>/<random uuid>`, never derived from the name, and storage refuses any other key shape     |
| Stored XSS via download                      | `Content-Disposition: attachment`, `X-Content-Type-Options: nosniff`, CSP `default-src 'none'; sandbox`; only images and PDF may open inline, text never |
| Reading another org's files                  | Every lookup filters by the session's org; foreign IDs get 404 (existence isn't revealed)                                                                |
| Huge uploads                                 | Rejected by `Content-Length` before reading, and by actual size after                                                                                    |
| Orphaned bytes                               | If the database insert fails, the stored object is deleted                                                                                               |

## Usage

Upload from any server code:

```ts
import { uploadFile } from "@templates/files"

const f = await uploadFile(ctx, {
  name: file.name,
  bytes,
  attachTo: { type: "invoice", id: invoice.id },
})
```

The starter exposes:

| Route                   | Does                                                          |
| ----------------------- | ------------------------------------------------------------- |
| `POST /api/files`       | multipart upload (`file`, optional `attachType` + `attachId`) |
| `GET /api/files/:id`    | download (`?inline=1` to preview images/PDF)                  |
| `DELETE /api/files/:id` | delete (own files, or any with `file:delete`)                 |

Reuse the dropzone on any page: `<FileDropzone maxBytes={MAX_FILE_BYTES} attachTo={{ type: "customer", id }} />`.

## Setup

1. `pnpm --filter @templates/db db:migrate`
2. For production storage, set `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` (and `S3_REGION`) in `.env`
