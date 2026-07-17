'use client'
import { useState, useRef, useEffect } from 'react'
import { Send, Loader2, Bot, User, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'
import { PageHeader } from '@/components/PageHeader'
import { BASE } from '@/lib/api'
import { getToken } from '@/lib/auth'


interface Message {
  role: 'user' | 'assistant'
  content: string
}

const SUGGESTIONS = [
  "Am I on track with my budget this month?",
  "How should I prioritize paying off my debt?",
  "How much should I have in my emergency fund?",
  "Where am I overspending?",
  "What's the debt snowball method?",
  "How can I save more money each month?",
]

function MessageBubble({ msg }: { msg: Message }) {
  const isUser = msg.role === 'user'
  return (
    <div className={cn('flex gap-3 items-start', isUser && 'flex-row-reverse')}>
      <div className={cn(
        'w-8 h-8 rounded-full flex items-center justify-center shrink-0',
        isUser ? 'bg-blue-600' : 'bg-gradient-to-br from-violet-500 to-blue-600'
      )}>
        {isUser ? <User size={14} className="text-white" /> : <Bot size={14} className="text-white" />}
      </div>
      <div className={cn(
        'max-w-[80%] rounded-2xl px-4 py-3 text-sm leading-relaxed',
        isUser
          ? 'bg-blue-600 text-white rounded-tr-sm'
          : 'bg-white text-gray-800 shadow-sm rounded-tl-sm'
      )}>
        {msg.content.split('\n').map((line, i) => {
          if (line.startsWith('**') && line.endsWith('**')) {
            return <p key={i} className="font-bold mt-2 first:mt-0">{line.slice(2, -2)}</p>
          }
          if (line.startsWith('• ') || line.startsWith('- ')) {
            return <p key={i} className="flex gap-1.5 mt-1"><span>•</span><span>{line.slice(2)}</span></p>
          }
          if (line.trim() === '') return <div key={i} className="h-1" />
          return <p key={i} className="mt-1 first:mt-0">{line}</p>
        })}
      </div>
    </div>
  )
}

export default function CoachPage() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const sendMessage = async (text?: string) => {
    const msg = (text ?? input).trim()
    if (!msg || streaming) return
    setInput('')

    const userMsg: Message = { role: 'user', content: msg }
    setMessages(prev => [...prev, userMsg])
    setStreaming(true)

    try {
      const token = getToken()
      const res = await fetch(`${BASE}/api/v1/coach/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ message: msg }),
      })
      if (!res.ok) throw new Error('API error')
      const data = await res.json()
      setMessages(prev => [...prev, { role: 'assistant', content: data.response }])
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Sorry, something went wrong. Please try again.' }])
    } finally {
      setStreaming(false)
      inputRef.current?.focus()
    }
  }

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() }
  }

  return (
    <div className="flex flex-col h-screen">
      <PageHeader title="AI Coach" subtitle="Personalized financial guidance" />

      {/* Live region for screen readers */}
      <div aria-live="polite" aria-atomic="false" className="sr-only">
        {streaming ? 'Coach is typing…' : messages.length > 0 ? messages[messages.length - 1]?.content : ''}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 pb-32" role="log" aria-label="Conversation" aria-live="polite">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center gap-4 pt-8">
            <div className="w-16 h-16 bg-gradient-to-br from-violet-500 to-blue-600 rounded-2xl flex items-center justify-center shadow-lg">
              <Sparkles size={28} className="text-white" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-gray-900 mb-1">Your Financial Coach</h2>
              <p className="text-sm text-gray-500 max-w-xs">Ask me anything about your budget, debt, or savings. I can see your real numbers.</p>
            </div>
            <div className="grid grid-cols-1 gap-2 w-full max-w-sm mt-2">
              {SUGGESTIONS.map(s => (
                <button key={s} onClick={() => sendMessage(s)}
                  className="text-left text-sm bg-white rounded-xl px-4 py-3 shadow-sm text-gray-700 hover:bg-blue-50 hover:text-blue-700 transition-colors border border-gray-100">
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <MessageBubble key={i} msg={msg} />
        ))}

        {streaming && messages[messages.length - 1]?.content === '' && (
          <div className="flex gap-3 items-start">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-violet-500 to-blue-600 flex items-center justify-center shrink-0">
              <Bot size={14} className="text-white" />
            </div>
            <div className="bg-white rounded-2xl rounded-tl-sm px-4 py-3 shadow-sm">
              <Loader2 size={16} className="animate-spin text-gray-400" />
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input bar */}
      <div className="fixed bottom-16 left-0 right-0 bg-white border-t border-gray-100 px-4 py-3 shadow-lg">
        <div className="max-w-2xl mx-auto flex gap-2" role="form" aria-label="Chat with your financial coach">
          <label htmlFor="coach-input" className="sr-only">Message your coach</label>
          <input
            id="coach-input"
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Ask your coach anything…"
            disabled={streaming}
            aria-disabled={streaming}
            className="flex-1 px-4 py-2.5 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
          />
          <button
            onClick={() => sendMessage()}
            disabled={!input.trim() || streaming}
            aria-label={streaming ? 'Sending…' : 'Send message'}
            className="w-10 h-10 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 rounded-xl flex items-center justify-center transition-colors shrink-0"
          >
            {streaming ? <Loader2 size={16} className="animate-spin text-white" aria-hidden="true" /> : <Send size={16} className="text-white" aria-hidden="true" />}
          </button>
        </div>
      </div>
    </div>
  )
}
