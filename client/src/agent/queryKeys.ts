// Every agent query key starts with 'agent', so a 401 on any of them can sign the agent out (see main.tsx).
export const INBOX_KEY = ['agent', 'conversations']
export const conversationKey = (id: string) => ['agent', 'conversation', id]
