import { useState } from 'react'
import type { Trade } from '../types'

function fmt(ts: number | null): string {
  if (!ts) return '—'
  return new Date(ts * 1000).toLocaleString()
}

function fmtPrice(p: number | null): string {
  if (p === null) return '—'
  return `$${p.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function duration(entry: number, hold: number): string {
  const min = (hold * 5)
  return `${min}m`
}

type Props = { trades: Trade[] }

export default function TradeLog({ trades }: Props) {
  const [tab, setTab] = useState<'open' | 'closed'>('open')

  const open = trades.filter((t) => t.status === 'OPEN')
  const closed = trades.filter((t) => t.status === 'CLOSED')
  const shown = tab === 'open' ? open : closed

  // Stats for closed trades
  const wins = closed.filter((t) => (t.gross_bps ?? 0) > 0).length
  const totalBps = closed.reduce((s, t) => s + (t.gross_bps ?? 0), 0)
  const meanBps = closed.length > 0 ? totalBps / closed.length : 0
  const winRate = closed.length > 0 ? (wins / closed.length) * 100 : 0

  return (
    <div className="rounded-xl border border-slate-700 bg-slate-900 p-4">
      <div className="mb-3 flex gap-2">
        <button
          onClick={() => setTab('open')}
          className={`rounded-lg px-3 py-1 text-sm font-medium ${
            tab === 'open'
              ? 'bg-blue-600 text-white'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          Open Trades ({open.length})
        </button>
        <button
          onClick={() => setTab('closed')}
          className={`rounded-lg px-3 py-1 text-sm font-medium ${
            tab === 'closed'
              ? 'bg-blue-600 text-white'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          Closed Trades ({closed.length})
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-700 text-left text-xs text-slate-500">
              <th className="pb-2 pr-4">Signal</th>
              <th className="pb-2 pr-4">Dir</th>
              <th className="pb-2 pr-4">Entry Time</th>
              <th className="pb-2 pr-4">Entry $</th>
              <th className="pb-2 pr-4">Exit $</th>
              <th className="pb-2 pr-4">Hold</th>
              {tab === 'closed' && <th className="pb-2">Gross (bps)</th>}
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && (
              <tr>
                <td colSpan={7} className="py-6 text-center text-slate-500">
                  No {tab} trades
                </td>
              </tr>
            )}
            {shown.map((t) => (
              <tr key={t.id} className="border-b border-slate-800 text-slate-300">
                <td className="py-1.5 pr-4 font-medium text-white">{t.signal}</td>
                <td className="py-1.5 pr-4">
                  <span
                    className={
                      t.direction === 'LONG' ? 'text-green-400' : 'text-red-400'
                    }
                  >
                    {t.direction}
                  </span>
                </td>
                <td className="py-1.5 pr-4 text-xs">{fmt(t.entry_ts)}</td>
                <td className="py-1.5 pr-4">{fmtPrice(t.entry_price)}</td>
                <td className="py-1.5 pr-4">{fmtPrice(t.exit_price)}</td>
                <td className="py-1.5 pr-4">{duration(t.entry_ts, t.hold_bars)}</td>
                {tab === 'closed' && (
                  <td
                    className={`py-1.5 font-semibold ${
                      (t.gross_bps ?? 0) >= 0 ? 'text-green-400' : 'text-red-400'
                    }`}
                  >
                    {t.gross_bps !== null ? t.gross_bps.toFixed(1) : '—'}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {tab === 'closed' && closed.length > 0 && (
        <div className="mt-3 flex gap-6 border-t border-slate-700 pt-3 text-xs text-slate-500">
          <span>
            Trades: <span className="text-slate-300">{closed.length}</span>
          </span>
          <span>
            Win rate:{' '}
            <span className="text-slate-300">{winRate.toFixed(1)}%</span>
          </span>
          <span>
            Mean bps:{' '}
            <span className={meanBps >= 0 ? 'text-green-400' : 'text-red-400'}>
              {meanBps.toFixed(1)}
            </span>
          </span>
          <span>
            Total bps:{' '}
            <span className={totalBps >= 0 ? 'text-green-400' : 'text-red-400'}>
              {totalBps.toFixed(1)}
            </span>
          </span>
        </div>
      )}
    </div>
  )
}
