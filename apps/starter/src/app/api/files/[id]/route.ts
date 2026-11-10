import { deleteFile, downloadResponse, FileError } from "@templates/files"

import { filesContext } from "@/lib/files-context"

const fail = (e: unknown) => {
  if (e instanceof FileError) return Response.json({ error: e.message }, { status: e.status })
  throw e
}

export async function GET(request: Request, { params }: RouteContext<"/api/files/[id]">) {
  const { ctx, error } = await filesContext({ file: ["read"] })
  if (error) return error
  const inline = new URL(request.url).searchParams.get("inline") === "1"
  return downloadResponse(ctx, (await params).id, { inline }).catch(fail)
}

export async function DELETE(_request: Request, { params }: RouteContext<"/api/files/[id]">) {
  // Members may delete their own files, so only `read` is required here;
  // deleteFile() enforces own-file vs any-file.
  const { ctx, error } = await filesContext({ file: ["read"] })
  if (error) return error
  try {
    await deleteFile(ctx, (await params).id)
    return new Response(null, { status: 204 })
  } catch (e) {
    return fail(e)
  }
}
