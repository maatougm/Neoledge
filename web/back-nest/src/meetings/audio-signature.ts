/**
 * Detect whether a buffer starts with a known audio container/codec signature.
 * Used to reject non-audio uploads that merely carry a spoofed Content-Type.
 *
 * Accepted formats:
 *  - MP3   : `FF Fx` (MPEG audio frame sync) or `ID3` (ID3v2 tag prefix)
 *  - WAV   : `RIFF` ... `WAVE` at offset 8
 *  - OGG   : `OggS`
 *  - FLAC  : `fLaC`
 *  - M4A / MP4 : `ftyp` atom at bytes 4-7
 *  - WebM / Matroska (EBML) : `1A 45 DF A3`
 */
export function isAudioBuffer(buf: Buffer): boolean {
  if (!buf || buf.length < 12) return false

  // MP3 — ID3v2 tag header
  if (buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) return true
  // MP3 — MPEG frame sync (FF Fx where first nibble of byte 1 is F)
  if (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0) return true

  // WAV — RIFF....WAVE
  if (
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
    buf[8] === 0x57 && buf[9] === 0x41 && buf[10] === 0x56 && buf[11] === 0x45
  ) return true

  // OGG — OggS
  if (buf[0] === 0x4f && buf[1] === 0x67 && buf[2] === 0x67 && buf[3] === 0x53) return true

  // FLAC — fLaC
  if (buf[0] === 0x66 && buf[1] === 0x4c && buf[2] === 0x61 && buf[3] === 0x43) return true

  // M4A / MP4 — ftyp atom at bytes 4-7
  if (buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70) return true

  // WebM / Matroska (EBML) — 1A 45 DF A3
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return true

  return false
}
