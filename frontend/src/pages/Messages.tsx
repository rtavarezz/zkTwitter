import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import Navbar from '../components/Navbar'
import { apiGet, apiPost } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import './Messages.css'

interface Participant {
  id: string
  handle: string
  avatarUrl: string | null
  humanStatus: string
}

interface ThreadSummary {
  partner: Participant & { disclosed: Record<string, unknown> }
  lastMessage: {
    body: string
    createdAt: string
    direction: 'outbound' | 'inbound'
  }
}

interface MessageItem {
  id: string
  body: string
  createdAt: string
  direction: 'outbound' | 'inbound'
}

interface ConversationPayload {
  partner: Participant
  messages: MessageItem[]
}

export default function Messages() {
  const { user } = useAuth()
  const [threads, setThreads] = useState<ThreadSummary[]>([])
  const [activeHandle, setActiveHandle] = useState<string | null>(null)
  const [conversation, setConversation] = useState<ConversationPayload | null>(null)
  const [draft, setDraft] = useState('')
  const [loadingThreads, setLoadingThreads] = useState(true)
  const [loadingConversation, setLoadingConversation] = useState(false)
  const [sending, setSending] = useState(false)
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()

  const fetchThreads = useCallback(async (opts?: { silent?: boolean }) => {
    if (!user) return
    if (!opts?.silent) {
      setLoadingThreads(true)
    }
    try {
      const data = await apiGet<{ threads: ThreadSummary[] }>('/messages/threads')
      setThreads(data.threads)
      if (data.threads.length > 0) {
        setActiveHandle((prev) => prev ?? data.threads[0].partner.handle)
      }
    } catch (err) {
      console.error('Failed to load threads', err)
    } finally {
      if (!opts?.silent) {
        setLoadingThreads(false)
      }
    }
  }, [user])

  useEffect(() => {
    void fetchThreads()
  }, [fetchThreads])

  useEffect(() => {
    const requestedHandle = searchParams.get('with')
    if (requestedHandle) {
      setActiveHandle(requestedHandle)
    }
  }, [searchParams])

  useEffect(() => {
    if (!activeHandle || !user) {
      setConversation(null)
      return
    }

    setLoadingConversation(true)
    void (async () => {
      try {
        const payload = await apiGet<ConversationPayload>(`/messages/with/${activeHandle}`)
        setConversation(payload)
      } catch (err) {
        console.error('Failed to load conversation', err)
      } finally {
        setLoadingConversation(false)
      }
    })()
  }, [activeHandle, user])

  const orderedThreads = useMemo(() => {
    return threads.slice().sort((a, b) =>
      new Date(b.lastMessage.createdAt).getTime() - new Date(a.lastMessage.createdAt).getTime()
    )
  }, [threads])

  const handleSend = async () => {
    if (!draft.trim() || !conversation || sending) {
      return
    }

    setSending(true)
    try {
      const payload = await apiPost<{ message: MessageItem }>(`/messages/with/${conversation.partner.handle}`, {
        body: draft.trim(),
      })
      setConversation((prev) =>
        prev
          ? { ...prev, messages: [...prev.messages, payload.message] }
          : prev
      )
      await fetchThreads({ silent: true })
      setDraft('')
    } catch (err) {
      console.error('Failed to send message', err)
    } finally {
      setSending(false)
    }
  }

  if (!user) {
    return (
      <div className="messages-app">
        <Navbar />
        <main className="messages-layout">
          <section className="messages-empty">
            <h2>Log in to view your messages</h2>
            <button className="cta primary" onClick={() => navigate('/login')}>
              Log in
            </button>
          </section>
        </main>
      </div>
    )
  }

  return (
    <div className="messages-app">
      <Navbar />
      <main className="messages-layout">
        <aside className="thread-column" aria-label="Conversations">
          <header className="messages-header">
            <h1>Messages</h1>
          </header>
          {loadingThreads ? (
            <div className="placeholder">Loading…</div>
          ) : orderedThreads.length === 0 ? (
            <div className="placeholder">No conversations yet. Start one from a profile.</div>
          ) : (
            <ul className="thread-list">
              {orderedThreads.map((thread) => {
                const isActive = thread.partner.handle === activeHandle
                return (
                  <li key={thread.partner.id}>
                    <button
                      className={`thread-item ${isActive ? 'active' : ''}`}
                      onClick={() => setActiveHandle(thread.partner.handle)}
                    >
                      <img
                        src={
                          thread.partner.avatarUrl ||
                          `https://api.dicebear.com/7.x/avataaars/svg?seed=${thread.partner.handle}`
                        }
                        alt={thread.partner.handle}
                      />
                      <div>
                        <strong>@{thread.partner.handle}</strong>
                        <span>{thread.lastMessage.body}</span>
                      </div>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </aside>

        <section className="conversation" aria-live="polite">
          {loadingConversation ? (
            <div className="conversation-placeholder">Loading conversation…</div>
          ) : !conversation ? (
            <div className="conversation-placeholder">Select a conversation to get started.</div>
          ) : (
            <>
              <header className="conversation-header">
                <div>
                  <h2>@{conversation.partner.handle}</h2>
                  <p>{conversation.partner.humanStatus === 'verified' ? 'Verified' : 'Bot account'}</p>
                </div>
              </header>

              <ul className="message-list">
                {conversation.messages.map((message) => (
                  <li
                    key={message.id}
                    className={`message ${message.direction === 'outbound' ? 'outbound' : 'inbound'}`}
                  >
                    <p>{message.body}</p>
                    <time>{new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>
                  </li>
                ))}
              </ul>

              <form
                className="message-composer"
                onSubmit={(event) => {
                  event.preventDefault()
                  void handleSend()
                }}
              >
                <textarea
                  value={draft}
                  maxLength={500}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder={`Message @${conversation.partner.handle}`}
                />
                <div className="composer-actions">
                  <span>{500 - draft.length} characters left</span>
                  <button type="submit" className="cta primary" disabled={!draft.trim() || sending}>
                    {sending ? 'Sending…' : 'Send'}
                  </button>
                </div>
              </form>
            </>
          )}
        </section>
      </main>
    </div>
  )
}
