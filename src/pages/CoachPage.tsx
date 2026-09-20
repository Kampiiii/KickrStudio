// Coach: Chat mit dem Trainingsagenten (ADK + Gemini auf Cloud Run), der die
// Iceberg-Tabellen in BigQuery per SQL abfragt.
import { useEffect, useRef, useState } from 'react'
import { useApp, setState } from '../state'
import { bridge, type ChartSpec } from '../bridge'
import AgentChart from '../components/AgentChart'

interface Msg {
  role: 'user' | 'agent' | 'error'
  text: string
  tools?: { name: string; args: Record<string, unknown> }[]
  charts?: ChartSpec[]
}

const newId = () => 'chat-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)

// Gespräch bleibt beim Seitenwechsel erhalten
let conversation: { sessionId: string; messages: Msg[] } = { sessionId: newId(), messages: [] }

const SUGGESTIONS = [
  'Wie sieht meine Form (TSB) in den letzten Tagen aus, und was steht diese Woche im Plan?',
  'Vergleiche meine letzten beiden Einheiten. Wo gibt es Unterschiede bei Herzfrequenz und Kadenz?',
  'Zeig mir die Herzfrequenz- und Leistungskurve meiner letzten Einheit als Diagramm.',
  'Wie hat sich mein Gewicht in den letzten 30 Tagen verändert?',
]

export default function CoachPage() {
  const app = useApp()
  const [messages, setMessages] = useState<Msg[]>(conversation.messages)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)
  const configured = !!app.settings?.cloud.agentUrl

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, busy])

  const push = (m: Msg) => {
    conversation.messages = [...conversation.messages, m]
    setMessages(conversation.messages)
  }

  const send = async (text: string) => {
    const question = text.trim()
    if (!question || busy) return
    setInput('')
    push({ role: 'user', text: question })
    setBusy(true)
    const res = await bridge.cloudAsk(question, conversation.sessionId)
    setBusy(false)
    if (res.ok) push({ role: 'agent', text: res.answer || '', tools: res.tools, charts: res.charts })
    else push({ role: 'error', text: res.error || 'Unbekannter Fehler' })
  }

  const reset = () => {
    conversation = { sessionId: newId(), messages: [] }
    setMessages([])
  }

  if (!configured) {
    return (
      <div>
        <div className="page-title">Coach</div>
        <div className="card">
          <h3 style={{ marginBottom: 8 }}>Der Coach ist noch nicht verbunden</h3>
          <p className="hint" style={{ marginBottom: 14 }}>
            Der Coach ist ein KI-Agent (Google ADK + Gemini), der auf Google Cloud läuft und deine Trainingsdaten
            aus BigQuery abfragt. Trage dafür unter Einstellungen → Google Cloud die Agent-URL ein.
          </p>
          <button className="btn primary" onClick={() => setState({ page: 'settings' })}>Zu den Einstellungen</button>
        </div>
      </div>
    )
  }

  return (
    <div className="chat">
      <div className="page-title">
        Coach <span className="sub">Gemini fragt deine Daten in BigQuery ab</span>
        <div style={{ flex: 1 }} />
        <button className="btn small" onClick={reset} disabled={busy}>Neues Gespräch</button>
      </div>

      <div className="chat-log">
        {messages.length === 0 && (
          <div className="card">
            <div className="hint" style={{ marginBottom: 10 }}>Frag zum Beispiel:</div>
            <div className="row wrap">
              {SUGGESTIONS.map(s => <button key={s} className="btn small" onClick={() => send(s)}>{s}</button>)}
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`msg ${m.role}${m.charts?.length ? ' wide' : ''}`}>
            {m.charts?.map((c, k) => <AgentChart key={k} spec={c} />)}
            {m.text && <div className="msg-text">{m.text}</div>}
            {m.tools && m.tools.length > 0 && (
              <details className="msg-tools">
                <summary>{m.tools.length} Abfrage{m.tools.length === 1 ? '' : 'n'} an die Daten anzeigen</summary>
                {m.tools.map((t, j) => (
                  <pre key={j} className="snippet">
                    {t.name}{typeof t.args.query === 'string' ? '\n' + t.args.query : typeof t.args.sql === 'string' ? '\n' + t.args.sql : ''}
                  </pre>
                ))}
              </details>
            )}
          </div>
        ))}
        {busy && <div className="msg agent"><div className="msg-text hint"><span className="spinner" style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: 8 }} />Der Coach denkt nach und fragt die Daten ab …</div></div>}
        <div ref={endRef} />
      </div>

      <div className="chat-input">
        <textarea
          rows={2}
          value={input}
          placeholder="Frage stellen … (Enter zum Senden, Umschalt+Enter für neue Zeile)"
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input) } }}
        />
        <button className="btn primary" disabled={busy || !input.trim()} onClick={() => send(input)}>Senden</button>
      </div>
    </div>
  )
}
