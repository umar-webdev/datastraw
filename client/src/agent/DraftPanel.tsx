import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '../api/client'
import type { Draft, Sender } from '../api/types'
import { conversationKey, INBOX_KEY } from './queryKeys'

type Props = { conversationId: string; draft: Draft | null; lastSender: Sender | null }

/**
 * The AI's suggestion in an editable box, with Approve and Regenerate.
 *
 * The box only fills itself while the agent hasn't typed: a draft that finishes, or a newer one after another
 * customer message, never overwrites edits in progress. The agent can reply at any time, even while the AI is
 * still writing or after it failed.
 */
export function DraftPanel({ conversationId, draft, lastSender }: Props) {
  const queryClient = useQueryClient()
  const [text, setText] = useState('')
  const [edited, setEdited] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const loaded = useRef<{ id: string; text: string | null } | null>(null)

  useEffect(() => {
    if (!draft) return
    const previous = loaded.current
    const isNewDraft = previous !== null && previous.id !== draft.id
    if (previous?.id === draft.id && previous.text === draft.text) return
    loaded.current = { id: draft.id, text: draft.text }

    if (!edited) {
      setText(draft.text ?? '')
      if (isNewDraft) setNotice('The customer sent another message, so the suggestion was updated.')
    } else if (isNewDraft || draft.text) {
      setNotice('A new suggestion is ready. Your edits are kept.')
    }
  }, [draft, edited])

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: conversationKey(conversationId) })
    queryClient.invalidateQueries({ queryKey: INBOX_KEY })
  }

  const approve = useMutation({
    mutationFn: (args: { draftId: string; text: string }) =>
      api(`/api/agent/drafts/${args.draftId}/approve`, { method: 'POST', body: { text: args.text } }),
    onSuccess: () => {
      setText('')
      setEdited(false)
      setNotice(null)
      loaded.current = null
      refresh()
    },
    onError: (err) => {
      if (err instanceof ApiError && err.status === 409) refresh() // show the newer message and draft
    },
  })

  const regenerate = useMutation({
    mutationFn: (draftId: string) => api(`/api/agent/drafts/${draftId}/regenerate`, { method: 'POST' }),
    onSuccess: () => {
      setEdited(false)
      setNotice(null)
      refresh()
    },
  })

  if (!draft) {
    return (
      <div className="draft draft-idle muted small">
        {lastSender === 'agent'
          ? 'Replied. A new suggestion will appear here when the customer writes again.'
          : 'No suggestion for this conversation.'}
      </div>
    )
  }

  const useSuggestion = () => {
    setText(draft.text ?? '')
    setEdited(false)
    setNotice(null)
  }

  const send = () => {
    if (text.trim() && !approve.isPending) approve.mutate({ draftId: draft.id, text: text.trim() })
  }

  // Ctrl/Cmd+Enter approves.
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      send()
    }
  }

  return (
    <div className="draft">
      <div className="draft-head">
        <strong>Suggested reply</strong>
        {draft.status === 'pending' && <span className="status status-neutral">AI is writing…</span>}
        {draft.status === 'ready' && <span className="status status-ok">AI draft</span>}
        {draft.status === 'failed' && <span className="status status-bad">AI draft failed</span>}
      </div>

      {draft.needsAttention && draft.status === 'ready' && (
        <p className="callout callout-warn">
          <strong>Check before sending:</strong> {draft.reason ?? 'the AI flagged this conversation.'}
        </p>
      )}
      {draft.status === 'failed' && (
        <div className="callout callout-bad">
          The AI couldn't write a suggestion
          {draft.attempts < 3 ? ' and will try again shortly' : ''}. You can write the reply yourself, or click
          Regenerate.
          {draft.lastError && (
            <details>
              <summary>Error details</summary>
              <code>{draft.lastError}</code>
            </details>
          )}
        </div>
      )}
      {notice && (
        <p className="callout callout-info">
          {notice}{' '}
          {edited && draft.text && (
            <button type="button" className="link-button" onClick={useSuggestion}>
              Use the new suggestion
            </button>
          )}
        </p>
      )}

      <textarea
        className="draft-editor"
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          setEdited(true)
        }}
        onKeyDown={onKeyDown}
        placeholder={draft.status === 'pending' ? 'The AI is writing a suggestion… you can also type your own reply.' : 'Write a reply…'}
        rows={5}
        maxLength={4000}
        aria-label="Reply to send"
      />

      {approve.isError && <p className="error small">{approve.error.message}</p>}
      {regenerate.isError && <p className="error small">{regenerate.error.message}</p>}

      <div className="draft-actions">
        <span className="muted small">Nothing is sent until you approve. Ctrl+Enter to approve.</span>
        <button
          type="button"
          className="button"
          onClick={() => regenerate.mutate(draft.id)}
          disabled={draft.status === 'pending' || regenerate.isPending}
        >
          Regenerate
        </button>
        <button type="button" className="button button-primary" onClick={send} disabled={!text.trim() || approve.isPending}>
          {approve.isPending ? 'Approving…' : 'Approve & send'}
        </button>
      </div>
    </div>
  )
}
