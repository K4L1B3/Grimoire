import { toNextJsHandler } from 'better-auth/next-js'
import { auth } from '@grimorio/db/auth'

export const { GET, POST } = toNextJsHandler(auth)
