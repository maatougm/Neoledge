/** @file src/lib/download.ts — trigger a browser download for an in-memory Blob. */

/**
 * Download a Blob as `filename` by clicking a transient object-URL anchor.
 * Revokes the URL afterwards so we don't leak it for the page's lifetime.
 */
export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
