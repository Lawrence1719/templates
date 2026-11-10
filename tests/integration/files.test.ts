import { mkdtemp, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { auditFilterSchema, listAuditLog } from "@templates/audit"
import {
  contentDisposition,
  deleteFile,
  detectType,
  downloadResponse,
  type FilesContext,
  LocalStorage,
  listFiles,
  MAX_FILE_BYTES,
  sanitizeName,
  setStorage,
  uploadFile,
} from "@templates/files"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { addMember, newOrgOwner } from "../setup/client"

let dir: string
beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "files-test-"))
  setStorage(new LocalStorage(dir))
})
afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
})

const PNG = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  ),
  (c) => c.charCodeAt(0),
)
const PDF = new TextEncoder().encode("%PDF-1.4\n1 0 obj<<>>endobj\n%%EOF\n")
const text = (s: string) => new TextEncoder().encode(s)

const ctxOf = (
  u: { id: string; name: string; email: string },
  orgId: string,
  canDeleteAny = false,
): FilesContext => ({
  orgId,
  user: { id: u.id, name: u.name, email: u.email },
  canDeleteAny,
})

describe("type detection", () => {
  it.each([
    ["photo.png", PNG, "image/png"],
    ["scan.PDF", PDF, "application/pdf"],
    ["data.csv", text("a,b\n1,2\n"), "text/csv"],
    ["notes.md", text("# Hi"), "text/markdown"],
    [
      "report.docx",
      Uint8Array.of(0x50, 0x4b, 0x03, 0x04, 1, 2),
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ],
  ])("accepts %s", (name, bytes, mime) => {
    expect(detectType(bytes, name)?.mime).toBe(mime)
  })

  it.each([
    ["page.html", text("<html><script>alert(1)</script></html>")],
    ["icon.svg", text("<svg onload=alert(1)>")],
    ["setup.exe", Uint8Array.of(0x4d, 0x5a, 0x90, 0)],
    ["photo.png", Uint8Array.of(0x4d, 0x5a, 0x90, 0)], // a program wearing a .png name
    ["data.csv", Uint8Array.of(0x61, 0, 0x62)], // binary pretending to be text
    ["readme", text("no extension")],
  ])("rejects %s", (name, bytes) => {
    expect(detectType(bytes, name)).toBeNull()
  })

  it("trusts the bytes, not the name", () => {
    expect(detectType(PNG, "document.pdf")?.mime).toBe("image/png")
  })
})

describe("file names", () => {
  it.each([
    ["../../etc/passwd.pdf", "pdf", "passwd.pdf"],
    ["C:\\Users\\me\\scan.pdf", "pdf", "scan.pdf"],
    ["evil\u0000name.png", "png", "evilname.png"],
    ['a<b>:"c|d?.png', "png", "abcd.png"],
    [".htaccess", "txt", "htaccess.txt"],
    ["photo.pdf", "png", "photo.png"], // extension follows the real type
    ["", "png", "file.png"],
    ["Résumé final.pdf", "pdf", "Résumé final.pdf"],
  ])("%j → %s", (raw, ext, expected) => {
    expect(sanitizeName(raw, ext)).toBe(expected)
  })

  it("caps long names", () => {
    expect(sanitizeName(`${"a".repeat(500)}.pdf`, "pdf").length).toBeLessThanOrEqual(200)
  })

  it("encodes download names safely", () => {
    expect(contentDisposition('Résumé "final".pdf', false)).toBe(
      `attachment; filename="R_sum_ _final_.pdf"; filename*=UTF-8''R%C3%A9sum%C3%A9%20%22final%22.pdf`,
    )
  })
})

describe("upload and download", () => {
  it("round-trips the bytes with protective headers", async () => {
    const org = await newOrgOwner("Acme")
    const ctx = ctxOf(org, org.orgId)
    const f = await uploadFile(ctx, { name: "logo.png", bytes: PNG })
    expect(f).toMatchObject({ name: "logo.png", mimeType: "image/png", size: PNG.byteLength })
    expect(f.storageKey).toBe(`${org.orgId}/${f.storageKey.split("/")[1]}`)
    expect(f.storageKey).not.toContain("logo")

    const res = await downloadResponse(ctx, f.id)
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG)
    expect(res.headers.get("x-content-type-options")).toBe("nosniff")
    expect(res.headers.get("content-security-policy")).toContain("sandbox")
    expect(res.headers.get("content-disposition")).toMatch(/^attachment;/)
    expect(
      (await downloadResponse(ctx, f.id, { inline: true })).headers.get("content-disposition"),
    ).toMatch(/^inline;/)
  })

  it("never serves text inline, even when asked", async () => {
    const org = await newOrgOwner("Acme")
    const ctx = ctxOf(org, org.orgId)
    const f = await uploadFile(ctx, { name: "notes.txt", bytes: text("<script>alert(1)</script>") })
    const res = await downloadResponse(ctx, f.id, { inline: true })
    expect(res.headers.get("content-disposition")).toMatch(/^attachment;/)
    expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8")
  })

  it("rejects empty, oversized and disallowed files", async () => {
    const org = await newOrgOwner("Acme")
    const ctx = ctxOf(org, org.orgId)
    await expect(uploadFile(ctx, { name: "a.txt", bytes: new Uint8Array() })).rejects.toMatchObject(
      { status: 400 },
    )
    const big = new Uint8Array(MAX_FILE_BYTES + 1)
    big.set(PNG)
    await expect(uploadFile(ctx, { name: "big.png", bytes: big })).rejects.toMatchObject({
      status: 413,
    })
    await expect(uploadFile(ctx, { name: "x.html", bytes: text("<html>") })).rejects.toMatchObject({
      status: 415,
    })
    expect(await listFiles(ctx)).toHaveLength(0)
  })

  it("logs uploads and deletes to the audit log", async () => {
    const org = await newOrgOwner("Acme")
    const ctx = ctxOf(org, org.orgId)
    const f = await uploadFile(ctx, { name: "scan.pdf", bytes: PDF })
    await deleteFile(ctx, f.id)
    const { rows } = await listAuditLog(org.orgId, auditFilterSchema.parse({}))
    const actions = rows.map((r) => r.action)
    expect(actions).toContain("file.uploaded")
    expect(actions).toContain("file.deleted")
  })

  it("filters by attachment", async () => {
    const org = await newOrgOwner("Acme")
    const ctx = ctxOf(org, org.orgId)
    await uploadFile(ctx, { name: "a.pdf", bytes: PDF, attachTo: { type: "customer", id: "c1" } })
    await uploadFile(ctx, { name: "b.pdf", bytes: PDF, attachTo: { type: "customer", id: "c2" } })
    const files = await listFiles(ctx, { attachedTo: { type: "customer", id: "c1" } })
    expect(files.map((f) => f.name)).toEqual(["a.pdf"])
    await expect(
      uploadFile(ctx, { name: "c.pdf", bytes: PDF, attachTo: { type: "../x", id: "1" } }),
    ).rejects.toMatchObject({ status: 400 })
  })
})

describe("tenant isolation", () => {
  it("another organization can't list, download or delete a file", async () => {
    const acme = await newOrgOwner("Acme")
    const other = await newOrgOwner("Other")
    const f = await uploadFile(ctxOf(acme, acme.orgId), { name: "secret.pdf", bytes: PDF })
    const intruder = ctxOf(other, other.orgId, true)

    expect(await listFiles(intruder)).toHaveLength(0)
    await expect(downloadResponse(intruder, f.id)).rejects.toMatchObject({ status: 404 })
    await expect(deleteFile(intruder, f.id)).rejects.toMatchObject({ status: 404 })
    // Still there for its owner.
    expect((await downloadResponse(ctxOf(acme, acme.orgId), f.id)).status).toBe(200)
  })

  it("answers malformed IDs with 404", async () => {
    const org = await newOrgOwner("Acme")
    await expect(downloadResponse(ctxOf(org, org.orgId), "../../etc/passwd")).rejects.toMatchObject(
      { status: 404 },
    )
  })

  it("storage refuses keys outside the org/file pattern", async () => {
    const s = new LocalStorage(dir)
    await expect(s.get("../../etc/passwd")).rejects.toThrow(/Invalid storage key/)
  })
})

describe("delete permissions", () => {
  it("members delete only their own files; admins delete any", async () => {
    const org = await newOrgOwner("Acme")
    const alice = await addMember(org, "member")
    const bob = await addMember(org, "member")
    const admin = await addMember(org, "admin")

    const alicesFile = await uploadFile(ctxOf(alice, org.orgId), { name: "a.pdf", bytes: PDF })
    await expect(deleteFile(ctxOf(bob, org.orgId), alicesFile.id)).rejects.toMatchObject({
      status: 403,
    })

    const bobsFile = await uploadFile(ctxOf(bob, org.orgId), { name: "b.pdf", bytes: PDF })
    await deleteFile(ctxOf(bob, org.orgId), bobsFile.id)

    await deleteFile(ctxOf(admin, org.orgId, true), alicesFile.id)
    expect(await listFiles(ctxOf(org, org.orgId))).toHaveLength(0)
  })

  it("removes the stored bytes on delete", async () => {
    const org = await newOrgOwner("Acme")
    const ctx = ctxOf(org, org.orgId)
    const f = await uploadFile(ctx, { name: "x.pdf", bytes: PDF })
    expect(await readdir(path.join(dir, org.orgId))).toHaveLength(1)
    await deleteFile(ctx, f.id)
    expect(await readdir(path.join(dir, org.orgId))).toHaveLength(0)
  })

  it.each([
    ["member", { file: ["read", "upload"] }, true],
    ["member", { file: ["delete"] }, false],
    ["admin", { file: ["delete"] }, true],
  ] as const)("%s → %j is %s", async (role, permissions, expected) => {
    const org = await newOrgOwner("Acme")
    const m = await addMember(org, role)
    expect(
      (await m.client.call("/organization/has-permission", { permissions })).data.success,
    ).toBe(expected)
  })
})
