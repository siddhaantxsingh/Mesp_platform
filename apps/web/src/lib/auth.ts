import { create } from 'zustand'
import type { Role, Token } from '@mesp/types'

// Token lives in sessionStorage (cleared with the tab) rather than localStorage, to narrow the
// window for token theft. See docs/security/threat-model.md.
const KEY = 'mesp.session'

interface AuthState {
  token: string | null
  email: string | null
  role: Role | null
  demo: boolean
  expiresAt: number | null
  setToken: (t: Token) => void
  logout: () => void
}

function load(): Partial<AuthState> {
  try {
    const raw = sessionStorage.getItem(KEY)
    if (!raw) return {}
    const s = JSON.parse(raw)
    if (s.expiresAt && s.expiresAt < Date.now() / 1000) return {}
    return s
  } catch {
    return {}
  }
}

export const useAuth = create<AuthState>((set) => ({
  token: null, email: null, role: null, demo: false, expiresAt: null,
  ...load(),
  setToken: (t) => {
    const s = { token: t.access_token, email: t.email, role: t.role, demo: t.demo, expiresAt: Date.now() / 1000 + t.expires_in }
    try { sessionStorage.setItem(KEY, JSON.stringify(s)) } catch { /* private mode: memory only */ }
    set(s)
  },
  logout: () => {
    try { sessionStorage.removeItem(KEY) } catch { /* ignore */ }
    set({ token: null, email: null, role: null, demo: false, expiresAt: null })
  },
}))

const rank: Record<Role, number> = { viewer: 0, operator: 1, admin: 2 }
export const can = (role: Role | null, needed: Role) => role != null && rank[role] >= rank[needed]
