// THE file-size formatter (B / KB / MB). Was previously re-implemented in five
// files (portal documents, portal ticket detail, operator ticket detail, the
// vendor job page, and document-display's formatFileSize). One rounding rule:
// whole KB below 1 MB, one decimal above.
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
