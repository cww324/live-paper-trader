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
  eth_slope_sign: number
  btc_slope_sign: number
  volume_btc_pct: number
  long_liq_btc_pct: number
  short_liq_btc_pct: number
  total_liq_btc_pct: number
  liq_imbalance_above_p80: number   // 0 or 1
  oi_accelerating: number            // 0 or 1
  btc_eth_decoupled: number          // 0 or 1
}

export type SignalFireEvent = {
  type: 'signal_fire'
  signal: string
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
  started_at: number | null
}
