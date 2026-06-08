import type { ReactNode } from 'react'

type Props = { left: ReactNode; middle: ReactNode; right: ReactNode }

export function ThreeColumnLayout({ left, middle, right }: Props) {
  return (
    <div className="flex-1 min-h-0 grid gap-2 p-2 grid-cols-1 lg:grid-cols-[minmax(260px,1fr)_minmax(260px,1fr)_minmax(320px,1.2fr)]">
      <section className="min-h-[40vh] lg:min-h-0">{left}</section>
      <section className="min-h-[40vh] lg:min-h-0">{middle}</section>
      <section className="min-h-[40vh] lg:min-h-0">{right}</section>
    </div>
  )
}
