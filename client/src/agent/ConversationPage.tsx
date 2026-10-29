import { useParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'
import type { ConversationDetail } from '../api/types'
import { MessageList } from '../components/MessageList'
import { DraftPanel } from './DraftPanel'
import { conversationKey } from './queryKeys'

export function ConversationPage() {
  const { id = '' } = useParams()
  const { data, isPending, isError, error } = useQuery({
    queryKey: conversationKey(id),
    queryFn: () => api<ConversationDetail>(`/api/agent/conversations/${id}`),
    refetchInterval: 4000, // new customer messages and finished drafts appear on their own
  })

  if (isPending) return <section className="panel chat-panel empty-state muted">Loading…</section>
  if (isError && !data) return <section className="panel chat-panel empty-state error">{error.message}</section>

  const { conversation, messages, draft } = data
  return (
    <section className="panel chat-panel">
      <header className="chat-header">
        <div>
          <h2>{conversation.customerName}</h2>
          <span className="muted small">
            {conversation.customerPhone} · {conversation.customerId}
          </span>
        </div>
      </header>
      <MessageList messages={messages} mine="agent" empty="No messages." />
      <DraftPanel key={conversation.id} conversationId={conversation.id} draft={draft} lastSender={messages.at(-1)?.sender ?? null} />
    </section>
  )
}
