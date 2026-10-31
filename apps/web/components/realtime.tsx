'use client'
import { createContext, useContext, useEffect, useState } from 'react'
import { io, type Socket } from 'socket.io-client'
import type { Member } from '@grimorio/core'

type Ctx = { socket: Socket; me: Member; campaignId: string; connected: boolean }
const RealtimeContext = createContext<Ctx | null>(null)

// Uma conexão por campanha aberta; reconecta sozinha sem recarregar a página (SDD §8).
export function Realtime({ campaignId, me, children }: { campaignId: string; me: Member; children: React.ReactNode }) {
  const [socket] = useState(() => io(process.env.NEXT_PUBLIC_RT_URL || undefined, { path: '/rt/socket.io', withCredentials: true, auth: { campaignId }, autoConnect: false }))
  const [connected, setConnected] = useState(false)
  useEffect(() => {
    const on = () => setConnected(true), off = () => setConnected(false)
    socket.on('connect', on).on('disconnect', off).connect()
    return () => void socket.off('connect', on).off('disconnect', off).disconnect()
  }, [socket])
  return <RealtimeContext.Provider value={{ socket, me, campaignId, connected }}>{children}</RealtimeContext.Provider>
}

export function useRealtime() {
  const ctx = useContext(RealtimeContext)
  if (!ctx) throw new Error('useRealtime fora de <Realtime>')
  return ctx
}

// Emite e espera o ack do servidor; rejeita com a mensagem de erro dele.
export function request<T = unknown>(socket: Socket, event: string, payload: unknown = {}): Promise<T> {
  return new Promise((resolve, reject) =>
    socket.timeout(10_000).emit(event, payload, (err: Error | null, res: { ok: boolean; data?: T; error?: string }) => {
      if (err) reject(new Error('O servidor não respondeu'))
      else if (!res.ok) reject(new Error(res.error))
      else resolve(res.data as T)
    }),
  )
}

export function useSocketEvent<T>(event: string, fn: (payload: T) => void) {
  const { socket } = useRealtime()
  useEffect(() => {
    socket.on(event, fn)
    return () => void socket.off(event, fn)
  }, [socket, event, fn])
}
