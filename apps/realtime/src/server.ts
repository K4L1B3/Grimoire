// Processo de tempo real (ADR-1): Socket.IO em /rt; Hocuspocus em /collab para a wiki.
import { createServer } from 'node:http'
import { Server } from 'socket.io'
import { and, eq } from 'drizzle-orm'
import { db, membership } from '@grimorio/db'
import { auth } from '@grimorio/db/auth'
import { room, type IO } from './ctx.ts'
import { registerChat } from './chat.ts'
import { registerSheets } from './sheets.ts'
import { registerBoard } from './board.ts'
import { registerLighting } from './lighting.ts'
import { handleCollabUpgrade, registerWiki } from './wiki.ts'
import { registerHandout } from './handout.ts'
import { registerMusic } from './music.ts'

const PORT = Number(process.env.PORT ?? 4000)

const http = createServer((req, res) => {
  if (req.url === '/rt/health') return void res.end('ok')
  res.writeHead(404).end()
})

// Em dev o web roda em outra porta; em produção o Caddy deixa tudo no mesmo domínio.
const origin = process.env.BETTER_AUTH_URL
const io: IO = new Server(http, { path: '/rt/socket.io', cors: origin ? { origin, credentials: true } : undefined, destroyUpgrade: false })

// A sessão vem do mesmo cookie do Better Auth; a campanha vem do handshake e precisa de membership.
io.use(async (socket, next) => {
  try {
    const session = await auth.api.getSession({ headers: new Headers(socket.handshake.headers as Record<string, string>) })
    const campaignId = String(socket.handshake.auth?.campaignId ?? '')
    if (!session || !campaignId) return next(new Error('unauthorized'))
    const [m] = await db.select({ role: membership.role }).from(membership).where(and(eq(membership.campaignId, campaignId), eq(membership.userId, session.user.id)))
    if (!m) return next(new Error('unauthorized'))
    socket.data = { member: { userId: session.user.id, role: m.role }, userName: session.user.name, campaignId }
    next()
  } catch (e) {
    next(e as Error)
  }
})

io.on('connection', (socket) => {
  socket.join([room(socket.data.campaignId), `u:${socket.data.member.userId}`])
  registerChat(io, socket)
  registerSheets(io, socket)
  registerBoard(io, socket)
  registerLighting(io, socket)
  registerWiki(io, socket)
  registerHandout(io, socket)
  registerMusic(io, socket)
})

// Hocuspocus divide o servidor HTTP com o Socket.IO; o Caddy manda /collab para cá.
http.on('upgrade', (req, socket, head) => {
  if (req.url?.startsWith('/collab')) handleCollabUpgrade(req, socket, head)
})

http.listen(PORT, () => console.log(`realtime em :${PORT}`))
