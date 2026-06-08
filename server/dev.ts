import 'dotenv/config'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import renderHandler from '../api/render'
import shareHandler from '../api/share'

const PORT = Number(process.env.API_PORT || 5174)

type Handler = (req: IncomingMessage, res: ServerResponse) => Promise<void> | void

const routes: Record<string, Handler> = {
  '/api/render': renderHandler,
  '/api/share': shareHandler,
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`)
  const handler = routes[url.pathname]
  if (!handler) {
    res.statusCode = 404
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ error: 'not found', path: url.pathname }))
    return
  }
  try {
    await handler(req, res)
  } catch (err) {
    res.statusCode = 500
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ error: (err as Error).message }))
  }
})

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[helm-playground] dev API listening on http://localhost:${PORT}`)
})
