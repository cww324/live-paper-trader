import { useCallback, useEffect, useState } from 'react'
import Chart from './components/Chart'
import Carousel from './components/Carousel'
import PnLChart from './components/PnLChart'
import CalendarHeatmap from './components/CalendarHeatmap'
import SignalPanel from './components/SignalPanel'
import TradeLog from './components/TradeLog'
import { useWebSocket } from './hooks/useWebSocket'
import type {
  CandleEvent,
  FeatureUpdateEvent,
  SignalFireEvent,
  Trade,
  TradeCloseEvent,
  WSEvent,
  SignalState,
} from './types'

const SIGNALS = ['LQ-1', 'LQ-2', 'LQ-3', 'VS-3'] as const

export default function App() {
  const [lastBtcCandle, setLastBtcCandle] = useState<CandleEvent | null>(null)
  const [lastSignal, setLastSignal] = useState<SignalFireEvent | null>(null)
  const [lastClose, setLastClose] = useState<TradeCloseEvent | null>(null)
  const [features, setFeatures] = useState<FeatureUpdateEvent | null>(null)
  const [signalStates, setSignalStates] = useState<Record<string, SignalState>>(
    Object.fromEntries(
      SIGNALS.map((s) => [s, { last_fire_ts: null, last_fire_dir: null, open_trade_id: null }])
    )
  )
  const [lastFired, setLastFired] = useState<Partial<Record<string, number>>>({})
  const [trades, setTrades] = useState<Trade[]>([])
  const [config, setConfig] = useState({ initial_equity: 10000, risk_pct: 0.005 })

  const refreshTrades = () =>
    fetch('/api/trades?status=all&limit=200')
      .then((r) => r.json())
      .then(setTrades)
      .catch(console.error)

  useEffect(() => {
    refreshTrades()

    fetch('/api/signals')
      .then((r) => r.json())
      .then((data) => {
        if (data.signal_states) setSignalStates(data.signal_states)
        if (data.features && Object.keys(data.features).length > 0) {
          setFeatures({ type: 'feature_update', ...data.features })
        }
      })
      .catch(console.error)

    fetch('/api/config')
      .then((r) => r.json())
      .then(setConfig)
      .catch(console.error)
  }, [])

  const handleMessage = useCallback((event: WSEvent) => {
    switch (event.type) {
      case 'candle':
        if (event.symbol === 'BTC-USD') setLastBtcCandle(event)
        break
      case 'feature_update':
        setFeatures(event)
        break
      case 'signal_fire':
        setLastSignal(event)
        setLastFired((prev) => ({ ...prev, [event.signal]: event.ts }))
        setTrades((prev) => [
          {
            id: Date.now(),
            signal: event.signal,
            direction: event.direction,
            entry_ts: event.ts,
            entry_price: event.entry_price,
            exit_ts: null,
            exit_price: null,
            hold_bars: 0,
            gross_bps: null,
            status: 'OPEN',
          },
          ...prev,
        ])
        break
      case 'trade_close':
        setLastClose(event)
        refreshTrades()
        break
    }
  }, [])

  useWebSocket(handleMessage)

  const btcPrice = lastBtcCandle?.close ?? null

  const slides = [
    {
      label: 'BTC-USD · 5m',
      component: (
        <Chart newCandle={lastBtcCandle} newSignal={lastSignal} newClose={lastClose} />
      ),
    },
    {
      label: 'Cumulative P&L',
      component: (
        <PnLChart
          trades={trades}
          initialEquity={config.initial_equity}
          riskPct={config.risk_pct}
        />
      ),
    },
    {
      label: 'Calendar Heatmap',
      component: (
        <CalendarHeatmap
          trades={trades}
          initialEquity={config.initial_equity}
          riskPct={config.risk_pct}
        />
      ),
    },
  ]

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <header className="border-b border-slate-800 px-6 py-3 flex items-center justify-between">
        <h1 className="text-lg font-bold tracking-tight">Paper Trader</h1>
        <div className="flex items-center gap-4 text-sm">
          {btcPrice !== null && (
            <span className="font-mono text-slate-300">
              BTC{' '}
              <span className="text-white font-semibold">
                ${btcPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </span>
            </span>
          )}
          <span className="h-2 w-2 rounded-full bg-green-500 animate-pulse" title="Live" />
        </div>
      </header>

      <main className="mx-auto max-w-screen-xl space-y-4 px-6 py-4">
        <Carousel slides={slides} />
        <SignalPanel
          features={features}
          signalStates={signalStates}
          lastFired={lastFired}
        />
        <TradeLog trades={trades} />
      </main>
    </div>
  )
}
