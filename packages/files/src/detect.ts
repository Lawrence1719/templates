/**
 * Works out what a file really is from its first bytes and its extension.
 * The browser's Content-Type is ignored: it's whatever the uploader says.
 * Returns null for anything not on the allow-list (executables, HTML, SVG…).
 */
export type Detected = { mime: string; ext: string; inline: boolean }

const startsWith = (b: Uint8Array, sig: number[], offset = 0) =>
  sig.every((v, i) => b[offset + i] === v)

const OFFICE: Record<string, string> = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
}
const TEXT: Record<string, string> = { txt: "text/plain", csv: "text/csv", md: "text/markdown" }

export function extensionOf(name: string) {
  const m = /\.([a-z0-9]{1,8})$/i.exec(name)
  return m?.[1]?.toLowerCase() ?? ""
}

export function detectType(bytes: Uint8Array, name: string): Detected | null {
  const ext = extensionOf(name)
  // Images and PDF can be shown in the browser; everything else downloads.
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    return { mime: "image/png", ext: "png", inline: true }
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return { mime: "image/jpeg", ext: "jpg", inline: true }
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38]))
    return { mime: "image/gif", ext: "gif", inline: true }
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8))
    return { mime: "image/webp", ext: "webp", inline: true }
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d]))
    return { mime: "application/pdf", ext: "pdf", inline: true }
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) {
    const office = OFFICE[ext]
    return office
      ? { mime: office, ext, inline: false }
      : { mime: "application/zip", ext: "zip", inline: false }
  }
  // Plain text only for text extensions, and only if it really is UTF-8 text.
  const text = TEXT[ext]
  if (text && isPlainText(bytes)) return { mime: text, ext, inline: false }
  return null
}

function isPlainText(bytes: Uint8Array) {
  if (bytes.includes(0)) return false
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes)
    return true
  } catch {
    return false
  }
}
