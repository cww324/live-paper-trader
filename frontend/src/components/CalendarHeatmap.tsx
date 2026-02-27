import { useMemo, useState } from 'react'
import type { Trade } from '../types'

type Props = {
  trades: Trade[]
  initialEquity: number
  riskPct: number
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

function toDateKey(ts: number): string {
  const d = new Date(ts * 1000)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function cellColor(dollar: number, maxAbs: number): string {
  if (maxAbs === 0) return 'bg-slate-700'
  const intensity = Math.min(Math.abs(dollar) / maxAbs, 1)
  if (dollar > 0) {
    if (intensity > 0.66) return 'bg-green-500'
    if (intensity > 0.33) return 'bg-green-600'
    return 'bg-green-800'
  } else if (dollar < 0) {
    if (intensity > 0.66) return 'bg-red-500'
    if (intensity > 0.33) return 'bg-red-600'
    return 'bg-red-800'
  }
  return 'bg-slate-700'
}

export default function CalendarHeatmap({ trades, initialEquity, riskPct }: Props) {
  const now = new Date()
  const [viewYear, setViewYear] = useState(now.getFullYear())
  const [viewMonth, setViewMonth] = useState(now.getMonth()) // 0-indexed

  const positionSize = initialEquity * riskPct

  // Build daily P&L map
  const dailyPnL = useMemo(() => {
    const map: Record<string, { dollar: number; bps: number; trades: number }> = {}
    for (const t of trades) {
      if (t.status !== 'CLOSED' || !t.exit_ts || t.gross_bps === null) continue
      const key = toDateKey(t.exit_ts)
      if (!map[key]) map[key] = { dollar: 0, bps: 0, trades: 0 }
      map[key].dollar += positionSize * (t.gross_bps / 10000)
      map[key].bps += t.gross_bps
      map[key].trades += 1
    }
    return map
  }, [trades, positionSize])

  const maxAbs = useMemo(() => {
    return Math.max(...Object.values(dailyPnL).map((v) => Math.abs(v.dollar)), 0.001)
  }, [dailyPnL])

  // Build calendar grid for current view month
  const firstDay = new Date(viewYear, viewMonth, 1).getDay() // 0=Sun
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate()

  const cells: (number | null)[] = [
    ...Array(firstDay).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ]
  // Pad to full weeks
  while (cells.length % 7 !== 0) cells.push(null)

  const prevMonth = () => {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1) }
    else setViewMonth(m => m - 1)
  }
  const nextMonth = () => {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1) }
    else setViewMonth(m => m + 1)
  }

  // Monthly summary
  const monthlyStats = useMemo(() => {
    let dollar = 0, bps = 0, count = 0, wins = 0
    for (const [key, val] of Object.entries(dailyPnL)) {
      if (!key.startsWith(`${viewYear}-${String(viewMonth + 1).padStart(2, '0')}`)) continue
      dollar += val.dollar
      bps += val.bps
      count += val.trades
      if (val.dollar > 0) wins++
    }
    return { dollar, bps, count, wins }
  }, [dailyPnL, viewYear, viewMonth])

  return (
    <div className="space-y-4">
      {/* Month navigation */}
      <div className="flex items-center justify-between">
        <button onClick={prevMonth} className="rounded p-1 text-slate-400 hover:text-white">
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <span className="text-sm font-semibold text-slate-300">
          {MONTHS[viewMonth]} {viewYear}
        </span>
        <button onClick={nextMonth} className="rounded p-1 text-slate-400 hover:text-white">
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>

      {/* Day headers */}
      <div className="grid grid-cols-7 gap-1">
        {DAYS.map((d) => (
          <div key={d} className="text-center text-xs text-slate-500">{d}</div>
        ))}

        {/* Day cells */}
        {cells.map((day, i) => {
          if (day === null) return <div key={`empty-${i}`} />
          const key = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
          const data = dailyPnL[key]
          const isToday =
            day === now.getDate() &&
            viewMonth === now.getMonth() &&
            viewYear === now.getFullYear()

          return (
            <div
              key={key}
              title={
                data
                  ? `${MONTHS[viewMonth]} ${day}\n$${data.dollar.toFixed(2)} | ${data.bps.toFixed(1)} bps\n${data.trades} trade${data.trades !== 1 ? 's' : ''}`
                  : `${MONTHS[viewMonth]} ${day}\nNo trades`
              }
              className={`
                relative flex flex-col items-center justify-center rounded p-1
                aspect-square text-xs font-medium cursor-default select-none
                ${data ? cellColor(data.dollar, maxAbs) : 'bg-slate-800'}
                ${isToday ? 'ring-1 ring-white ring-offset-1 ring-offset-slate-900' : ''}
              `}
            >
              <span className="text-slate-200">{day}</span>
              {data && (
                <span className={`text-[10px] ${data.dollar >= 0 ? 'text-green-300' : 'text-red-300'}`}>
                  {data.dollar >= 0 ? '+' : ''}{data.dollar.toFixed(2)}
                </span>
              )}
            </div>
          )
        })}
      </div>

      {/* Monthly summary */}
      <div className="flex gap-4 border-t border-slate-700 pt-3 text-xs text-slate-500">
        <span>
          Trades: <span className="text-slate-300">{monthlyStats.count}</span>
        </span>
        <span>
          P&L:{' '}
          <span className={monthlyStats.dollar >= 0 ? 'text-green-400' : 'text-red-400'}>
            {monthlyStats.dollar >= 0 ? '+' : ''}${monthlyStats.dollar.toFixed(2)}
          </span>
        </span>
        <span>
          Bps:{' '}
          <span className={monthlyStats.bps >= 0 ? 'text-green-400' : 'text-red-400'}>
            {monthlyStats.bps >= 0 ? '+' : ''}{monthlyStats.bps.toFixed(1)}
          </span>
        </span>
      </div>
    </div>
  )
}
