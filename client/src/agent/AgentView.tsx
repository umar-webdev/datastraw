import { Route, Routes } from 'react-router'
import { ConversationPage } from './ConversationPage'
import { Inbox } from './Inbox'
import { LoginPage } from './LoginPage'
import { useSession } from './session'

/** Everything under /agent: the sign-in screen until there's a session, then inbox + conversation side by side. */
export function AgentView() {
  const session = useSession()

  if (session.isPending) return <p className="muted">Checking your session…</p>
  if (session.isError) return <p className="error">Couldn't reach the server: {session.error.message}</p>
  if (!session.data) return <LoginPage />

  return (
    <div className="agent-layout">
      <Inbox />
      <Routes>
        <Route
          index
          element={
            <section className="panel chat-panel empty-state muted">Choose a conversation to read it and review the AI's draft.</section>
          }
        />
        <Route path="conversations/:id" element={<ConversationPage />} />
      </Routes>
    </div>
  )
}
