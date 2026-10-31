export function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs' && process.env.NODE_ENV === 'development') {
    // Quem abriu o `next dev` morreu e levou o stdout: cada log vira EPIPE, que vira uncaughtException, que loga de novo, em loop e sem limite de memória.
    for (const s of [process.stdout, process.stderr]) s.on('error', (e: NodeJS.ErrnoException) => { if (e.code === 'EPIPE') process.exit(0) })
  }
}
