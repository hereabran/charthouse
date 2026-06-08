import type { IncomingMessage, ServerResponse } from 'node:http'
import { runHelmTemplate, RenderInputError, type RenderInput } from './_lib/helm'
import { methodNotAllowed, readJson, sendJson } from './_lib/json-handler'

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'POST') {
    methodNotAllowed(res, ['POST'])
    return
  }
  let body: RenderInput
  try {
    body = await readJson<RenderInput>(req)
  } catch (err) {
    sendJson(res, 400, { ok: false, stdout: '', stderr: `bad request: ${(err as Error).message}`, durationMs: 0 })
    return
  }

  try {
    const result = await runHelmTemplate({
      files: body.files ?? {},
      releaseName: body.releaseName ?? 'demo',
      namespace: body.namespace ?? 'default',
      includeCRDs: !!body.includeCRDs,
    })
    // 422 when helm itself reported a template error — body still has stderr for the UI.
    sendJson(res, result.ok ? 200 : 422, result)
  } catch (err) {
    if (err instanceof RenderInputError) {
      sendJson(res, 400, { ok: false, stdout: '', stderr: err.message, durationMs: 0 })
      return
    }
    sendJson(res, 500, { ok: false, stdout: '', stderr: `server error: ${(err as Error).message}`, durationMs: 0 })
  }
}
