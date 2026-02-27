"""
FastAPI application entry point.
Wires together: bootstrap → Coinbase WS feed → Gate.io poller → signal engine → trade manager.
Serves React frontend from frontend/dist/ and exposes REST + WebSocket endpoints.
"""
import asyncio
import json
import logging
import os
import time
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv
load_dotenv()

import aiosqlite
import pandas as pd
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from backend import db
from backend.features import compute_features, get_latest_features
from backend.feeds import coinbase_ws, gateio
from backend.signals import evaluate_signals
from backend.trade_manager import check_exits, process_signals

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

DB_PATH = os.getenv("DB_PATH", "data/paper_trader.db")

# ---------------------------------------------------------------------------
# Global state
# ---------------------------------------------------------------------------

_db_conn: aiosqlite.Connection | None = None
_connected_ws: set[WebSocket] = set()
_features_cache: dict = {}
_last_gateio_ts: dict[str, int] = {"BTC": 0, "ETH": 0}
_is_new_gateio_reading: bool = False
# Track last BTC bar ts to detect new bars
_last_btc_bar_ts: int = 0


# ---------------------------------------------------------------------------
# WebSocket broadcast
# ---------------------------------------------------------------------------

async def _broadcast(event: dict) -> None:
    dead: set[WebSocket] = set()
    data = json.dumps(event)
    for ws in _connected_ws:
        try:
            await ws.send_text(data)
        except Exception:
            dead.add(ws)
    _connected_ws.difference_update(dead)


# ---------------------------------------------------------------------------
# Candle handler (called on every WS update from Coinbase)
# ---------------------------------------------------------------------------

async def _on_candle(candle: dict) -> None:
    global _last_btc_bar_ts, _is_new_gateio_reading, _features_cache

    conn = _db_conn
    if conn is None:
        return

    # Upsert into DB and broadcast raw candle event
    await db.upsert_candles(conn, [candle])
    await _broadcast({**candle, "type": "candle"})

    # Only run signal evaluation on BTC bars (ETH candles update features too but
    # signals/trade management is driven by BTC bar close)
    if candle["symbol"] != "BTC-USD":
        return

    current_ts = candle["ts"]
    current_price = candle["close"]

    # Detect new bar (skip duplicate updates for same bar)
    is_new_bar = current_ts != _last_btc_bar_ts
    _last_btc_bar_ts = current_ts

    # Prune old data periodically (every ~1h = 12 bars)
    if is_new_bar and (current_ts % 3600) < 300:
        await db.prune_old_rows(conn)

    # Recompute features on the rolling window
    btc_rows = await db.get_candles(conn, "BTC-USD")
    eth_rows = await db.get_candles(conn, "ETH-USD")
    liq_rows = await db.get_liquidations(conn, "BTC")

    if len(btc_rows) < 2 or not eth_rows or not liq_rows:
        return

    btc_df = pd.DataFrame(btc_rows)
    eth_df = pd.DataFrame(eth_rows)
    liq_df = pd.DataFrame(liq_rows)

    features_df = compute_features(btc_df, eth_df, liq_df)
    _features_cache = get_latest_features(features_df)

    # Broadcast feature update
    await _broadcast({**_features_cache, "type": "feature_update"})

    if not is_new_bar:
        return

    # Get dedup state and evaluate signals
    signal_states = await db.get_signal_states(conn)
    fires = evaluate_signals(
        _features_cache,
        current_ts,
        _is_new_gateio_reading,
        signal_states,
    )
    _is_new_gateio_reading = False  # consumed

    # Check exits first, then open new trades
    await check_exits(conn, current_ts, current_price, _broadcast)
    if fires:
        await process_signals(conn, fires, current_ts, current_price, _broadcast)


# ---------------------------------------------------------------------------
# Gate.io polling job (runs every hour at :02)
# ---------------------------------------------------------------------------

async def _poll_gateio() -> None:
    global _is_new_gateio_reading, _last_gateio_ts
    conn = _db_conn
    if conn is None:
        return

    logger.info("Polling Gate.io liquidations...")
    for sym in ("BTC", "ETH"):
        try:
            rows = await gateio.fetch_latest_liquidations(sym, n=2)
            if not rows:
                continue
            latest_ts = rows[-1]["ts"]
            if latest_ts > _last_gateio_ts[sym]:
                await db.upsert_liquidations(conn, rows)
                _last_gateio_ts[sym] = latest_ts
                if sym == "BTC":
                    _is_new_gateio_reading = True
                    logger.info("New Gate.io BTC reading at ts=%d", latest_ts)
        except Exception as exc:
            logger.warning("Gate.io poll error (%s): %s", sym, exc)


# ---------------------------------------------------------------------------
# Bootstrap
# ---------------------------------------------------------------------------

async def _bootstrap(conn: aiosqlite.Connection) -> None:
    logger.info("Starting bootstrap — fetching 30 days of historical data...")

    # Step 1: Candles
    for product_id in ["BTC-USD", "ETH-USD"]:
        logger.info("Fetching %s candles...", product_id)
        try:
            rows = await coinbase_ws.fetch_candles_history(product_id)
            if rows:
                await db.upsert_candles(conn, rows)
                logger.info("Inserted %d %s candles", len(rows), product_id)
        except Exception as exc:
            logger.error("Failed to bootstrap %s candles: %s", product_id, exc)

    # Step 2: Liquidations
    from_ts = int(time.time()) - 30 * 24 * 3600
    for sym in ("BTC", "ETH"):
        logger.info("Fetching %s liquidations...", sym)
        try:
            rows = await gateio.fetch_liquidations_history(sym, from_ts=from_ts, limit=720)
            if rows:
                await db.upsert_liquidations(conn, rows)
                _last_gateio_ts[sym] = rows[-1]["ts"]
                logger.info("Inserted %d %s liquidation records", len(rows), sym)
        except Exception as exc:
            logger.error("Failed to bootstrap %s liquidations: %s", sym, exc)

    logger.info("Bootstrap complete.")


# ---------------------------------------------------------------------------
# App lifespan
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    global _db_conn

    os.makedirs(os.path.dirname(DB_PATH) if os.path.dirname(DB_PATH) else ".", exist_ok=True)
    _db_conn = await aiosqlite.connect(DB_PATH)
    await db.init_db(_db_conn)

    await _bootstrap(_db_conn)

    scheduler = AsyncIOScheduler()
    scheduler.add_job(_poll_gateio, "cron", minute=2)
    scheduler.start()

    ws_task = asyncio.create_task(coinbase_ws.run_websocket(_on_candle))
    logger.info("Live WebSocket feed started.")

    yield

    ws_task.cancel()
    scheduler.shutdown(wait=False)
    await _db_conn.close()


# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------

app = FastAPI(lifespan=lifespan)


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    _connected_ws.add(websocket)
    try:
        while True:
            await websocket.receive_text()  # keep alive; we don't expect client messages
    except WebSocketDisconnect:
        _connected_ws.discard(websocket)


@app.get("/api/candles")
async def api_candles(symbol: str = "BTC-USD", limit: int = 576):
    rows = await db.get_candles_desc(_db_conn, symbol, limit)
    rows.reverse()  # return ascending
    return rows


@app.get("/api/trades")
async def api_trades(status: str = "all", limit: int = 100):
    return await db.get_trades(_db_conn, status=status, limit=limit)


@app.get("/api/config")
async def api_config():
    started_at = await db.get_started_at(_db_conn)
    return {
        "initial_equity": float(os.getenv("INITIAL_EQUITY", "10000")),
        "risk_pct": float(os.getenv("RISK_PCT", "0.005")),
        "started_at": started_at,
    }


@app.get("/api/signals")
async def api_signals():
    signal_states = await db.get_signal_states(_db_conn)
    return {"signal_states": signal_states, "features": _features_cache}


# Serve React build — mount static assets, catch-all for SPA routing
_frontend_dist = Path(__file__).parent.parent / "frontend" / "dist"

if _frontend_dist.exists():
    app.mount("/assets", StaticFiles(directory=str(_frontend_dist / "assets")), name="assets")

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        return FileResponse(str(_frontend_dist / "index.html"))
