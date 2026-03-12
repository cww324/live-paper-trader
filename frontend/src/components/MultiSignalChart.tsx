import { useEffect, useRef, useState } from 'react'
import { createChart, Time } from 'lightweight-charts'
import type { Trade } from '../types'

const SIGNAL_COLORS: Record<string, string> = {
  'CA-1': '#3b82f6',  // blue
  'CA-2': '#06b6d4',  // cyan
  'VS-2': '#a855f7',  // purple
  'VS-3': '#6366f1',  // indigo
  'LQ-1': '#ef4444',  // red
  'LQ-2': '#22c55e',  // green
  'LQ-3': '#f97316',  // orange
}

const PORTFOLIO_COLOR = '#e2e8f0'

type Props = {
  trades: Trade[]
  initialEquity: number
  riskPct: number
  metric: 'bps' | 'dollar'
}

export default function MultiSignalChart({ trades, initialEquity, riskPct, metric }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [cumulative, setCumulative] = useState(true)

  const closed = trades.filter(
    (t) => t.status === 'CLOSED' && t.exit_ts !== null && t.gross_bps !== null
  )

  useEffect(() => {
    if (!containerRef.current || closed.length === 0) return

    const chart = createChart(containerRef.current, {
      layout: { background: { color: '#0f172a' }, textColor: '#94a3b8' },
      grid: { vertLines: { color: '#1e293b' }, horzLines: { color: '#1e293b' } },
      timeScale: { timeVisible: true, secondsVisible: false },
      rightPriceScale: { visible: true },
      width: containerRef.current.clientWidth,
      height: 340,
    })

    const ro = new ResizeObserver(() => {
      if (containerRef.current) chart.applyOptions({ width: containerRef.current.clientWidth })
    })
    ro.observe(containerRef.current)

    const posSize = initialEquity * riskPct

    // Group closed trades by signal, sorted by exit time
    const bySignal: Record<string, { ts: number; val: number }[]> = {}
    for (const t of closed) {
      const rawVal = metric === 'bps' ? t.gross_bps! : posSize * (t.gross_bps! / 10000)
      if (!bySignal[t.signal]) bySignal[t.signal] = []
      bySignal[t.signal].push({ ts: t.exit_ts!, val: rawVal })
    }

    // Aggregate trades at same timestamp (sum values), then sort
    function toSeries(entries: { ts: number; val: number }[]): { time: Time; value: number }[] {
      const agg = new Map<number, number>()
      for (const { ts, val } of entries) {
        agg.set(ts, (agg.get(ts) ?? 0) + val)
      }
      const sorted = [...agg.entries()].sort((a, b) => a[0] - b[0])

      if (cumulative) {
        let running = 0
        return sorted.map(([ts, val]) => {
          running += val
          return { time: ts as Time, value: running }
        })
      } else {
        return sorted.map(([ts, val]) => ({ time: ts as Time, value: val }))
      }
    }

    // Per-signal series
    const activeSignals = Object.keys(bySignal).sort()
    for (const signal of activeSignals) {
      const series = chart.addLineSeries({
        color: SIGNAL_COLORS[signal] ?? '#94a3b8',
        lineWidth: 2,
        title: signal,
        lastValueVisible: true,
        priceLineVisible: false,
      })
      series.setData(toSeries(bySignal[signal]))
    }

    // Portfolio total — aggregate all closed trades
    if (activeSignals.length > 1) {
      const allEntries = closed.map((t) => ({
        ts: t.exit_ts!,
        val: metric === 'bps' ? t.gross_bps! : posSize * (t.gross_bps! / 10000),
      }))
      const portfolioSeries = chart.addLineSeries({
        color: PORTFOLIO_COLOR,
        lineWidth: 2,
        lineStyle: 2, // dashed
        title: 'Total',
        lastValueVisible: true,
        priceLineVisible: false,
      })
      portfolioSeries.setData(toSeries(allEntries))
    }

    chart.timeScale().fitContent()

    return () => {
      ro.disconnect()
      chart.remove()
    }
  }, [trades, metric, cumulative, initialEquity, riskPct])

  if (closed.length === 0) {
    return (
      <div className="flex h-[340px] items-center justify-center text-slate-500">
        No closed trades yet.
      </div>
    )
  }

  const activeSignals = [...new Set(closed.map((t) => t.signal))].sort()

  return (
    <div className="space-y-2">
      {/* Legend + toggle */}
      <div className="flex items-center justify-between px-1">
        <div className="flex flex-wrap gap-3">
          {activeSignals.map((sig) => (
            <span key={sig} className="flex items-center gap-1.5 text-xs text-slate-400">
              <span
                className="inline-block h-2 w-5 rounded-sm"
                style={{ background: SIGNAL_COLORS[sig] ?? '#94a3b8' }}
              />
              {sig}
            </span>
          ))}
          {activeSignals.length > 1 && (
            <span className="flex items-center gap-1.5 text-xs text-slate-400">
              <span
                className="inline-block h-2 w-5 rounded-sm opacity-80"
                style={{ background: PORTFOLIO_COLOR, borderBottom: '1px dashed' }}
              />
              Total
            </span>
          )}
        </div>
        <button
          onClick={() => setCumulative((c) => !c)}
          className={`rounded-lg border px-3 py-1 text-xs font-medium transition-colors ${
            cumulative
              ? 'border-blue-500/60 bg-blue-500/20 text-blue-400'
              : 'border-slate-600 bg-slate-800 text-slate-400 hover:border-slate-500 hover:text-slate-300'
          }`}
        >
          {cumulative ? 'Cumulative' : 'Per Trade'}
        </button>
      </div>

      <div ref={containerRef} />
    </div>
  )
}
