"""
Signal evaluation — exact rules from PAPER_TRADER_SIGNALS.md.
10 active signals: CA-1, CA-2, VS-3, LQ-1, LQ-3, LQ-4, LQ-5, LQ-6, OV-1, CD-1
Removed: VS-2 (redundant with VS-3), LQ-2 (replaced by LQ-5)
"""
from dataclasses import dataclass


@dataclass
class SignalFire:
    signal: str     # signal name
    direction: str  # 'LONG' or 'SHORT'
    hold_bars: int


def evaluate_signals(
    features: dict,
    current_ts: int,
    is_new_gateio_reading: bool,
    signal_states: dict,
) -> list[SignalFire]:
    """
    Evaluate all 10 active signals for the current 5m bar.

    features keys:
        eth_slope_sign, eth_slope_sign_prev,
        btc_slope_sign, btc_slope_sign_prev,
        volume_btc_pct,
        long_liq_btc_pct, short_liq_btc_pct, total_liq_btc_pct,
        liq_imbalance_above_p80, liq_imbalance_above_p80_prev,
        oi_accelerating, btc_eth_decoupled

    is_new_gateio_reading: True only on first 5m bar after a fresh Gate.io poll
    signal_states: dict keyed by signal name → {last_fire_ts, open_trade_id, ...}
    """

    def in_dedup(signal: str, hold_bars: int) -> bool:
        state = signal_states.get(signal, {})
        last = state.get("last_fire_ts")
        if last is None:
            return False
        return (current_ts - last) < (hold_bars * 300)

    slope          = features["eth_slope_sign"]
    slope_prev     = features["eth_slope_sign_prev"]
    btc_slope      = features["btc_slope_sign"]
    btc_slope_prev = features["btc_slope_sign_prev"]
    vol_pct        = features["volume_btc_pct"]
    ll_pct         = features["long_liq_btc_pct"]
    sl_pct         = features["short_liq_btc_pct"]
    tl_pct         = features["total_liq_btc_pct"]
    liq_above      = bool(features["liq_imbalance_above_p80"])
    liq_above_prev = bool(features["liq_imbalance_above_p80_prev"])
    oi_accel       = bool(features["oi_accelerating"])
    decoupled      = bool(features["btc_eth_decoupled"])

    fires: list[SignalFire] = []

    # Shared flip conditions
    eth_flip         = (slope != slope_prev and slope != 0)
    btc_flip         = (btc_slope != btc_slope_prev and btc_slope != 0)
    bearish_eth_flip = (slope == -1 and slope_prev != -1)

    # -----------------------------------------------------------------------
    # CA-1: ETH slope flip → direction of flip, h=8
    # -----------------------------------------------------------------------
    if eth_flip and not in_dedup("CA-1", 8):
        direction = "LONG" if slope == 1 else "SHORT"
        fires.append(SignalFire("CA-1", direction, 8))

    # -----------------------------------------------------------------------
    # CA-2: BTC slope flip → direction of flip, h=8
    # -----------------------------------------------------------------------
    if btc_flip and not in_dedup("CA-2", 8):
        direction = "LONG" if btc_slope == 1 else "SHORT"
        fires.append(SignalFire("CA-2", direction, 8))

    # -----------------------------------------------------------------------
    # VS-3: ETH slope flip + high volume + elevated liq, h=12
    # -----------------------------------------------------------------------
    if eth_flip and vol_pct >= 0.80 and tl_pct >= 0.70 and not in_dedup("VS-3", 12):
        direction = "LONG" if slope == 1 else "SHORT"
        fires.append(SignalFire("VS-3", direction, 12))

    # -----------------------------------------------------------------------
    # LQ-1: extreme long liq onset → SHORT, h=8
    # -----------------------------------------------------------------------
    if is_new_gateio_reading and ll_pct >= 0.90 and not in_dedup("LQ-1", 8):
        fires.append(SignalFire("LQ-1", "SHORT", 8))

    # -----------------------------------------------------------------------
    # LQ-3: bearish ETH slope flip + elevated long liq → SHORT, h=8
    # -----------------------------------------------------------------------
    if bearish_eth_flip and ll_pct >= 0.70 and not in_dedup("LQ-3", 8):
        fires.append(SignalFire("LQ-3", "SHORT", 8))

    # -----------------------------------------------------------------------
    # LQ-4: extreme long liq onset → SHORT, h=12  (same as LQ-1, longer hold)
    # -----------------------------------------------------------------------
    if is_new_gateio_reading and ll_pct >= 0.90 and not in_dedup("LQ-4", 12):
        fires.append(SignalFire("LQ-4", "SHORT", 12))

    # -----------------------------------------------------------------------
    # LQ-5: extreme short liq onset → LONG, h=12  (replaces LQ-2 with longer hold)
    # -----------------------------------------------------------------------
    if is_new_gateio_reading and sl_pct >= 0.90 and not in_dedup("LQ-5", 12):
        fires.append(SignalFire("LQ-5", "LONG", 12))

    # -----------------------------------------------------------------------
    # LQ-6: liq directional imbalance > p80 onset → SHORT, h=12
    # -----------------------------------------------------------------------
    if is_new_gateio_reading and liq_above and not liq_above_prev and not in_dedup("LQ-6", 12):
        fires.append(SignalFire("LQ-6", "SHORT", 12))

    # -----------------------------------------------------------------------
    # OV-1: ETH slope flip + OI acceleration → direction of flip, h=24
    # -----------------------------------------------------------------------
    if eth_flip and oi_accel and not in_dedup("OV-1", 24):
        direction = "LONG" if slope == 1 else "SHORT"
        fires.append(SignalFire("OV-1", direction, 24))

    # -----------------------------------------------------------------------
    # CD-1: ETH slope flip + BTC-ETH correlation < p20 → direction of flip, h=12
    # -----------------------------------------------------------------------
    if eth_flip and decoupled and not in_dedup("CD-1", 12):
        direction = "LONG" if slope == 1 else "SHORT"
        fires.append(SignalFire("CD-1", direction, 12))

    return fires
