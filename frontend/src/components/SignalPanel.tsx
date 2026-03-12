import { Link } from 'react-router-dom'
import type { FeatureUpdateEvent } from '../types'

type SlopeKey = 'eth_slope_sign' | 'btc_slope_sign'

type SignalMeta = {
  desc: string
  holdBars: number
  slopeKey?: SlopeKey
  featureKey?: keyof FeatureUpdateEvent
  featureLabel?: string
  showVolume?: boolean
  showOiAccel?: boolean
  showDecoupled?: boolean
  showLiqImbalance?: boolean
}

const SIGNAL_META: Record<string, SignalMeta> = {
  'CA-1': {
    desc: 'ETH slope flip — trade direction of new trend',
    holdBars: 8,
    slopeKey: 'eth_slope_sign',
  },
  'CA-2': {
    desc: 'BTC slope flip — trade direction of new BTC trend',
    holdBars: 8,
    slopeKey: 'btc_slope_sign',
  },
  'VS-3': {
    desc: 'ETH flip + vol p80 + liq p70 → flip direction',
    holdBars: 12,
    slopeKey: 'eth_slope_sign',
    featureKey: 'total_liq_btc_pct',
    featureLabel: 'Total Liq %ile',
    showVolume: true,
  },
  'LQ-1': {
    desc: 'Extreme long liq onset → SHORT, h=8',
    holdBars: 8,
    featureKey: 'long_liq_btc_pct',
    featureLabel: 'Long Liq %ile',
  },
  'LQ-3': {
    desc: 'Bearish ETH flip + long liq p70 → SHORT',
    holdBars: 8,
    slopeKey: 'eth_slope_sign',
    featureKey: 'long_liq_btc_pct',
    featureLabel: 'Long Liq %ile',
  },
  'LQ-4': {
    desc: 'Extreme long liq onset → SHORT, h=12',
    holdBars: 12,
    featureKey: 'long_liq_btc_pct',
    featureLabel: 'Long Liq %ile',
  },
  'LQ-5': {
    desc: 'Extreme short liq onset → LONG, h=12',
    holdBars: 12,
    featureKey: 'short_liq_btc_pct',
    featureLabel: 'Short Liq %ile',
  },
  'LQ-6': {
    desc: 'Liq directional imbalance > p80 → SHORT',
    holdBars: 12,
    showLiqImbalance: true,
  },
  'OV-1': {
    desc: 'ETH flip + OI acceleration → flip direction',
    holdBars: 24,
    slopeKey: 'eth_slope_sign',
    showOiAccel: true,
  },
  'CD-1': {
    desc: 'ETH flip + BTC-ETH correlation < p20 → flip direction',
    holdBars: 12,
    slopeKey: 'eth_slope_sign',
    showDecoupled: true,
  },
}

function pct(v: number): string {
  return `${(v * 100).toFixed(1)}%`
}

function formatTs(ts: number | null): string {
  if (!ts) return 'Never'
  return new Date(ts * 1000).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

function runningDays(startedAt: number | null): string {
  if (!startedAt) return ''
  const days = Math.floor((Date.now() / 1000 - startedAt) / 86400)
  return `${days}d`
}

function slopeLabel(v: number): { text: string; cls: string } {
  if (v > 0) return { text: 'BULLISH', cls: 'text-green-400' }
  if (v < 0) return { text: 'BEARISH', cls: 'text-red-400' }
  return { text: 'FLAT', cls: 'text-slate-400' }
}

function getStatus(
  signal: string,
  holdBars: number,
  lastFireTs: number | null,
  openTradeId: number | null,
  now: number
): 'ACTIVE' | 'COOLING' | 'WATCHING' {
  if (openTradeId !== null) return 'ACTIVE'
  if (lastFireTs !== null) {
    if (now - lastFireTs < holdBars * 300) return 'COOLING'
  }
  return 'WATCHING'
}

const STATUS_STYLES = {
  ACTIVE:   'bg-green-500/20 text-green-400 border-green-500/40',
  COOLING:  'bg-yellow-500/20 text-yellow-400 border-yellow-500/40',
  WATCHING: 'bg-slate-700/40 text-slate-400 border-slate-600',
}

type Props = {
  features: FeatureUpdateEvent | null
  signalStates: Record<string, { last_fire_ts: number | null; open_trade_id: number | null; started_at?: number | null }>
  lastFired: Partial<Record<string, number>>
}

export default function SignalPanel({ features, signalStates, lastFired }: Props) {
  const now = Math.floor(Date.now() / 1000)

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
      {Object.entries(SIGNAL_META).map(([signal, meta]) => {
        const state = signalStates[signal] ?? { last_fire_ts: null, open_trade_id: null, started_at: null }
        const status = getStatus(signal, meta.holdBars, state.last_fire_ts, state.open_trade_id, now)
        const firedTs = lastFired[signal] ?? state.last_fire_ts

        const slope = meta.slopeKey && features
          ? slopeLabel(features[meta.slopeKey] as number)
          : null
        const featureVal = meta.featureKey && features
          ? (features[meta.featureKey] as number)
          : null

        return (
          <Link
            key={signal}
            to={`/signal/${signal}`}
            className="rounded-xl border border-slate-700 bg-slate-900 p-4 flex flex-col gap-2 hover:border-slate-500 hover:bg-slate-800/60 transition-colors cursor-pointer"
          >
            {/* Header */}
            <div className="flex items-center justify-between">
              <span className="text-base font-bold text-white">{signal}</span>
              <span className={`rounded border px-2 py-0.5 text-xs font-semibold ${STATUS_STYLES[status]}`}>
                {status}
              </span>
            </div>

            <p className="text-xs text-slate-400 leading-snug">{meta.desc}</p>

            {/* Slope badge */}
            {slope && (
              <div className="flex items-center gap-1.5 text-xs">
                <span className="text-slate-500">Trend:</span>
                <span className={`font-semibold ${slope.cls}`}>{slope.text}</span>
              </div>
            )}

            {/* Liq percentile bar */}
            {featureVal !== null && (
              <div>
                <div className="mb-1 flex justify-between text-xs text-slate-500">
                  <span>{meta.featureLabel}</span>
                  <span className="text-slate-300">{pct(featureVal)}</span>
                </div>
                <div className="h-1.5 w-full rounded-full bg-slate-700">
                  <div
                    className="h-1.5 rounded-full bg-blue-500 transition-all"
                    style={{ width: `${featureVal * 100}%` }}
                  />
                </div>
              </div>
            )}

            {/* Volume bar */}
            {meta.showVolume && features && (
              <div>
                <div className="mb-1 flex justify-between text-xs text-slate-500">
                  <span>Vol %ile</span>
                  <span className="text-slate-300">{pct(features.volume_btc_pct)}</span>
                </div>
                <div className="h-1.5 w-full rounded-full bg-slate-700">
                  <div
                    className="h-1.5 rounded-full bg-purple-500 transition-all"
                    style={{ width: `${features.volume_btc_pct * 100}%` }}
                  />
                </div>
              </div>
            )}

            {/* OI acceleration badge */}
            {meta.showOiAccel && features && (
              <div className="flex items-center gap-1.5 text-xs">
                <span className="text-slate-500">OI:</span>
                <span className={features.oi_accelerating ? 'text-green-400 font-semibold' : 'text-slate-400'}>
                  {features.oi_accelerating ? 'ACCEL' : 'STABLE'}
                </span>
              </div>
            )}

            {/* Correlation decoupled badge */}
            {meta.showDecoupled && features && (
              <div className="flex items-center gap-1.5 text-xs">
                <span className="text-slate-500">Corr:</span>
                <span className={features.btc_eth_decoupled ? 'text-yellow-400 font-semibold' : 'text-slate-400'}>
                  {features.btc_eth_decoupled ? 'DECOUPLED' : 'LINKED'}
                </span>
              </div>
            )}

            {/* Liq imbalance badge */}
            {meta.showLiqImbalance && features && (
              <div className="flex items-center gap-1.5 text-xs">
                <span className="text-slate-500">Imbalance:</span>
                <span className={features.liq_imbalance_above_p80 ? 'text-red-400 font-semibold' : 'text-slate-400'}>
                  {features.liq_imbalance_above_p80 ? 'ABOVE p80' : 'NORMAL'}
                </span>
              </div>
            )}

            {/* Footer */}
            <div className="mt-auto space-y-0.5">
              <div className="text-xs text-slate-500">
                Last fired: <span className="text-slate-300">{formatTs(firedTs ?? null)}</span>
              </div>
              {state.started_at && (
                <div className="text-xs text-slate-600">
                  Running{' '}
                  <span className="text-slate-500">{runningDays(state.started_at)}</span>
                </div>
              )}
            </div>
          </Link>
        )
      })}
    </div>
  )
}
