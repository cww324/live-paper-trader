import os
import aiosqlite

DB_PATH = os.getenv("DB_PATH", "data/paper_trader.db")

_CREATE_CANDLES = """
CREATE TABLE IF NOT EXISTS candles_5m (
    ts      INTEGER NOT NULL,
    symbol  TEXT NOT NULL,
    open    REAL NOT NULL,
    high    REAL NOT NULL,
    low     REAL NOT NULL,
    close   REAL NOT NULL,
    volume  REAL NOT NULL,
    PRIMARY KEY (ts, symbol)
);
"""

_CREATE_LIQUIDATIONS = """
CREATE TABLE IF NOT EXISTS liquidations_1h (
    ts            INTEGER NOT NULL,
    symbol        TEXT NOT NULL,
    long_liq_usd  REAL NOT NULL DEFAULT 0.0,
    short_liq_usd REAL NOT NULL DEFAULT 0.0,
    PRIMARY KEY (ts, symbol)
);
"""

_CREATE_TRADES = """
CREATE TABLE IF NOT EXISTS paper_trades (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    signal       TEXT NOT NULL,
    direction    TEXT NOT NULL,
    entry_ts     INTEGER NOT NULL,
    entry_price  REAL NOT NULL,
    exit_ts      INTEGER,
    exit_price   REAL,
    hold_bars    INTEGER NOT NULL,
    gross_bps    REAL,
    status       TEXT NOT NULL DEFAULT 'OPEN'
);
"""

_CREATE_SIGNAL_STATE = """
CREATE TABLE IF NOT EXISTS signal_state (
    signal         TEXT PRIMARY KEY,
    last_fire_ts   INTEGER,
    last_fire_dir  TEXT,
    open_trade_id  INTEGER
);
"""

_CREATE_META = """
CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
"""

_SEED_SIGNAL_STATE = """
INSERT OR IGNORE INTO signal_state (signal)
VALUES ('CA-1'), ('CA-2'), ('VS-2'), ('VS-3'), ('LQ-1'), ('LQ-2'), ('LQ-3');
"""

_SEED_STARTED_AT = """
INSERT OR IGNORE INTO meta (key, value)
VALUES ('started_at', CAST(strftime('%s', 'now') AS TEXT));
"""


async def init_db(db: aiosqlite.Connection) -> None:
    await db.execute(_CREATE_CANDLES)
    await db.execute(_CREATE_LIQUIDATIONS)
    await db.execute(_CREATE_TRADES)
    await db.execute(_CREATE_SIGNAL_STATE)
    await db.execute(_CREATE_META)
    await db.execute(_SEED_SIGNAL_STATE)
    await db.execute(_SEED_STARTED_AT)
    await db.commit()


async def get_started_at(db: aiosqlite.Connection) -> int | None:
    async with db.execute("SELECT value FROM meta WHERE key = 'started_at'") as cur:
        row = await cur.fetchone()
    return int(row[0]) if row else None


async def upsert_candles(db: aiosqlite.Connection, rows: list[dict]) -> None:
    """Insert or replace candle rows. Each dict: ts, symbol, open, high, low, close, volume."""
    await db.executemany(
        """
        INSERT OR REPLACE INTO candles_5m (ts, symbol, open, high, low, close, volume)
        VALUES (:ts, :symbol, :open, :high, :low, :close, :volume)
        """,
        rows,
    )
    await db.commit()


async def upsert_liquidations(db: aiosqlite.Connection, rows: list[dict]) -> None:
    """Insert or replace liquidation rows. Each dict: ts, symbol, long_liq_usd, short_liq_usd."""
    await db.executemany(
        """
        INSERT OR REPLACE INTO liquidations_1h (ts, symbol, long_liq_usd, short_liq_usd)
        VALUES (:ts, :symbol, :long_liq_usd, :short_liq_usd)
        """,
        rows,
    )
    await db.commit()


async def prune_old_rows(db: aiosqlite.Connection) -> None:
    """Delete rows older than 30 days."""
    await db.execute("DELETE FROM candles_5m WHERE ts < strftime('%s','now') - 2592000")
    await db.execute("DELETE FROM liquidations_1h WHERE ts < strftime('%s','now') - 2592000")
    await db.commit()


async def get_candles(
    db: aiosqlite.Connection, symbol: str, limit: int = 8640
) -> list[dict]:
    async with db.execute(
        """
        SELECT ts, symbol, open, high, low, close, volume
        FROM candles_5m
        WHERE symbol = ?
        ORDER BY ts ASC
        LIMIT ?
        """,
        (symbol, limit),
    ) as cur:
        rows = await cur.fetchall()
    keys = ["ts", "symbol", "open", "high", "low", "close", "volume"]
    return [dict(zip(keys, r)) for r in rows]


async def get_candles_desc(
    db: aiosqlite.Connection, symbol: str, limit: int = 576
) -> list[dict]:
    """Return most recent `limit` candles, newest first (for API responses)."""
    async with db.execute(
        """
        SELECT ts, symbol, open, high, low, close, volume
        FROM candles_5m
        WHERE symbol = ?
        ORDER BY ts DESC
        LIMIT ?
        """,
        (symbol, limit),
    ) as cur:
        rows = await cur.fetchall()
    keys = ["ts", "symbol", "open", "high", "low", "close", "volume"]
    return [dict(zip(keys, r)) for r in rows]


async def get_liquidations(
    db: aiosqlite.Connection, symbol: str, limit: int = 720
) -> list[dict]:
    async with db.execute(
        """
        SELECT ts, symbol, long_liq_usd, short_liq_usd
        FROM liquidations_1h
        WHERE symbol = ?
        ORDER BY ts ASC
        LIMIT ?
        """,
        (symbol, limit),
    ) as cur:
        rows = await cur.fetchall()
    keys = ["ts", "symbol", "long_liq_usd", "short_liq_usd"]
    return [dict(zip(keys, r)) for r in rows]


async def open_trade(
    db: aiosqlite.Connection,
    signal: str,
    direction: str,
    entry_ts: int,
    entry_price: float,
    hold_bars: int,
) -> int:
    async with db.execute(
        """
        INSERT INTO paper_trades (signal, direction, entry_ts, entry_price, hold_bars, status)
        VALUES (?, ?, ?, ?, ?, 'OPEN')
        """,
        (signal, direction, entry_ts, entry_price, hold_bars),
    ) as cur:
        trade_id = cur.lastrowid
    await db.execute(
        """
        UPDATE signal_state
        SET last_fire_ts = ?, last_fire_dir = ?, open_trade_id = ?
        WHERE signal = ?
        """,
        (entry_ts, direction, trade_id, signal),
    )
    await db.commit()
    return trade_id


async def close_trade(
    db: aiosqlite.Connection,
    trade_id: int,
    exit_ts: int,
    exit_price: float,
) -> dict:
    async with db.execute(
        "SELECT entry_price, direction, signal FROM paper_trades WHERE id = ?",
        (trade_id,),
    ) as cur:
        row = await cur.fetchone()
    entry_price, direction, signal = row
    direction_sign = 1 if direction == "LONG" else -1
    gross_bps = (exit_price / entry_price - 1) * 10000 * direction_sign

    await db.execute(
        """
        UPDATE paper_trades
        SET exit_ts = ?, exit_price = ?, gross_bps = ?, status = 'CLOSED'
        WHERE id = ?
        """,
        (exit_ts, exit_price, gross_bps, trade_id),
    )
    await db.execute(
        "UPDATE signal_state SET open_trade_id = NULL WHERE signal = ?",
        (signal,),
    )
    await db.commit()
    return {
        "trade_id": trade_id,
        "signal": signal,
        "direction": direction,
        "entry_price": entry_price,
        "exit_price": exit_price,
        "gross_bps": gross_bps,
        "exit_ts": exit_ts,
    }


async def get_open_trades(db: aiosqlite.Connection) -> list[dict]:
    async with db.execute(
        """
        SELECT id, signal, direction, entry_ts, entry_price, hold_bars
        FROM paper_trades
        WHERE status = 'OPEN'
        ORDER BY entry_ts ASC
        """
    ) as cur:
        rows = await cur.fetchall()
    keys = ["id", "signal", "direction", "entry_ts", "entry_price", "hold_bars"]
    return [dict(zip(keys, r)) for r in rows]


async def get_trades(
    db: aiosqlite.Connection, status: str = "all", limit: int = 100
) -> list[dict]:
    if status == "all":
        where = ""
        params: tuple = (limit,)
    else:
        where = "WHERE status = ?"
        params = (status.upper(), limit)
    async with db.execute(
        f"""
        SELECT id, signal, direction, entry_ts, entry_price,
               exit_ts, exit_price, hold_bars, gross_bps, status
        FROM paper_trades
        {where}
        ORDER BY entry_ts DESC
        LIMIT ?
        """,
        params,
    ) as cur:
        rows = await cur.fetchall()
    keys = [
        "id", "signal", "direction", "entry_ts", "entry_price",
        "exit_ts", "exit_price", "hold_bars", "gross_bps", "status",
    ]
    return [dict(zip(keys, r)) for r in rows]


async def get_signal_states(db: aiosqlite.Connection) -> dict:
    async with db.execute(
        "SELECT signal, last_fire_ts, last_fire_dir, open_trade_id FROM signal_state"
    ) as cur:
        rows = await cur.fetchall()
    return {
        r[0]: {
            "last_fire_ts": r[1],
            "last_fire_dir": r[2],
            "open_trade_id": r[3],
        }
        for r in rows
    }
