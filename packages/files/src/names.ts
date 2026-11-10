import { extensionOf } from "./detect"

/**
 * A safe display name: no folders, no control characters, bounded length,
 * and an extension that matches the detected type.
 */
export function sanitizeName(raw: string, detectedExt: string) {
  let name = (raw.split(/[\\/]/).pop() ?? "")
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f<>:"|?*]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "")
  const ext = extensionOf(name)
  const sameKind = ext === detectedExt || (detectedExt === "jpg" && ext === "jpeg")
  if (!sameKind) name = `${name.replace(/\.[^.]*$/, "") || "file"}.${detectedExt}`
  if (name.length > 200) name = `${name.slice(0, 190).trim()}.${detectedExt}`
  return name.startsWith(".") || name === `.${detectedExt}` ? `file.${detectedExt}` : name
}

/** Content-Disposition with an ASCII fallback and the full UTF-8 name (RFC 6266 / 5987). */
export function contentDisposition(name: string, inline: boolean) {
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_")
  return `${inline ? "inline" : "attachment"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`
}
