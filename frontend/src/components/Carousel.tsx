import { useState } from 'react'

type Slide = {
  label: string
  component: React.ReactNode
}

type Props = {
  slides: Slide[]
}

export default function Carousel({ slides }: Props) {
  const [index, setIndex] = useState(0)

  const prev = () => setIndex((i) => (i - 1 + slides.length) % slides.length)
  const next = () => setIndex((i) => (i + 1) % slides.length)

  return (
    <div className="rounded-xl bg-slate-900 p-4">
      <div className="relative">
        {/* Arrows */}
        <button
          onClick={prev}
          className="absolute left-0 top-1/2 z-10 -translate-y-1/2 rounded-full bg-slate-700 p-1.5 text-slate-300 hover:bg-slate-600 hover:text-white transition-colors"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>

        <button
          onClick={next}
          className="absolute right-0 top-1/2 z-10 -translate-y-1/2 rounded-full bg-slate-700 p-1.5 text-slate-300 hover:bg-slate-600 hover:text-white transition-colors"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>

        {/* Slide label */}
        <div className="mb-2 text-center text-sm font-semibold text-slate-400">
          {slides[index].label}
        </div>

        {/* Slide content */}
        <div className="px-8">{slides[index].component}</div>
      </div>

      {/* Dot indicators */}
      <div className="mt-3 flex justify-center gap-2">
        {slides.map((_, i) => (
          <button
            key={i}
            onClick={() => setIndex(i)}
            className={`h-2 w-2 rounded-full transition-colors ${
              i === index ? 'bg-blue-500' : 'bg-slate-600 hover:bg-slate-500'
            }`}
          />
        ))}
      </div>
    </div>
  )
}
