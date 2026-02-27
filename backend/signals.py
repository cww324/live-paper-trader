"""
Signal evaluation — exact rules from spec. Do not change any thresholds.
"""
from dataclasses import dataclass


@dataclass
class SignalFire:
    signal: str    # 'LQ-1', 'LQ-2', 'LQ-3', 'VS-3'
    direction: str  # 'LONG' or 'SHORT'
    hold_bars: int


def evaluate_signals(
    features: dict,
    current_ts: int,
    is_new_gateio_reading: bool,
    signal_states: dict,
) -> list[SignalFire]:
    """
    Evaluate all 4 signals for the current 5m bar.

    features:
        eth_slope_sign, eth_slope_sign_prev, volume_btc_pct,
        long_liq_btc_pct, short_liq_btc_pct, total_liq_btc_pct

    signal_states: dict keyed by signal name → {last_fire_ts, last_fire_dir, open_trade_id}
    is_new_gateio_reading: True only on the first 5m bar after a fresh Gate.io poll

    Returns list of SignalFire (may be empty).
    """

    def in_dedup(signal: str, hold_bars: int) -> bool:
        last = signal_states[signal]["last_fire_ts"]
        if last is None:
            return False
        return (current_ts - last) < (hold_bars * 300)

    slope = features["eth_slope_sign"]          # current: -1, 0, or +1
    slope_prev = features["eth_slope_sign_prev"]  # previous bar
    vol_pct = features["volume_btc_pct"]
    ll_pct = features["long_liq_btc_pct"]
    sl_pct = features["short_liq_btc_pct"]
    tl_pct = features["total_liq_btc_pct"]

    fires: list[SignalFire] = []

    # LQ-1: extreme long liq → SHORT
    if is_new_gateio_reading and ll_pct >= 0.90 and not in_dedup("LQ-1", 8):
        fires.append(SignalFire("LQ-1", "SHORT", 8))

    # LQ-2: extreme short liq → LONG
    if is_new_gateio_reading and sl_pct >= 0.90 and not in_dedup("LQ-2", 8):
        fires.append(SignalFire("LQ-2", "LONG", 8))

    # LQ-3: bearish slope flip + elevated long liq → SHORT
    bearish_flip = slope == -1 and slope_prev != -1
    if bearish_flip and ll_pct >= 0.70 and not in_dedup("LQ-3", 8):
        fires.append(SignalFire("LQ-3", "SHORT", 8))

    # VS-3: any slope flip + high volume + elevated total liq → direction of flip
    any_flip = slope != slope_prev and slope != 0
    if any_flip and vol_pct >= 0.80 and tl_pct >= 0.70 and not in_dedup("VS-3", 12):
        direction = "LONG" if slope == 1 else "SHORT"
        fires.append(SignalFire("VS-3", direction, 12))

    return fires
