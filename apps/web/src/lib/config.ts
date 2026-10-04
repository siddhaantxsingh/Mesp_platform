/**
 * Where the API lives. Empty (default) = same origin, as in `vite dev` (proxy) and the nginx
 * container. For a split deployment (e.g. web on Vercel, API on Render) set
 * VITE_API_URL=https://your-api.example.com at build time.
 */
export const API_BASE: string = (import.meta.env.VITE_API_URL ?? '').replace(/\/+$/, '')

export function liveWsUrl(): string {
  if (API_BASE) return `${API_BASE.replace(/^http/, 'ws')}/api/v1/live/ws`
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${location.host}/api/v1/live/ws`
}
