import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import PnLChart from '../components/PnLChart'
import type { Trade } from '../types'

const SIGNAL_DESC: Record<string, string> = {
  'CA-1': 'ETH slope flip — trade direction of new trend',
  'CA-2': 'BTC slope flip — trade direction of new BTC trend',
  'VS-3': 'ETH flip + vol p80 + liq p70 → flip direction',
  'LQ-1': 'Extreme long liq onset → SHORT, h=8',
  'LQ-3': 'Bearish ETH flip + long liq p70 → SHORT',
  'LQ-4': 'Extreme long liq onset → SHORT, h=12',
  'LQ-5': 'Extreme short liq onset → LONG, h=12',
  'LQ-6': 'Liq directional imbalance > p80 → SHORT',
  'OV-1': 'ETH flip + OI acceleration → flip direction',
  'CD-1': 'ETH flip + BTC-ETH correlation < p20 → flip direction',
}

function fmt(ts: number | null): string {
  if (!ts) return '—'
  return new Date(ts * 1000).toLocaleString()
}

function fmtDate(ts: number | null): string {
  if (!ts) return '—'
  return new Date(ts * 1000).toLocaleDateString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
  })
}

function fmtPrice(p: number | null): string {
  if (p === null) return '—'
  return `$${p.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function runningDays(startedAt: number): string {
  const days = Math.floor((Date.now() / 1000 - startedAt) / 86400)
  return `${days}d`
}

export default function SignalDetail() {
  const { id } = useParams<{ id: string }>()
  const [trades, setTrades] = useState<Trade[]>([])
  const [config, setConfig] = useState<{ initial_equity: number; risk_pct: number }>({
    initial_equity: 10000,
    risk_pct: 0.02,
  })
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      fetch('/api/trades?status=all&limit=1000').then((r) => r.json()),
      fetch('/api/config').then((r) => r.json()),
      fetch('/api/signals').then((r) => r.json()),
    ])
      .then(([allTrades, cfg, signals]) => {
        setTrades((allTrades as Trade[]).filter((t) => t.signal === id))
        setConfig(cfg)
        const state = signals?.signal_states?.[id ?? '']
        if (state?.started_at) setStartedAt(state.started_at)
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [id])

  const closed = trades.filter((t) => t.status === 'CLOSED')
  const open   = trades.filter((t) => t.status === 'OPEN')
  const wins   = closed.filter((t) => (t.gross_bps ?? 0) > 0).length
  const totalBps = closed.reduce((s, t) => s + (t.gross_bps ?? 0), 0)
  const meanBps  = closed.length > 0 ? totalBps / closed.length : 0
  const winRate  = closed.length > 0 ? (wins / closed.length) * 100 : 0

  const desc = id ? SIGNAL_DESC[id] ?? id : ''

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <header className="border-b border-slate-800 px-6 py-3 flex items-center gap-4">
        <Link to="/" className="text-slate-400 hover:text-white transition-colors text-sm">
          ← Back
        </Link>
        <div>
          <h1 className="text-lg font-bold tracking-tight">{id}</h1>
          <p className="text-xs text-slate-400">{desc}</p>
        </div>
        {startedAt && (
          <div className="ml-auto text-right text-xs text-slate-500">
            <div>Live since <span className="text-slate-300">{fmtDate(startedAt)}</span></div>
            <div><span className="text-slate-300">{runningDays(startedAt)}</span> running</div>
          </div>
        )}
      </header>

      <main className="mx-auto max-w-screen-xl space-y-6 px-6 py-6">
        {/* Stats bar */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: 'Total Trades', value: trades.length.toString() },
            { label: 'Win Rate',  value: closed.length > 0 ? `${winRate.toFixed(1)}%` : '—' },
            {
              label: 'Mean bps',
              value: closed.length > 0 ? meanBps.toFixed(1) : '—',
              color: meanBps >= 0 ? 'text-green-400' : 'text-red-400',
            },
            {
              label: 'Total bps',
              value: closed.length > 0 ? totalBps.toFixed(1) : '—',
              color: totalBps >= 0 ? 'text-green-400' : 'text-red-400',
            },
          ].map(({ label, value, color }) => (
            <div key={label} className="rounded-xl border border-slate-700 bg-slate-900 p-4">
              <div className="text-xs text-slate-500 mb-1">{label}</div>
              <div className={`text-2xl font-bold ${color ?? 'text-white'}`}>{value}</div>
            </div>
          ))}
        </div>

        {/* P&L chart */}
        <div className="rounded-xl border border-slate-700 bg-slate-900 p-4">
          <h2 className="text-sm font-semibold text-slate-300 mb-3">Cumulative P&L</h2>
          {loading ? (
            <div className="flex h-[400px] items-center justify-center text-slate-500">Loading…</div>
          ) : (
            <PnLChart trades={trades} initialEquity={config.initial_equity} riskPct={config.risk_pct} />
          )}
        </div>

        {/* Trade table */}
        <div className="rounded-xl border border-slate-700 bg-slate-900 p-4">
          <h2 className="text-sm font-semibold text-slate-300 mb-3">
            Trade History
            {open.length > 0 && (
              <span className="ml-2 rounded border border-green-500/40 bg-green-500/20 px-2 py-0.5 text-xs text-green-400">
                {open.length} open
              </span>
            )}
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-700 text-left text-xs text-slate-500">
                  <th className="pb-2 pr-4">Dir</th>
                  <th className="pb-2 pr-4">Entry Time</th>
                  <th className="pb-2 pr-4">Entry $</th>
                  <th className="pb-2 pr-4">Exit Time</th>
                  <th className="pb-2 pr-4">Exit $</th>
                  <th className="pb-2 pr-4">Hold</th>
                  <th className="pb-2 pr-4">Gross (bps)</th>
                  <th className="pb-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {trades.length === 0 && (
                  <tr>
                    <td colSpan={8} className="py-8 text-center text-slate-500">
                      No trades yet for {id}
                    </td>
                  </tr>
                )}
                {trades.map((t) => (
                  <tr key={t.id} className="border-b border-slate-800 text-slate-300">
                    <td className="py-1.5 pr-4">
                      <span className={t.direction === 'LONG' ? 'text-green-400' : 'text-red-400'}>
                        {t.direction}
                      </span>
                    </td>
                    <td className="py-1.5 pr-4 text-xs">{fmt(t.entry_ts)}</td>
                    <td className="py-1.5 pr-4">{fmtPrice(t.entry_price)}</td>
                    <td className="py-1.5 pr-4 text-xs">{fmt(t.exit_ts)}</td>
                    <td className="py-1.5 pr-4">{fmtPrice(t.exit_price)}</td>
                    <td className="py-1.5 pr-4">{t.hold_bars * 5}m</td>
                    <td className={`py-1.5 pr-4 font-semibold ${
                      t.gross_bps === null ? 'text-slate-500' :
                      t.gross_bps >= 0 ? 'text-green-400' : 'text-red-400'
                    }`}>
                      {t.gross_bps !== null ? t.gross_bps.toFixed(1) : '—'}
                    </td>
                    <td className="py-1.5">
                      <span className={`rounded px-1.5 py-0.5 text-xs ${
                        t.status === 'OPEN'
                          ? 'bg-green-500/20 text-green-400'
                          : 'bg-slate-700 text-slate-400'
                      }`}>
                        {t.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  )
}
