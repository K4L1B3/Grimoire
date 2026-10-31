import { requireUser } from '@/lib/session'
import { Wizard } from './wizard'

export default async function NewCampaign() {
  await requireUser()
  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center px-4 py-8">
      <div className="ambient" aria-hidden />
      <Wizard />
    </main>
  )
}
