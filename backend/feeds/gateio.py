import time
import logging
import httpx

logger = logging.getLogger(__name__)

GATEIO_URL = "https://api.gateio.ws/api/v4/futures/usdt/contract_stats"
SYMBOL_MAP = {"BTC": "BTC_USDT", "ETH": "ETH_USDT"}


async def fetch_liquidations_history(
    symbol: str,
    from_ts: int,
    limit: int = 720,
) -> list[dict]:
    """
    Fetch up to `limit` hourly liquidation records from Gate.io for `symbol` ('BTC' or 'ETH').
    Returns list of dicts: {ts, symbol, long_liq_usd, short_liq_usd}
    """
    contract = SYMBOL_MAP[symbol]
    results = []
    remaining = limit
    current_from = from_ts

    async with httpx.AsyncClient(timeout=30) as client:
        while remaining > 0:
            batch = min(remaining, 200)  # Gate.io max per request
            params = {
                "contract": contract,
                "interval": "1h",
                "from": current_from,
                "limit": batch,
            }
            resp = await client.get(GATEIO_URL, params=params)
            resp.raise_for_status()
            data = resp.json()

            if not data:
                break

            for row in data:
                results.append(
                    {
                        "ts": int(row["time"]),
                        "symbol": symbol,
                        "long_liq_usd": float(row.get("long_liq_usd", 0) or 0),
                        "short_liq_usd": float(row.get("short_liq_usd", 0) or 0),
                    }
                )

            if len(data) < batch:
                break

            current_from = results[-1]["ts"] + 3600
            remaining -= len(data)

    logger.info("Gate.io bootstrap: fetched %d %s liquidation records", len(results), symbol)
    return results


async def fetch_latest_liquidations(symbol: str, n: int = 2) -> list[dict]:
    """
    Fetch the last `n` hourly records. Used by the live polling job.
    Returns list of dicts: {ts, symbol, long_liq_usd, short_liq_usd}
    """
    contract = SYMBOL_MAP[symbol]
    async with httpx.AsyncClient(timeout=15) as client:
        params = {
            "contract": contract,
            "interval": "1h",
            "limit": n,
        }
        resp = await client.get(GATEIO_URL, params=params)
        resp.raise_for_status()
        data = resp.json()

    return [
        {
            "ts": int(row["time"]),
            "symbol": symbol,
            "long_liq_usd": float(row.get("long_liq_usd", 0) or 0),
            "short_liq_usd": float(row.get("short_liq_usd", 0) or 0),
        }
        for row in data
    ]


if __name__ == "__main__":
    import asyncio

    async def _test():
        from_ts = int(time.time()) - 7 * 3600  # last 7 hours
        rows = await fetch_latest_liquidations("BTC", n=3)
        for r in rows:
            print(r)

    asyncio.run(_test())
