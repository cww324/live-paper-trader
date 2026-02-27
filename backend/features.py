"""
Feature computation from raw candle + liquidation data.
All features match the exact spec definitions — do not change thresholds or formulas.
"""
import numpy as np
import pandas as pd


ROLLING_WINDOW = 8640  # 30 days × 12 bars/hour × 24 hours


def compute_eth_slope_sign(eth_candles: pd.DataFrame) -> pd.Series:
    """
    eth_candles: DataFrame with columns [ts, close], sorted ascending.
    Returns Series of slope sign (-1, 0, +1) indexed by ts (5m resolution, Unix seconds).
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
    Returns Series of slope sign (-1, 0, +1) indexed by ts (5m resolution, Unix seconds).
    Identical logic to compute_eth_slope_sign() but applied to BTC candles.
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
        btc_candles:  DataFrame [ts, close, volume]
        eth_candles:  DataFrame [ts, close]
        liquidations: DataFrame [ts, long_liq_usd, short_liq_usd] — hourly BTC values,
                      already carry-forwarded or to be carry-forwarded here.

    Returns a DataFrame indexed by ts (Unix int) with columns:
        eth_slope_sign, eth_slope_sign_prev,
        btc_slope_sign, btc_slope_sign_prev,
        volume_btc_pct,
        long_liq_btc_pct, short_liq_btc_pct, total_liq_btc_pct
    """
    # --- BTC volume pct rank ---
    btc = btc_candles.set_index("ts").sort_index()
    volume_pct = btc["volume"].rolling(ROLLING_WINDOW, min_periods=1).rank(pct=True)
    volume_pct.name = "volume_btc_pct"

    btc_dt_index = pd.to_datetime(btc.index, unit="s", utc=True)

    # --- ETH slope sign (5m resolution, indexed by datetime) ---
    eth_slope_dt = compute_eth_slope_sign(eth_candles)
    eth_slope_aligned = eth_slope_dt.reindex(btc_dt_index, method="ffill").fillna(0)
    eth_slope_aligned.index = btc.index
    eth_slope_aligned.name = "eth_slope_sign"
    eth_slope_prev = eth_slope_aligned.shift(1).fillna(0)
    eth_slope_prev.name = "eth_slope_sign_prev"

    # --- BTC slope sign (5m resolution) ---
    btc_slope_dt = compute_btc_slope_sign(btc_candles)
    btc_slope_aligned = btc_slope_dt.reindex(btc_dt_index, method="ffill").fillna(0)
    btc_slope_aligned.index = btc.index
    btc_slope_aligned.name = "btc_slope_sign"
    btc_slope_prev = btc_slope_aligned.shift(1).fillna(0)
    btc_slope_prev.name = "btc_slope_sign_prev"

    # --- Liquidation features ---
    liq = liquidations.set_index("ts").sort_index()
    liq["total_liq_usd"] = liq["long_liq_usd"] + liq["short_liq_usd"]

    liq_5m = liq.reindex(btc.index, method="ffill").fillna(0)

    long_liq_pct = liq_5m["long_liq_usd"].rolling(ROLLING_WINDOW, min_periods=1).rank(pct=True)
    short_liq_pct = liq_5m["short_liq_usd"].rolling(ROLLING_WINDOW, min_periods=1).rank(pct=True)
    total_liq_pct = liq_5m["total_liq_usd"].rolling(ROLLING_WINDOW, min_periods=1).rank(pct=True)

    features = pd.DataFrame(
        {
            "eth_slope_sign": eth_slope_aligned,
            "eth_slope_sign_prev": eth_slope_prev,
            "btc_slope_sign": btc_slope_aligned,
            "btc_slope_sign_prev": btc_slope_prev,
            "volume_btc_pct": volume_pct,
            "long_liq_btc_pct": long_liq_pct,
            "short_liq_btc_pct": short_liq_pct,
            "total_liq_btc_pct": total_liq_pct,
        }
    )
    return features


def get_latest_features(features: pd.DataFrame) -> dict:
    """Extract the most recent row as a plain dict."""
    row = features.iloc[-1]
    return {
        "eth_slope_sign": float(row["eth_slope_sign"]),
        "eth_slope_sign_prev": float(row["eth_slope_sign_prev"]),
        "btc_slope_sign": float(row["btc_slope_sign"]),
        "btc_slope_sign_prev": float(row["btc_slope_sign_prev"]),
        "volume_btc_pct": float(row["volume_btc_pct"]),
        "long_liq_btc_pct": float(row["long_liq_btc_pct"]),
        "short_liq_btc_pct": float(row["short_liq_btc_pct"]),
        "total_liq_btc_pct": float(row["total_liq_btc_pct"]),
    }
