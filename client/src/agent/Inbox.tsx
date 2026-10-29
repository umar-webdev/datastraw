import { NavLink } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'
import type { ConversationSummary } from '../api/types'
import { relativeTime } from '../lib/time'
import { INBOX_KEY } from './queryKeys'

/** What the agent should know at a glance, most urgent first. */
function badgeFor(c: ConversationSummary): { label: string; tone: string } | null {
  if (c.draftStatus && c.needsAttention) return { label: 'Needs attention', tone: 'warn' }
  if (c.draftStatus === 'ready') return { label: 'Draft ready', tone: 'ok' }
  if (c.draftStatus === 'pending') return { label: 'Drafting…', tone: 'neutral' }
  if (c.draftStatus === 'failed') return { label: 'Draft failed', tone: 'bad' }
  if (c.lastSender === 'agent') return { label: 'Replied', tone: 'neutral' }
  return null
}

export function Inbox() {
  const { data, isPending, isError } = useQuery({
    queryKey: INBOX_KEY,
    queryFn: () => api<{ conversations: ConversationSummary[] }>('/api/agent/conversations'),
    refetchInterval: 5000,
  })

  return (
    <aside className="panel inbox">
      <h2>Conversations</h2>
      {isError && <p className="error small">Couldn't refresh the list. Retrying…</p>}
      {isPending && <p className="muted">Loading…</p>}
      {data?.conversations.length === 0 && (
        <p className="muted">No conversations yet. Send a message from the Customer view or the webhook.</p>
      )}
      <ul className="inbox-list">
        {data?.conversations.map((c) => {
          const badge = badgeFor(c)
          return (
            <li key={c.id}>
              <NavLink to={`/agent/conversations/${c.id}`} className="inbox-item">
                <div className="inbox-row">
                  <strong>{c.customerName}</strong>
                  <span className="muted small">{relativeTime(c.lastMessageAt)}</span>
                </div>
                <p className="inbox-preview">
                  {c.lastSender === 'agent' && <span className="muted">You: </span>}
                  {c.preview}
                </p>
                {badge && <span className={`status status-${badge.tone}`}>{badge.label}</span>}
              </NavLink>
            </li>
          )
        })}
      </ul>
    </aside>
  )
}
