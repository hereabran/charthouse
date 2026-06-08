import type { IncomingMessage, ServerResponse } from 'node:http'
import { customAlphabet } from 'nanoid'
import { getSupabase, SHARES_TABLE } from './_lib/supabase'
import { methodNotAllowed, readJson, sendJson } from './_lib/json-handler'

const nanoid = customAlphabet('23456789abcdefghjkmnpqrstuvwxyz', 8)
const MAX_PAYLOAD_BYTES = 256 * 1024

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const sb = getSupabase()
  if (!sb) {
    sendJson(res, 503, { error: 'sharing not configured: set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY' })
    return
  }

  if (req.method === 'GET') {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const id = url.searchParams.get('id')
    if (!id || !/^[a-z0-9]{6,16}$/.test(id)) {
      sendJson(res, 400, { error: 'invalid id' })
      return
    }
    const { data, error } = await sb
      .from(SHARES_TABLE)
      .select('payload')
      .eq('id', id)
      .maybeSingle()
    if (error) { sendJson(res, 500, { error: error.message }); return }
    if (!data) { sendJson(res, 404, { error: 'not found' }); return }
    sendJson(res, 200, { id, payload: data.payload })
    return
  }

  if (req.method === 'POST') {
    let body: { payload?: unknown }
    try {
      body = await readJson(req, MAX_PAYLOAD_BYTES)
    } catch (err) {
      sendJson(res, 400, { error: `bad request: ${(err as Error).message}` })
      return
    }
    if (!body.payload || typeof body.payload !== 'object') {
      sendJson(res, 400, { error: 'payload required' })
      return
    }
    const id = nanoid()
    const { error } = await sb
      .from(SHARES_TABLE)
      .insert({ id, payload: body.payload })
    if (error) { sendJson(res, 500, { error: error.message }); return }
    sendJson(res, 200, { id })
    return
  }

  methodNotAllowed(res, ['GET', 'POST'])
}
