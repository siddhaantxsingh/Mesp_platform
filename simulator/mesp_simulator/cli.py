"""mesp-sim: write SIMULATED DATA streams to a recording file or stdout."""
from __future__ import annotations

import argparse
import sys

from .device import SimulatedDevice
from .scenarios import SCENARIOS, get_scenario


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="mesp-sim", description=__doc__)
    ap.add_argument("--list", action="store_true", help="list scenarios")
    ap.add_argument("--scenario", default="normal")
    ap.add_argument("--seconds", type=float, default=None, help="default: one full scenario")
    ap.add_argument("--seed", type=int, default=1234)
    ap.add_argument("--out", help="write a .mesprec recording (default: raw bytes to stdout)")
    a = ap.parse_args(argv)
    if a.list:
        for s in SCENARIOS.values():
            print(f"{s.id:15s} {s.duration_s:5.0f}s  {s.title}: {s.description}")
        return 0
    sc = get_scenario(a.scenario)
    dev = SimulatedDevice(sc, seed=a.seed, loop=False)
    em = dev.generate(a.seconds or sc.duration_s)
    if a.out:
        from mesp_replay import RecordingWriter
        with RecordingWriter(a.out, source=f"simulator:{sc.id}", synthetic=True,
                             meta={"scenario": sc.id, "seed": a.seed, "profile": dev.profile.id}) as w:
            for e in em:
                w.write(e.t, e.data)
        print(f"wrote {len(em)} frames ({dev.time:.0f} s of SIMULATED DATA) to {a.out}", file=sys.stderr)
    else:
        for e in em:
            sys.stdout.buffer.write(e.data)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
