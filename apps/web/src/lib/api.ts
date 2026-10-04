import type {
  DemoStatus, Device, MespEvent, SamplesResponse, Scenario, SessionRow, Token, Vitals,
} from '@mesp/types'
import { useAuth } from './auth'
import { API_BASE } from './config'

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = useAuth.getState().token
  const headers = new Headers(init.headers)
  if (token) headers.set('Authorization', `Bearer ${token}`)
  if (init.body && !(init.body instanceof FormData)) headers.set('Content-Type', 'application/json')
  let res: Response
  try {
    res = await fetch(API_BASE + path, { ...init, headers })
  } catch {
    throw new ApiError(0, 'Cannot reach the MESP API. Is the server running?')
  }
  if (res.status === 401 && token) {
    useAuth.getState().logout()
  }
  if (!res.ok) {
    let msg = res.statusText
    try { const j = await res.json(); msg = typeof j.detail === 'string' ? j.detail : JSON.stringify(j.detail) } catch { /* not json */ }
    throw new ApiError(res.status, msg || `HTTP ${res.status}`)
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

const q = (o: Record<string, unknown>) => {
  const p = new URLSearchParams()
  Object.entries(o).forEach(([k, v]) => v != null && v !== '' && p.set(k, String(v)))
  const s = p.toString()
  return s ? `?${s}` : ''
}

export const api = {
  meta: () => req<{ version: string; disclaimer: string; demo_mode: boolean; profiles: import('@mesp/types').DeviceProfile[] }>('/api/v1/meta'),
  login: (email: string, password: string) => req<Token>('/api/v1/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  demoLogin: () => req<Token>('/api/v1/auth/demo', { method: 'POST' }),
  devices: () => req<Device[]>('/api/v1/devices'),
  device: (id: string) => req<Device>(`/api/v1/devices/${id}`),
  createDevice: (name: string, profile_id: string) => req<Device>('/api/v1/devices', { method: 'POST', body: JSON.stringify({ name, profile_id }) }),
  rotateKey: (id: string) => req<{ ingest_key: string; key_prefix: string }>(`/api/v1/devices/${id}/rotate-key`, { method: 'POST' }),
  deleteDevice: (id: string) => req<void>(`/api/v1/devices/${id}`, { method: 'DELETE' }),
  sessions: (o: { device_id?: string; synthetic?: boolean; limit?: number; offset?: number } = {}) =>
    req<{ total: number; items: SessionRow[] }>(`/api/v1/sessions${q(o)}`),
  session: (id: string) => req<SessionRow>(`/api/v1/sessions/${id}`),
  labelSession: (id: string, label: string) => req<SessionRow>(`/api/v1/sessions/${id}`, { method: 'PATCH', body: JSON.stringify({ label }) }),
  vitals: (id: string, t_from?: number, t_to?: number) => req<{ items: Vitals[]; synthetic: boolean }>(`/api/v1/sessions/${id}/vitals${q({ t_from, t_to })}`),
  samples: (id: string, stream: string, t_from?: number, t_to?: number, max_points = 3000) =>
    req<SamplesResponse>(`/api/v1/sessions/${id}/samples${q({ stream, t_from, t_to, max_points })}`),
  analytics: (id: string) => req<Record<string, any>>(`/api/v1/analytics/sessions/${id}`), // eslint-disable-line @typescript-eslint/no-explicit-any
  events: (o: { device_id?: string; session_id?: string; severity?: string; acknowledged?: boolean; limit?: number; offset?: number } = {}) =>
    req<{ total: number; unacknowledged: Record<string, number>; items: MespEvent[] }>(`/api/v1/events${q(o)}`),
  ack: (id: string, note?: string) => req<MespEvent>(`/api/v1/events/${id}/ack`, { method: 'POST', body: JSON.stringify({ note: note || null }) }),
  scenarios: () => req<Scenario[]>('/api/v1/demo/scenarios'),
  demoStatus: () => req<DemoStatus>('/api/v1/demo/status'),
  demoStart: (scenario: string, speed = 1) => req<DemoStatus>('/api/v1/demo/start', { method: 'POST', body: JSON.stringify({ scenario, speed }) }),
  demoStop: () => req<DemoStatus>('/api/v1/demo/stop', { method: 'POST' }),
  audit: () => req<{ at: number; actor: string; action: string; target: string | null; ip: string | null }[]>('/api/v1/audit'),
  users: () => req<{ id: string; email: string; role: string; disabled: boolean }[]>('/api/v1/users'),
  exportUrl: (id: string, stream: string, format: 'csv' | 'json') => `/api/v1/sessions/${id}/export${q({ stream, format })}`,
  async download(url: string) {
    const token = useAuth.getState().token
    const res = await fetch(API_BASE + url, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
    if (!res.ok) throw new ApiError(res.status, 'Export failed')
    const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? 'export'
    const blob = await res.blob()
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = name
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  },
}
