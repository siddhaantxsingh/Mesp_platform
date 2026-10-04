import { useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { ArrowLeft, FlaskConical } from 'lucide-react'
import { Logo } from '@/components/Logo'
import { Disclaimer } from '@/components/status'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { useAsync } from '@/lib/useAsync'

export default function Login() {
  const nav = useNavigate()
  const loc = useLocation() as { state?: { from?: string } }
  const setToken = useAuth((s) => s.setToken)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState<'login' | 'demo' | null>(null)
  const meta = useAsync(() => api.meta(), [])
  const to = loc.state?.from ?? '/app/live'

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy('login'); setErr(null)
    try { setToken(await api.login(email, password)); nav(to, { replace: true }) } catch (x) { setErr(x instanceof Error ? x.message : 'Sign-in failed') } finally { setBusy(null) }
  }
  const demo = async () => {
    setBusy('demo'); setErr(null)
    try { setToken(await api.demoLogin()); nav(to, { replace: true }) } catch (x) { setErr(x instanceof Error ? x.message : 'Demo unavailable') } finally { setBusy(null) }
  }

  return (
    <div className="grid min-h-screen place-items-center px-4 py-10">
      <div className="w-full max-w-sm">
        <Link to="/" className="mb-8 inline-flex items-center gap-1.5 text-xs text-muted hover:text-foreground"><ArrowLeft className="h-3.5 w-3.5" />Back</Link>
        <Logo />
        <h1 className="mt-6 text-2xl font-semibold tracking-tight">Sign in</h1>
        <p className="mt-1 text-sm text-muted">to the MESP monitoring console</p>
        <form onSubmit={submit} className="mt-6 space-y-3" noValidate>
          <div>
            <label htmlFor="email" className="text-xs font-medium">Email</label>
            <input id="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)}
              className="mt-1 h-11 w-full rounded-md border border-border bg-surface px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
          </div>
          <div>
            <label htmlFor="password" className="text-xs font-medium">Password</label>
            <input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)}
              className="mt-1 h-11 w-full rounded-md border border-border bg-surface px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
          </div>
          {err && <p role="alert" className="text-xs text-critical">{err}</p>}
          <Button type="submit" variant="primary" className="w-full" size="lg" loading={busy === 'login'} disabled={!email || !password}>Sign in</Button>
        </form>
        {meta.data?.demo_mode !== false && (
          <>
            <div className="my-6 flex items-center gap-3 text-[11px] text-muted"><span className="h-px flex-1 bg-border" />or<span className="h-px flex-1 bg-border" /></div>
            <Button variant="outline" className="w-full" size="lg" onClick={demo} loading={busy === 'demo'}><FlaskConical className="h-4 w-4" />Explore the demo</Button>
            <p className="mt-2 text-center text-[11px] text-muted">Synthetic data only. No account needed.</p>
          </>
        )}
        <Disclaimer className="mt-10" />
      </div>
    </div>
  )
}
