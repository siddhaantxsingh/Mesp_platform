import { useCallback, useEffect, useRef, useState } from 'react'

export function useAsync<T>(fn: () => Promise<T>, deps: unknown[], opts: { refreshMs?: number; enabled?: boolean } = {}) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const fnRef = useRef(fn)
  fnRef.current = fn
  const enabled = opts.enabled ?? true

  const run = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      setData(await fnRef.current())
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!enabled) return
    run()
    if (!opts.refreshMs) return
    const id = setInterval(() => run(true), opts.refreshMs)
    return () => clearInterval(id)
  }, [...deps, enabled, opts.refreshMs]) // eslint-disable-line react-hooks/exhaustive-deps

  return { data, error, loading, reload: () => run(true), setData }
}
