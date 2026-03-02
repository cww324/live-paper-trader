"""
Coinbase Advanced Trade feed:
  - REST bootstrap: fetch 30 days of 5m candles for BTC-USD and ETH-USD
  - WebSocket: subscribe to live 5m candle updates
"""
import asyncio
import hashlib
import hmac
import json
import logging
import os
import time
from typing import Callable, Awaitable

import httpx
import websockets
from cryptography.hazmat.primitives.serialization import load_pem_private_key
import jwt

logger = logging.getLogger(__name__)

CANDLES_REST_URL = "https://api.coinbase.com/api/v3/brokerage/market/products/{product_id}/candles"
WS_URL = "wss://advanced-trade-ws.coinbase.com"
PRODUCTS = ["BTC-USD", "ETH-USD"]

# 30 days in seconds
WINDOW_SECONDS = 30 * 24 * 3600
# 5 minutes per bar → 8640 bars per 30 days
BARS_PER_WINDOW = 8640


def _get_credentials() -> tuple[str, str]:
    key_name = os.environ["COINBASE_KEY_NAME"]
    private_key_pem = os.environ["COINBASE_PRIVATE_KEY"].replace("\\n", "\n")
    return key_name, private_key_pem


def _build_jwt(key_name: str, private_key_pem: str, uri: str = "") -> str:
    """Build a JWT signed with the EC private key for Coinbase Advanced Trade."""
    private_key = load_pem_private_key(private_key_pem.encode(), password=None)
    now = int(time.time())
    payload = {
        "sub": key_name,
        "iss": "cdp",
        "nbf": now,
        "exp": now + 120,
    }
    if uri:
        payload["uri"] = uri
    token = jwt.encode(
        payload,
        private_key,
        algorithm="ES256",
        headers={"kid": key_name, "nonce": hashlib.sha256(str(now).encode()).hexdigest()[:16]},
    )
    return token


async def fetch_candles_history(product_id: str) -> list[dict]:
    """
    Fetch 30 days of 5m candles from Coinbase REST API (paginated, max 300/request).
    Returns list of dicts sorted ascending by ts.
    """
    key_name, private_key_pem = _get_credentials()
    end_ts = int(time.time())
    start_ts = end_ts - WINDOW_SECONDS

    results: list[dict] = []
    current_end = end_ts
    batch_seconds = 300 * 300  # 300 bars × 300 sec/bar = 90000 sec per page

    async with httpx.AsyncClient(timeout=30) as client:
        while current_end > start_ts:
            current_start = max(start_ts, current_end - batch_seconds)
            uri = f"GET api.coinbase.com/api/v3/brokerage/market/products/{product_id}/candles"
            token = _build_jwt(key_name, private_key_pem, uri)
            url = CANDLES_REST_URL.format(product_id=product_id)
            params = {
                "granularity": "FIVE_MINUTE",
                "start": str(current_start),
                "end": str(current_end),
            }
            resp = await client.get(
                url, params=params, headers={"Authorization": f"Bearer {token}"}
            )
            resp.raise_for_status()
            candles = resp.json().get("candles", [])

            for c in candles:
                results.append(
                    {
                        "ts": int(c["start"]),
                        "symbol": product_id,
                        "open": float(c["open"]),
                        "high": float(c["high"]),
                        "low": float(c["low"]),
                        "close": float(c["close"]),
                        "volume": float(c["volume"]),
                    }
                )

            if not candles:
                current_end = current_start
            else:
                current_end = current_start

            logger.debug(
                "Coinbase REST %s: fetched %d candles (batch end=%d)",
                product_id, len(candles), current_end,
            )
            await asyncio.sleep(0.1)  # be polite

    # Deduplicate and sort ascending
    seen: set[int] = set()
    unique = []
    for r in results:
        if r["ts"] not in seen:
            seen.add(r["ts"])
            unique.append(r)
    unique.sort(key=lambda x: x["ts"])
    logger.info("Coinbase REST %s: total %d unique candles fetched", product_id, len(unique))
    return unique


async def run_websocket(
    on_candle: Callable[[dict], Awaitable[None]],
) -> None:
    """
    Connect to Coinbase Advanced Trade WebSocket and stream 5m candle updates.
    Calls `on_candle(candle_dict)` for each update received.
    Reconnects with exponential backoff on disconnect.
    """
    key_name, private_key_pem = _get_credentials()
    backoff = 1

    while True:
        try:
            logger.info("Connecting to Coinbase WebSocket...")
            async with websockets.connect(WS_URL, ping_interval=20, ping_timeout=30) as ws:
                # Build signed subscribe message
                ts = str(int(time.time()))
                channel = "candles"
                product_ids_str = ",".join(PRODUCTS)
                # Coinbase WS signature: HMAC-SHA256 of "{ts}{channel}{product_ids}"
                # For JWT auth we embed a JWT instead
                token = _build_jwt(key_name, private_key_pem)
                subscribe_msg = {
                    "type": "subscribe",
                    "product_ids": PRODUCTS,
                    "channel": channel,
                    "api_key": key_name,
                    "timestamp": ts,
                    "jwt": token,
                }
                await ws.send(json.dumps(subscribe_msg))
                logger.info("Subscribed to Coinbase candles for %s", PRODUCTS)
                backoff = 1  # reset on successful connect

                while True:
                    try:
                        raw = await asyncio.wait_for(ws.recv(), timeout=600)
                    except asyncio.TimeoutError:
                        logger.warning("Coinbase WS silent for 10 min — reconnecting")
                        break
                    msg = json.loads(raw)
                    channel_name = msg.get("channel", "")
                    if channel_name != "candles":
                        logger.info("Coinbase WS non-candle message: channel=%s", channel_name)
                        continue
                    for event in msg.get("events", []):
                        for candle in event.get("candles", []):
                            await on_candle(
                                {
                                    "ts": int(candle["start"]),
                                    "symbol": candle["product_id"],
                                    "open": float(candle["open"]),
                                    "high": float(candle["high"]),
                                    "low": float(candle["low"]),
                                    "close": float(candle["close"]),
                                    "volume": float(candle["volume"]),
                                }
                            )

        except Exception as exc:
            logger.warning("Coinbase WS disconnected: %s — reconnecting in %ds", exc, backoff)
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, 30)


if __name__ == "__main__":
    logging.basicConfig(level=logging.DEBUG)

    async def _print_candle(c: dict):
        print(c)

    asyncio.run(run_websocket(_print_candle))
