export const fmt = {
  num(v: number | null | undefined, digits = 0, fallback = '—') {
    return v == null || !Number.isFinite(v) ? fallback : v.toFixed(digits)
  },
  pct(v: number | null | undefined, digits = 1) {
    return v == null ? '—' : `${(v * 100).toFixed(digits)} %`
  },
  int(v: number | null | undefined) {
    return v == null ? '—' : Math.round(v).toLocaleString()
  },
  bytes(v: number | null | undefined) {
    if (v == null) return '—'
    const u = ['B', 'kB', 'MB', 'GB']
    let i = 0
    while (v >= 1000 && i < u.length - 1) { v /= 1000; i++ }
    return `${v.toFixed(i ? 1 : 0)} ${u[i]}`
  },
  duration(s: number | null | undefined) {
    if (s == null) return '—'
    s = Math.max(0, Math.round(s))
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60
    return h ? `${h}h ${String(m).padStart(2, '0')}m` : m ? `${m}m ${String(r).padStart(2, '0')}s` : `${r}s`
  },
  time(t: number | null | undefined) {
    return t == null ? '—' : new Date(t * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  },
  dateTime(t: number | null | undefined) {
    return t == null ? '—' : new Date(t * 1000).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
  },
  ago(t: number | null | undefined, now = Date.now() / 1000) {
    if (t == null) return 'never'
    const d = Math.max(0, now - t)
    if (d < 5) return 'just now'
    if (d < 60) return `${Math.round(d)} s ago`
    if (d < 3600) return `${Math.round(d / 60)} min ago`
    if (d < 86400) return `${Math.round(d / 3600)} h ago`
    return `${Math.round(d / 86400)} d ago`
  },
}
