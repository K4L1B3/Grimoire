// Better Auth (ADR-6): email/senha com argon2 + Discord. Web e realtime usam a mesma instância para ler a sessão.
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { hash, verify } from '@node-rs/argon2'
import { db } from './index.ts'
import * as schema from './schema.ts'

const discord = process.env.DISCORD_CLIENT_ID && process.env.DISCORD_CLIENT_SECRET
  ? { discord: { clientId: process.env.DISCORD_CLIENT_ID, clientSecret: process.env.DISCORD_CLIENT_SECRET } }
  : undefined

export const discordEnabled = !!discord

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: 'pg', schema: { user: schema.user, session: schema.session, account: schema.account, verification: schema.verification } }),
  emailAndPassword: {
    enabled: true,
    password: { hash: (p) => hash(p), verify: ({ hash: h, password }) => verify(h, password) },
  },
  socialProviders: discord,
  // Login: no máximo 5 tentativas a cada 60 s por IP (SDD §8).
  rateLimit: { enabled: true, storage: 'memory', customRules: { '/sign-in/email': { window: 60, max: 5 }, '/sign-up/email': { window: 60, max: 60 } } },
  trustedOrigins: process.env.BETTER_AUTH_URL ? [process.env.BETTER_AUTH_URL] : undefined,
})

export type SessionUser = typeof auth.$Infer.Session.user
