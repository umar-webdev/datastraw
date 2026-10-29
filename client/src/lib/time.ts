const timeFormat = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' })
const dateFormat = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' })

/** "just now", "5 min ago", "14:05" today, else "3 Nov". */
export function relativeTime(iso: string, now = Date.now()): string {
  const date = new Date(iso)
  const seconds = Math.round((now - date.getTime()) / 1000)
  if (seconds < 45) return 'just now'
  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`
  if (new Date(now).toDateString() === date.toDateString()) return timeFormat.format(date)
  return dateFormat.format(date)
}

export function clockTime(iso: string): string {
  return timeFormat.format(new Date(iso))
}
