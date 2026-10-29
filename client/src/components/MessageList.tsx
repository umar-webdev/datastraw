import { useEffect, useRef } from 'react'
import type { Sender } from '../api/types'
import { clockTime } from '../lib/time'

type Message = { id: string; sender: Sender; text: string; sentAt: string; agentName?: string | null }

// Customers see "You" and the brand; agents see "Customer" and which agent sent each reply.
function senderLabel(m: Message, mine: Sender): string {
  if (m.sender === 'customer') return mine === 'customer' ? 'You' : 'Customer'
  return m.agentName ?? 'Verdant & Co'
}

/**
 * A chat thread. `mine` is the side shown on the right: the customer in the Customer view, the agent in the
 * Agent view. Scrolls to the newest message when one arrives (inside the thread, not the whole page).
 */
export function MessageList({ messages, mine, empty }: { messages: Message[]; mine: Sender; empty: string }) {
  const threadRef = useRef<HTMLDivElement>(null)
  const lastId = messages.at(-1)?.id

  useEffect(() => {
    const thread = threadRef.current
    if (thread) thread.scrollTop = thread.scrollHeight
  }, [lastId])

  return (
    <div className="thread" ref={threadRef} role="log" aria-live="polite">
      {messages.length === 0 && <p className="muted thread-empty">{empty}</p>}
      {messages.map((m) => (
        <div key={m.id} className={`bubble ${m.sender === mine ? 'bubble-mine' : 'bubble-theirs'}`}>
          <p>{m.text}</p>
          <span className="bubble-meta">
            {senderLabel(m, mine)} · {clockTime(m.sentAt)}
          </span>
        </div>
      ))}
    </div>
  )
}
