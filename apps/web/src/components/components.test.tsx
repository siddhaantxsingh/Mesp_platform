import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { FreshnessPill, SyntheticBadge } from './status'
import { VitalTile } from './VitalTile'
import { TooltipProvider } from './ui/tooltip'

describe('components', () => {
  it('freshness pill exposes status text to assistive tech', () => {
    render(<FreshnessPill state="STALE" />)
    expect(screen.getByRole('status')).toHaveTextContent('STALE')
    expect(screen.getByRole('status')).toHaveTextContent(/out of date/)
  })
  it('synthetic badge is explicit', () => {
    render(<SyntheticBadge />)
    expect(screen.getByText('SIMULATED DATA')).toBeInTheDocument()
  })
  it('vital tile says Not available with a reason instead of a number', () => {
    render(<TooltipProvider><VitalTile label="Battery" value="—" unavailable="No fuel-gauge driver." /></TooltipProvider>)
    expect(screen.getByText('Not available')).toBeInTheDocument()
    expect(screen.getByText('No fuel-gauge driver.')).toBeInTheDocument()
  })
})
