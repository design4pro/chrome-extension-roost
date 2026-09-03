/**
 * The handful of Material Symbols the dashboard uses, inline.
 *
 * An extension page cannot reach `chrome://resources`, and a webfont for six
 * glyphs would be a network request for something that ships as text.
 */
const PATHS = {
  close:
    'M6.4 19 5 17.6l5.6-5.6L5 6.4 6.4 5l5.6 5.6L17.6 5 19 6.4 13.4 12l5.6 5.6-1.4 1.4-5.6-5.6Z',
  search:
    'M19.6 21 13.3 14.7q-.75.6-1.72.95-.97.35-2.08.35-2.72 0-4.61-1.89Q3 12.22 3 9.5q0-2.72 1.89-4.61Q6.78 3 9.5 3q2.72 0 4.61 1.89Q16 6.78 16 9.5q0 1.11-.35 2.08-.35.97-.95 1.72l6.3 6.3ZM9.5 14q1.88 0 3.19-1.31Q14 11.38 14 9.5q0-1.88-1.31-3.19Q11.38 5 9.5 5 7.62 5 6.31 6.31 5 7.62 5 9.5q0 1.88 1.31 3.19Q7.62 14 9.5 14Z',
  chevron: 'M9.4 18 8 16.6 12.6 12 8 7.4 9.4 6l6 6Z',
  window:
    'M3 21q-.83 0-1.41-.59Q1 19.83 1 19V5q0-.82.59-1.41Q2.17 3 3 3h18q.83 0 1.41.59Q23 4.18 23 5v14q0 .83-.59 1.41Q21.83 21 21 21Zm0-2h18V8H3Z',
  device:
    'M2 20v-2h2V6q0-.82.59-1.41Q5.18 4 6 4h15v2H6v12h6v2Zm14 0q-.42 0-.71-.29Q15 19.42 15 19v-9q0-.42.29-.71Q15.58 9 16 9h5q.42 0 .71.29.29.29.29.71v9q0 .42-.29.71-.29.29-.71.29Z',
} as const

export type IconName = keyof typeof PATHS

export function Icon({
  name,
  className,
}: {
  name: IconName
  className?: string
}) {
  return (
    <svg
      className={className ?? 'size-5 shrink-0 fill-current'}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  )
}
