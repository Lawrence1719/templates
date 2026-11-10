import { FileError, uploadFromRequest } from "@templates/files"

import { filesContext } from "@/lib/files-context"

export async function POST(request: Request) {
  const { ctx, error } = await filesContext({ file: ["upload"] })
  if (error) return error
  try {
    const f = await uploadFromRequest(ctx, request)
    return Response.json(
      { id: f.id, name: f.name, size: f.size, mimeType: f.mimeType },
      { status: 201 },
    )
  } catch (e) {
    if (e instanceof FileError) return Response.json({ error: e.message }, { status: e.status })
    throw e
  }
}
