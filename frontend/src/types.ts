export type CandleEvent = {
  type: 'candle'
  symbol: 'BTC-USD' | 'ETH-USD'
  ts: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export type FeatureUpdateEvent = {
  type: 'feature_update'
  eth_slope_sign: number        // -1, 0, or 1
  btc_slope_sign: number        // -1, 0, or 1
  volume_btc_pct: number        // 0.0–1.0
  long_liq_btc_pct: number
  short_liq_btc_pct: number
  total_liq_btc_pct: number
}

export type SignalFireEvent = {
  type: 'signal_fire'
  signal: 'CA-1' | 'CA-2' | 'VS-2' | 'VS-3' | 'LQ-1' | 'LQ-2' | 'LQ-3'
  direction: 'LONG' | 'SHORT'
  entry_price: number
  ts: number
}

export type TradeCloseEvent = {
  type: 'trade_close'
  signal: string
  direction: 'LONG' | 'SHORT'
  entry_price: number
  exit_price: number
  gross_bps: number
  ts: number
}

export type WSEvent = CandleEvent | FeatureUpdateEvent | SignalFireEvent | TradeCloseEvent

export type Trade = {
  id: number
  signal: string
  direction: 'LONG' | 'SHORT'
  entry_ts: number
  entry_price: number
  exit_ts: number | null
  exit_price: number | null
  hold_bars: number
  gross_bps: number | null
  status: 'OPEN' | 'CLOSED'
}

export type SignalState = {
  last_fire_ts: number | null
  last_fire_dir: string | null
  open_trade_id: number | null
}
