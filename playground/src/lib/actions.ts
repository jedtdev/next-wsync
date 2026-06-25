'use server'

import { cookies } from 'next/headers'
import { Jwt } from '@/lib/jwt'

export async function setSessionCookie(username: string): Promise<string> {
  const token = await Jwt.sign(username)
  const store = await cookies()
  store.set(Jwt.cookie.name, token, Jwt.cookie.options)
  return token
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies()
  store.delete(Jwt.cookie.name)
}
