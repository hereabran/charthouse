import type { IncomingMessage, ServerResponse } from 'node:http'

export async function readJson<T = unknown>(req: IncomingMessage, maxBytes = 5 * 1024 * 1024): Promise<T> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > maxBytes) {
        reject(new Error('request body too large'))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => {
      try {
        const buf = Buffer.concat(chunks).toString('utf8')
        resolve(buf ? (JSON.parse(buf) as T) : ({} as T))
      } catch (err) {
        reject(err)
      }
    })
    req.on('error', reject)
  })
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(body))
}

export function methodNotAllowed(res: ServerResponse, allowed: string[]): void {
  res.statusCode = 405
  res.setHeader('allow', allowed.join(', '))
  res.end()
}
