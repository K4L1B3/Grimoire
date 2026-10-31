import { cookies, headers } from 'next/headers'
import { getRequestConfig } from 'next-intl/server'

export const LOCALES = ['pt', 'en'] as const

// Idioma pelo cookie (escolhido no menu) ou pelo navegador; português é o padrão (SDD §8).
export default getRequestConfig(async () => {
  const chosen = (await cookies()).get('locale')?.value
  const accept = (await headers()).get('accept-language') ?? ''
  const locale = LOCALES.includes(chosen as never) ? chosen! : accept.toLowerCase().startsWith('en') ? 'en' : 'pt'
  return { locale, messages: (await import(`../messages/${locale}.json`)).default }
})
