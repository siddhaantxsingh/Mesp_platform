import { create } from 'zustand'

type Theme = 'dark' | 'light' | 'system'
const read = (k: string) => { try { return localStorage.getItem(k) } catch { return null } }
const write = (k: string, v: string | null) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v) } catch { /* ignore */ } }

function applyTheme(t: Theme) {
  const dark = t === 'system' ? matchMedia('(prefers-color-scheme: dark)').matches : t === 'dark'
  document.documentElement.classList.toggle('dark', dark)
}

interface UiState {
  deviceId: string | null
  theme: Theme
  setDevice: (id: string | null) => void
  setTheme: (t: Theme) => void
}

export const useUi = create<UiState>((set) => ({
  deviceId: read('mesp.device'),
  theme: (read('mesp.theme') as Theme) || 'system',
  setDevice: (id) => { write('mesp.device', id); set({ deviceId: id }) },
  setTheme: (t) => { write('mesp.theme', t === 'system' ? null : t); applyTheme(t); set({ theme: t }) },
}))
