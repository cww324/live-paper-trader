import { useEffect, useRef } from 'react'
import {
  createChart,
  IChartApi,
  ISeriesApi,
  CandlestickData,
  SeriesMarker,
  Time,
} from 'lightweight-charts'
import type { CandleEvent, SignalFireEvent, TradeCloseEvent } from '../types'

type Props = {
  newCandle: CandleEvent | null
  newSignal: SignalFireEvent | null
  newClose: TradeCloseEvent | null
}

export default function Chart({ newCandle, newSignal, newClose }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const markersRef = useRef<SeriesMarker<Time>[]>([])

  useEffect(() => {
    if (!containerRef.current) return

    const chart = createChart(containerRef.current, {
      layout: { background: { color: '#0f172a' }, textColor: '#94a3b8' },
      grid: { vertLines: { color: '#1e293b' }, horzLines: { color: '#1e293b' } },
      timeScale: { timeVisible: true, secondsVisible: false },
      width: containerRef.current.clientWidth,
      height: 400,
    })
    chartRef.current = chart

    const series = chart.addCandlestickSeries({
      upColor: '#22c55e',
      downColor: '#ef4444',
      borderVisible: false,
      wickUpColor: '#22c55e',
      wickDownColor: '#ef4444',
    })
    seriesRef.current = series

    // Load initial candles
    fetch('/api/candles?symbol=BTC-USD&limit=576')
      .then((r) => r.json())
      .then((rows: CandleEvent[]) => {
        const data: CandlestickData[] = rows.map((c) => ({
          time: c.ts as Time,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
        }))
        series.setData(data)
        chart.timeScale().fitContent()
      })
      .catch(console.error)

    const ro = new ResizeObserver(() => {
      if (containerRef.current) {
        chart.applyOptions({ width: containerRef.current.clientWidth })
      }
    })
    ro.observe(containerRef.current)

    return () => {
      ro.disconnect()
      chart.remove()
    }
  }, [])

  // Update on new candle
  useEffect(() => {
    if (!newCandle || newCandle.symbol !== 'BTC-USD' || !seriesRef.current) return
    seriesRef.current.update({
      time: newCandle.ts as Time,
      open: newCandle.open,
      high: newCandle.high,
      low: newCandle.low,
      close: newCandle.close,
    })
  }, [newCandle])

  // Add entry marker on signal fire
  useEffect(() => {
    if (!newSignal || !seriesRef.current) return
    const marker: SeriesMarker<Time> = {
      time: newSignal.ts as Time,
      position: newSignal.direction === 'LONG' ? 'belowBar' : 'aboveBar',
      color: newSignal.direction === 'LONG' ? '#22c55e' : '#ef4444',
      shape: newSignal.direction === 'LONG' ? 'arrowUp' : 'arrowDown',
      text: newSignal.signal,
    }
    markersRef.current = [...markersRef.current, marker].sort(
      (a, b) => (a.time as number) - (b.time as number)
    )
    seriesRef.current.setMarkers(markersRef.current)
  }, [newSignal])

  // Add close marker on trade close
  useEffect(() => {
    if (!newClose || !seriesRef.current) return
    const marker: SeriesMarker<Time> = {
      time: newClose.ts as Time,
      position: 'inBar',
      color: '#64748b',
      shape: 'circle',
      text: `✕ ${newClose.gross_bps.toFixed(1)}bps`,
    }
    markersRef.current = [...markersRef.current, marker].sort(
      (a, b) => (a.time as number) - (b.time as number)
    )
    seriesRef.current.setMarkers(markersRef.current)
  }, [newClose])

  return <div ref={containerRef} />
}
