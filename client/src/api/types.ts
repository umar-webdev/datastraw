// Shapes returned by the server's API (server/src/routes).

export type Sender = 'customer' | 'agent'
export type DraftStatus = 'pending' | 'ready' | 'failed'

export type TestCustomer = { id: string; name: string; phone: string }

export type CustomerMessage = { id: string; sender: Sender; text: string; sentAt: string }

export type CustomerConversation = { conversationId: string | null; messages: CustomerMessage[] }

export type Agent = { id: string; email: string; name: string }

export type ConversationSummary = {
  id: string
  customerName: string
  customerPhone: string
  preview: string
  lastMessageAt: string
  lastSender: Sender | null
  draftStatus: DraftStatus | null
  needsAttention: boolean
}

export type AgentMessage = CustomerMessage & { agentName: string | null }

export type Draft = {
  id: string
  messageId: string
  status: DraftStatus
  text: string | null
  needsAttention: boolean
  reason: string | null
  attempts: number
  lastError: string | null
  model: string | null
  updatedAt: string
}

export type ConversationDetail = {
  conversation: { id: string; status: string; customerName: string; customerPhone: string; customerId: string }
  messages: AgentMessage[]
  draft: Draft | null
}
