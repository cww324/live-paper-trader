import type { FeatureUpdateEvent } from '../types'

type SlopeKey = 'eth_slope_sign' | 'btc_slope_sign'

type SignalMeta = {
  desc: string
  slopeKey?: SlopeKey
  featureKey?: keyof FeatureUpdateEvent
  featureLabel?: string
  showVolume?: boolean
}

const SIGNAL_META: Record<string, SignalMeta> = {
  'CA-1': {
    desc: 'ETH slope flip — trade direction of new trend',
    slopeKey: 'eth_slope_sign',
  },
  'CA-2': {
    desc: 'BTC slope flip — trade direction of new BTC trend',
    slopeKey: 'btc_slope_sign',
  },
  'VS-2': {
    desc: 'High-volume ETH slope flip, 60 min hold',
    slopeKey: 'eth_slope_sign',
    showVolume: true,
  },
  'VS-3': {
    desc: 'Slope flip + high volume + elevated liq → flip direction',
    featureKey: 'total_liq_btc_pct',
    featureLabel: 'Total Liq %ile',
    showVolume: true,
  },
  'LQ-1': {
    desc: 'Extreme long liquidations → SHORT',
    featureKey: 'long_liq_btc_pct',
    featureLabel: 'Long Liq %ile',
  },
  'LQ-2': {
    desc: 'Extreme short liquidations → LONG',
    featureKey: 'short_liq_btc_pct',
    featureLabel: 'Short Liq %ile',
  },
  'LQ-3': {
    desc: 'Bearish ETH slope flip + elevated liq → SHORT',
    featureKey: 'long_liq_btc_pct',
    featureLabel: 'Long Liq %ile',
  },
}

const DEDUP_BARS: Record<string, number> = {
  'CA-1': 8, 'CA-2': 8, 'VS-2': 12, 'VS-3': 12,
  'LQ-1': 8, 'LQ-2': 8, 'LQ-3': 8,
}

function pct(v: number): string {
  return `${(v * 100).toFixed(1)}%`
}

function formatTs(ts: number | null): string {
  if (!ts) return 'Never'
  return new Date(ts * 1000).toLocaleTimeString()
}

function slopeLabel(v: number): { text: string; cls: string } {
  if (v > 0) return { text: 'BULLISH', cls: 'text-green-400' }
  if (v < 0) return { text: 'BEARISH', cls: 'text-red-400' }
  return { text: 'FLAT', cls: 'text-slate-400' }
}

function getStatus(
  signal: string,
  lastFireTs: number | null,
  openTradeId: number | null,
  now: number
): 'ACTIVE' | 'COOLING' | 'WATCHING' {
  if (openTradeId !== null) return 'ACTIVE'
  if (lastFireTs !== null) {
    if (now - lastFireTs < DEDUP_BARS[signal] * 300) return 'COOLING'
  }
  return 'WATCHING'
}

const STATUS_STYLES = {
  ACTIVE: 'bg-green-500/20 text-green-400 border-green-500/40',
  COOLING: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/40',
  WATCHING: 'bg-slate-700/40 text-slate-400 border-slate-600',
}

type Props = {
  features: FeatureUpdateEvent | null
  signalStates: Record<string, { last_fire_ts: number | null; open_trade_id: number | null }>
  lastFired: Partial<Record<string, number>>
}

export default function SignalPanel({ features, signalStates, lastFired }: Props) {
  const now = Math.floor(Date.now() / 1000)

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
      {Object.entries(SIGNAL_META).map(([signal, meta]) => {
        const state = signalStates[signal] ?? { last_fire_ts: null, open_trade_id: null }
        const status = getStatus(signal, state.last_fire_ts, state.open_trade_id, now)
        const firedTs = lastFired[signal] ?? state.last_fire_ts

        const slope = meta.slopeKey && features
          ? slopeLabel(features[meta.slopeKey] as number)
          : null
        const featureVal = meta.featureKey && features
          ? (features[meta.featureKey] as number)
          : null

        return (
          <div
            key={signal}
            className="rounded-xl border border-slate-700 bg-slate-900 p-4 flex flex-col gap-2"
          >
            <div className="flex items-center justify-between">
              <span className="text-base font-bold text-white">{signal}</span>
              <span className={`rounded border px-2 py-0.5 text-xs font-semibold ${STATUS_STYLES[status]}`}>
                {status}
              </span>
            </div>
            <p className="text-xs text-slate-400">{meta.desc}</p>

            {/* Slope badge for CA-1, CA-2, VS-2 */}
            {slope && (
              <div className="flex items-center gap-1.5 text-xs">
                <span className="text-slate-500">Trend:</span>
                <span className={`font-semibold ${slope.cls}`}>{slope.text}</span>
              </div>
            )}

            {/* Liq percentile bar for LQ / VS-3 */}
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

            {/* Volume bar for VS-2 and VS-3 */}
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

            <div className="mt-auto text-xs text-slate-500">
              Last fired: <span className="text-slate-300">{formatTs(firedTs ?? null)}</span>
            </div>
          </div>
        )
      })}
    </div>
  )
}
