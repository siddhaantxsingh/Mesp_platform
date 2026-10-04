import { useState } from 'react'
import type { MespEvent } from '@mesp/types'
import { api } from '@/lib/api'
import { useLive } from '@/lib/live/store'
import { Button } from './ui/button'
import { Dialog } from './ui/dialog'

export function AckDialog({ event, onClose, onDone }: { event: MespEvent | null; onClose: () => void; onDone?: (e: MespEvent) => void }) {
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const submit = async () => {
    if (!event) return
    setBusy(true); setErr(null)
    try {
      const e = await api.ack(event.id, note)
      useLive.getState().markAck(e)
      onDone?.(e)
      setNote('')
      onClose()
    } catch (x) {
      setErr(x instanceof Error ? x.message : 'Failed')
    } finally { setBusy(false) }
  }
  return (
    <Dialog open={!!event} onOpenChange={(o) => !o && onClose()} title={`Acknowledge: ${event?.title ?? ''}`}
      description="Acknowledging records who reviewed this event and when. It does not change the underlying data.">
      <p className="rounded-md border border-border bg-surface-2 p-3 text-xs leading-relaxed text-muted">{event?.detail}</p>
      <label htmlFor="ack-note" className="mt-4 block text-xs font-medium">Note (optional)</label>
      <textarea id="ack-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} rows={3}
        className="mt-1.5 w-full rounded-md border border-border bg-background p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        placeholder="e.g. Electrode re-seated; signal recovered." />
      {err && <p role="alert" className="mt-2 text-xs text-critical">{err}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={submit} loading={busy}>Acknowledge</Button>
      </div>
    </Dialog>
  )
}
