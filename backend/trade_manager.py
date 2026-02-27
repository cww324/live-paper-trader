"""
Trade lifecycle management — open, hold-check, close paper trades.
"""
import logging
from typing import Callable, Awaitable

import aiosqlite

from backend import db
from backend.signals import SignalFire

logger = logging.getLogger(__name__)


async def process_signals(
    conn: aiosqlite.Connection,
    fires: list[SignalFire],
    current_ts: int,
    current_price: float,
    on_trade_open: Callable[[dict], Awaitable[None]],
) -> None:
    """
    Open a paper trade for each fired signal (if no trade is already open for that signal).
    Calls on_trade_open(event_dict) to push WS events.
    """
    signal_states = await db.get_signal_states(conn)

    for fire in fires:
        state = signal_states[fire.signal]
        if state["open_trade_id"] is not None:
            logger.debug("Signal %s already has open trade — skipping", fire.signal)
            continue

        trade_id = await db.open_trade(
            conn,
            signal=fire.signal,
            direction=fire.direction,
            entry_ts=current_ts,
            entry_price=current_price,
            hold_bars=fire.hold_bars,
        )
        logger.info(
            "Opened trade #%d: %s %s @ %.2f (hold %d bars)",
            trade_id, fire.signal, fire.direction, current_price, fire.hold_bars,
        )
        await on_trade_open(
            {
                "type": "signal_fire",
                "signal": fire.signal,
                "direction": fire.direction,
                "entry_price": current_price,
                "ts": current_ts,
            }
        )


async def check_exits(
    conn: aiosqlite.Connection,
    current_ts: int,
    current_price: float,
    on_trade_close: Callable[[dict], Awaitable[None]],
) -> None:
    """
    Check all open trades for expiry. Close any that have held for >= hold_bars * 300 seconds.
    Calls on_trade_close(event_dict) for each closed trade.
    """
    open_trades = await db.get_open_trades(conn)
    for trade in open_trades:
        hold_seconds = trade["hold_bars"] * 300
        if (current_ts - trade["entry_ts"]) >= hold_seconds:
            result = await db.close_trade(
                conn,
                trade_id=trade["id"],
                exit_ts=current_ts,
                exit_price=current_price,
            )
            logger.info(
                "Closed trade #%d: %s %s gross=%.1f bps",
                trade["id"], trade["signal"], trade["direction"], result["gross_bps"],
            )
            await on_trade_close(
                {
                    "type": "trade_close",
                    "signal": result["signal"],
                    "direction": result["direction"],
                    "entry_price": result["entry_price"],
                    "exit_price": result["exit_price"],
                    "gross_bps": result["gross_bps"],
                    "ts": current_ts,
                }
            )
