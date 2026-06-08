import pako from 'pako'
import type { SharePayload } from '@/types/chart'

function toBase64Url(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(str: string): Uint8Array {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (str.length % 4)) % 4)
  const bin = atob(padded)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export function encodePayloadToHash(payload: SharePayload): string {
  const json = JSON.stringify(payload)
  const compressed = pako.deflate(json)
  return '#h=' + toBase64Url(compressed)
}

export function decodePayloadFromHash(hash: string): SharePayload | null {
  const m = hash.match(/[#&]h=([A-Za-z0-9_-]+)/)
  if (!m) return null
  try {
    const bytes = fromBase64Url(m[1])
    const json = pako.inflate(bytes, { to: 'string' })
    return JSON.parse(json) as SharePayload
  } catch {
    return null
  }
}

export async function createShortShare(payload: SharePayload): Promise<{ id: string } | null> {
  const res = await fetch('/api/share', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ payload }),
  })
  if (res.status === 503) return null // sharing unconfigured
  if (!res.ok) throw new Error(`share failed: HTTP ${res.status}`)
  return (await res.json()) as { id: string }
}

export async function loadShortShare(id: string): Promise<SharePayload | null> {
  const res = await fetch(`/api/share?id=${encodeURIComponent(id)}`)
  if (res.status === 404 || res.status === 503) return null
  if (!res.ok) throw new Error(`load share failed: HTTP ${res.status}`)
  const json = (await res.json()) as { id: string; payload: SharePayload }
  return json.payload ?? null
}
