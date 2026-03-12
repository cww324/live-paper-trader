"""
Feature computation from raw candle + liquidation data.
All features match the exact spec definitions — do not change thresholds or formulas.
"""
import numpy as np
import pandas as pd


# 20-day rolling window for percentile ranks (5760 = 20d × 24h × 12 bars/h)
ROLLING_WINDOW = 5760


def compute_eth_slope_sign(eth_candles: pd.DataFrame) -> pd.Series:
    """
    eth_candles: DataFrame with columns [ts, close], sorted ascending.
    Returns Series of slope sign (-1, 0, +1) indexed by datetime (5m resolution).
    """
    eth = eth_candles.set_index(
        pd.to_datetime(eth_candles["ts"], unit="s", utc=True)
    )["close"]

    eth_1h = eth.resample("1h").last().dropna()
    eth_ema20 = eth_1h.ewm(span=20, adjust=False).mean()
    eth_slope = eth_ema20.diff(3)
    eth_slope_sign_1h = np.sign(eth_slope)

    # Carry-forward to 5m resolution
    eth_slope_sign_5m = eth_slope_sign_1h.reindex(eth.index, method="ffill")
    return eth_slope_sign_5m


def compute_btc_slope_sign(btc_candles: pd.DataFrame) -> pd.Series:
    """
    btc_candles: DataFrame with columns [ts, close], sorted ascending.
    Returns Series of slope sign (-1, 0, +1) indexed by datetime (5m resolution).
    """
    btc = btc_candles.set_index(
        pd.to_datetime(btc_candles["ts"], unit="s", utc=True)
    )["close"]

    btc_1h = btc.resample("1h").last().dropna()
    btc_ema20 = btc_1h.ewm(span=20, adjust=False).mean()
    btc_slope = btc_ema20.diff(3)
    btc_slope_sign_1h = np.sign(btc_slope)
    btc_slope_sign_5m = btc_slope_sign_1h.reindex(btc.index, method="ffill")

    return btc_slope_sign_5m


def compute_features(
    btc_candles: pd.DataFrame,
    eth_candles: pd.DataFrame,
    liquidations: pd.DataFrame,
) -> pd.DataFrame:
    """
    Compute all features on the full dataset.

    Inputs (all sorted ascending by ts):
        btc_candles:  DataFrame [ts, open, high, low, close, volume]
        eth_candles:  DataFrame [ts, close]
        liquidations: DataFrame [ts, long_liq_usd, short_liq_usd, open_interest]

    Returns a DataFrame indexed by ts (Unix int) with columns:
        eth_slope_sign, eth_slope_sign_prev,
        btc_slope_sign, btc_slope_sign_prev,
        volume_btc_pct,
        long_liq_btc_pct, short_liq_btc_pct, total_liq_btc_pct,
        liq_imbalance_above_p80, liq_imbalance_above_p80_prev,
        oi_accelerating,
        btc_eth_decoupled
    """
    # --- BTC index ---
    btc = btc_candles.set_index("ts").sort_index()
    btc_dt_index = pd.to_datetime(btc.index, unit="s", utc=True)

    # --- BTC volume pct rank ---
    volume_pct = btc["volume"].rolling(ROLLING_WINDOW, min_periods=1).rank(pct=True)
    volume_pct.name = "volume_btc_pct"

    # --- ETH slope sign ---
    eth_slope_dt = compute_eth_slope_sign(eth_candles)
    eth_slope_aligned = eth_slope_dt.reindex(btc_dt_index, method="ffill").fillna(0)
    eth_slope_aligned.index = btc.index
    eth_slope_aligned.name = "eth_slope_sign"
    eth_slope_prev = eth_slope_aligned.shift(1).fillna(0)
    eth_slope_prev.name = "eth_slope_sign_prev"

    # --- BTC slope sign ---
    btc_slope_dt = compute_btc_slope_sign(btc_candles)
    btc_slope_aligned = btc_slope_dt.reindex(btc_dt_index, method="ffill").fillna(0)
    btc_slope_aligned.index = btc.index
    btc_slope_aligned.name = "btc_slope_sign"
    btc_slope_prev = btc_slope_aligned.shift(1).fillna(0)
    btc_slope_prev.name = "btc_slope_sign_prev"

    # --- Liquidation base features ---
    liq = liquidations.set_index("ts").sort_index()
    liq["total_liq_usd"] = liq["long_liq_usd"] + liq["short_liq_usd"]

    liq_5m = liq.reindex(btc.index, method="ffill").fillna(0)

    long_liq_pct  = liq_5m["long_liq_usd"].rolling(ROLLING_WINDOW, min_periods=1).rank(pct=True)
    short_liq_pct = liq_5m["short_liq_usd"].rolling(ROLLING_WINDOW, min_periods=1).rank(pct=True)
    total_liq_pct = liq_5m["total_liq_usd"].rolling(ROLLING_WINDOW, min_periods=1).rank(pct=True)

    # --- LQ-6: liq directional imbalance onset ---
    # Ranges -0.5 (all short liq) to +0.5 (all long liq)
    total_safe = liq_5m["total_liq_usd"].replace(0, np.nan)
    liq_imbalance = (liq_5m["long_liq_usd"] / total_safe).fillna(0.5) - 0.5
    imbalance_threshold = liq_imbalance.rolling(ROLLING_WINDOW, min_periods=100).quantile(0.80)
    liq_above = (liq_imbalance >= imbalance_threshold).astype(float).fillna(0)
    liq_above_prev = liq_above.shift(1).fillna(0)

    # --- OV-1: OI acceleration gate ---
    oi = liq_5m["open_interest"] if "open_interest" in liq_5m.columns else pd.Series(
        0.0, index=liq_5m.index
    )
    oi_chg_now  = oi - oi.shift(12)   # change over last 1h (12 × 5m bars)
    oi_chg_prev = oi.shift(12) - oi.shift(24)  # change over prior 1h
    oi_accelerating = (oi_chg_now > oi_chg_prev).astype(float).fillna(0)

    # --- CD-1: BTC-ETH 2h rolling correlation ---
    eth = eth_candles.set_index("ts").sort_index()
    eth_close_5m = eth["close"].reindex(btc.index, method="ffill")
    ret_btc = btc["close"].pct_change()
    ret_eth = eth_close_5m.pct_change()
    corr_2h = ret_btc.rolling(24).corr(ret_eth).fillna(0)
    # Use expanding window (all available history, min 20 days) for stable p20 threshold
    corr_p20 = corr_2h.expanding(min_periods=ROLLING_WINDOW).quantile(0.20)
    btc_eth_decoupled = (corr_2h < corr_p20).astype(float).fillna(0)

    features = pd.DataFrame(
        {
            "eth_slope_sign":             eth_slope_aligned,
            "eth_slope_sign_prev":        eth_slope_prev,
            "btc_slope_sign":             btc_slope_aligned,
            "btc_slope_sign_prev":        btc_slope_prev,
            "volume_btc_pct":             volume_pct,
            "long_liq_btc_pct":           long_liq_pct,
            "short_liq_btc_pct":          short_liq_pct,
            "total_liq_btc_pct":          total_liq_pct,
            "liq_imbalance_above_p80":    liq_above,
            "liq_imbalance_above_p80_prev": liq_above_prev,
            "oi_accelerating":            oi_accelerating,
            "btc_eth_decoupled":          btc_eth_decoupled,
        }
    )
    return features


def get_latest_features(features: pd.DataFrame) -> dict:
    """Extract the most recent row as a plain dict."""
    row = features.iloc[-1]
    return {
        "eth_slope_sign":               float(row["eth_slope_sign"]),
        "eth_slope_sign_prev":          float(row["eth_slope_sign_prev"]),
        "btc_slope_sign":               float(row["btc_slope_sign"]),
        "btc_slope_sign_prev":          float(row["btc_slope_sign_prev"]),
        "volume_btc_pct":               float(row["volume_btc_pct"]),
        "long_liq_btc_pct":             float(row["long_liq_btc_pct"]),
        "short_liq_btc_pct":            float(row["short_liq_btc_pct"]),
        "total_liq_btc_pct":            float(row["total_liq_btc_pct"]),
        "liq_imbalance_above_p80":      float(row["liq_imbalance_above_p80"]),
        "liq_imbalance_above_p80_prev": float(row["liq_imbalance_above_p80_prev"]),
        "oi_accelerating":              float(row["oi_accelerating"]),
        "btc_eth_decoupled":            float(row["btc_eth_decoupled"]),
    }
