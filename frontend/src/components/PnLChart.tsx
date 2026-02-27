import { useEffect, useRef } from 'react'
import { createChart, IChartApi, ISeriesApi, Time } from 'lightweight-charts'
import type { Trade } from '../types'

type Props = {
  trades: Trade[]
  initialEquity: number
  riskPct: number
}

export default function PnLChart({ trades, initialEquity, riskPct }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const bpsSeriesRef = useRef<ISeriesApi<'Line'> | null>(null)
  const dollarSeriesRef = useRef<ISeriesApi<'Line'> | null>(null)

  useEffect(() => {
    if (!containerRef.current) return

    const chart = createChart(containerRef.current, {
      layout: { background: { color: '#0f172a' }, textColor: '#94a3b8' },
      grid: { vertLines: { color: '#1e293b' }, horzLines: { color: '#1e293b' } },
      timeScale: { timeVisible: true, secondsVisible: false },
      leftPriceScale: { visible: true, borderColor: '#3b82f6' },
      rightPriceScale: { visible: true, borderColor: '#22c55e' },
      width: containerRef.current.clientWidth,
      height: 400,
    })
    chartRef.current = chart

    const bpsSeries = chart.addLineSeries({
      priceScaleId: 'left',
      color: '#3b82f6',
      lineWidth: 2,
      title: 'bps',
    })
    bpsSeriesRef.current = bpsSeries

    const dollarSeries = chart.addLineSeries({
      priceScaleId: 'right',
      color: '#22c55e',
      lineWidth: 2,
      title: '$',
    })
    dollarSeriesRef.current = dollarSeries

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

  // Update series when trades change
  useEffect(() => {
    if (!bpsSeriesRef.current || !dollarSeriesRef.current) return

    const closed = trades
      .filter((t) => t.status === 'CLOSED' && t.exit_ts !== null && t.gross_bps !== null)
      .sort((a, b) => a.exit_ts! - b.exit_ts!)

    if (closed.length === 0) return

    const positionSize = initialEquity * riskPct

    let cumBps = 0
    let cumDollar = 0
    const bpsData: { time: Time; value: number }[] = []
    const dollarData: { time: Time; value: number }[] = []

    for (const t of closed) {
      cumBps += t.gross_bps!
      cumDollar += positionSize * (t.gross_bps! / 10000)
      bpsData.push({ time: t.exit_ts! as Time, value: cumBps })
      dollarData.push({ time: t.exit_ts! as Time, value: cumDollar })
    }

    bpsSeriesRef.current.setData(bpsData)
    dollarSeriesRef.current.setData(dollarData)
    chartRef.current?.timeScale().fitContent()
  }, [trades, initialEquity, riskPct])

  const closed = trades.filter((t) => t.status === 'CLOSED')

  if (closed.length === 0) {
    return (
      <div className="flex h-[400px] items-center justify-center text-slate-500">
        No closed trades yet — check back after the first signals fire.
      </div>
    )
  }

  return <div ref={containerRef} />
}
