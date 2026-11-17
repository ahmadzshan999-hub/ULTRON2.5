import React, { useCallback, useEffect, useRef, useState } from 'react';
import { supabase, supabaseConfigured } from './supabase';

function readSseFrame(frame, onEvent) {
  const lines = frame.split(/\r?\n/);
  const data = lines.filter(line => line.startsWith('data:'))
    .map(line => line.slice(5).trim()).join('\n');
  if (!data) return;
  try { onEvent(JSON.parse(data)); } catch { /* Ignore malformed event frames. */ }
}

export default function App() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [signup, setSignup] = useState(false);
  const [chats, setChats] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const bottomRef = useRef(null);
  const abortRef = useRef(null);

  useEffect(() => {
    if (!supabase) { setLoading(false); return; }
    supabase.auth.getSession().then(({ data, error: sessionError }) => {
      if (sessionError) setError(sessionError.message);
      setSession(data?.session ?? null);
      setLoading(false);
    }).catch((sessionError) => {
      console.error('ULTRON session error:', sessionError);
      setError(sessionError.message || 'Could not restore your session.');
      setLoading(false);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      if (!nextSession) { setChats([]); setMessages([]); setActiveId(null); }
    });
    return () => data.subscription.unsubscribe();
  }, []);

  const loadChats = useCallback(async () => {
    if (!supabase || !session) return;
    const { data, error: queryError } = await supabase
      .from('conversations').select('id,title,updated_at')
      .order('updated_at', { ascending: false });
    if (queryError) setError(queryError.message);
    else setChats(data || []);
  }, [session]);

  useEffect(() => { if (session) loadChats(); }, [session, loadChats]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  async function authenticate(event) {
    event.preventDefault();
    setError('');
    try {
      const result = signup
        ? await supabase.auth.signUp({ email, password })
        : await supabase.auth.signInWithPassword({ email, password });
      if (result.error) setError(result.error.message);
      else if (signup && !result.data.session) {
        setError('Account created. Check your email to confirm it, then sign in.');
      }
    } catch (authError) {
      setError(authError.message || 'Could not connect to Supabase. Check your project settings.');
    }
  }

  async function openChat(id) {
    if (busy) return;
    setError(''); setActiveId(id);
    const { data, error: queryError } = await supabase.from('messages')
      .select('id,role,content,created_at').eq('conversation_id', id)
      .order('created_at', { ascending: true });
    if (queryError) setError(queryError.message);
    else setMessages(data || []);
  }

  function newChat() {
    if (busy) return;
    setActiveId(null); setMessages([]); setInput(''); setFile(null); setError('');
  }

  async function sendMessage(event) {
    event?.preventDefault();
    const text = input.trim();
    if ((!text && !file) || busy || !session) return;
    const attachment = file;
    setBusy(true); setError(''); setInput(''); setFile(null);

    const optimisticUserId = crypto.randomUUID();
    const optimisticAssistantId = crypto.randomUUID();
    const visibleUserText = text + (attachment ? `\n\nAttached: ${attachment.name}` : '');
    setMessages(previous => [...previous,
      { id: optimisticUserId, role: 'user', content: visibleUserText },
      { id: optimisticAssistantId, role: 'assistant', content: '' }
    ]);

    let conversationId = activeId;
    let assistantText = '';
    try {
      if (!conversationId) {
        const title = (text || attachment.name).slice(0, 60);
        const { data, error: insertError } = await supabase.from('conversations')
          .insert({ user_id: session.user.id, title }).select('id,title,updated_at').single();
        if (insertError) throw insertError;
        conversationId = data.id;
        setActiveId(conversationId);
        setChats(previous => [data, ...previous]);
      }

      const { error: saveError } = await supabase.from('messages').insert({
        conversation_id: conversationId, user_id: session.user.id,
        role: 'user', content: visibleUserText
      });
      if (saveError) throw saveError;

      const history = messages.slice(-16).map(message => ({
        role: message.role, content: message.content
      })).filter(message => message.content);
      const form = new FormData();
      form.append('message', text);
      form.append('history', JSON.stringify(history));
      if (attachment) form.append('file', attachment);

      abortRef.current = new AbortController();
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: form,
        signal: abortRef.current.signal
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || `Request failed (${response.status})`);
      }
      if (!response.body) throw new Error('Your browser could not read the response stream.');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let streamError = '';
      const onEvent = payload => {
        if (payload.delta) {
          assistantText += payload.delta;
          setMessages(previous => previous.map(message => message.id === optimisticAssistantId
            ? { ...message, content: assistantText } : message));
        }
        if (payload.error) streamError = payload.error;
      };
      while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
        const frames = buffer.split(/\r?\n\r?\n/);
        buffer = frames.pop() || '';
        frames.forEach(frame => readSseFrame(frame, onEvent));
        if (done) break;
      }
      if (buffer.trim()) readSseFrame(buffer, onEvent);
      if (streamError) throw new Error(streamError);
      if (!assistantText.trim()) throw new Error('ULTRON returned an empty response.');

      const { error: assistantSaveError } = await supabase.from('messages').insert({
        conversation_id: conversationId, user_id: session.user.id,
        role: 'assistant', content: assistantText
      });
      if (assistantSaveError) throw assistantSaveError;
      await supabase.from('conversations').update({ updated_at: new Date().toISOString() }).eq('id', conversationId);
      await loadChats();
    } catch (err) {
      if (err.name !== 'AbortError') setError(err.message || 'Something went wrong.');
      if (!assistantText) {
        setMessages(previous => previous.filter(message => message.id !== optimisticAssistantId));
      }
    } finally {
      setBusy(false); abortRef.current = null;
    }
  }

  async function deleteChat(id) {
    if (busy || !window.confirm('Delete this conversation permanently?')) return;
    const { error: deleteError } = await supabase.from('conversations').delete().eq('id', id);
    if (deleteError) setError(deleteError.message);
    else { if (activeId === id) newChat(); await loadChats(); }
  }

  function startVoiceInput() {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) { setError('Voice typing is not supported in this browser.'); return; }
    const recognition = new Recognition();
    recognition.lang = 'en-US';
    recognition.onresult = event => setInput(previous => `${previous}${previous ? ' ' : ''}${event.results[0][0].transcript}`);
    recognition.onerror = () => setError('Voice input could not start. Check microphone permission.');
    recognition.start();
  }

  if (loading) return <div className="screen-center">Loading ULTRON...</div>;
  if (!supabaseConfigured || !supabase) return <div className="screen-center"><div className="notice"><div className="brand-mark">U</div><h2>ULTRON needs its database connection</h2><p>The app is running, but its Supabase settings are missing or invalid. Add the Supabase project URL and public anon/publishable key to the app's environment settings, then rebuild and redeploy.</p><div className="setup-details"><strong>Required frontend settings</strong><code>VITE_SUPABASE_URL</code><code>VITE_SUPABASE_ANON_KEY</code><small>Never put your OpenAI secret key in a VITE_ variable.</small></div></div></div>;

  if (!session) return (
    <div className="auth-screen">
      <form className="auth-card" onSubmit={authenticate}>
        <div className="brand-mark">U</div><h1>ULTRON AI</h1>
        <p>Your personal intelligent assistant.</p>
        <input type="email" placeholder="Email address" value={email} onChange={event => setEmail(event.target.value)} required />
        <input type="password" placeholder="Password (at least 6 characters)" value={password} onChange={event => setPassword(event.target.value)} minLength={6} required />
        {error && <div className="error-text">{error}</div>}
        <button className="primary-button" type="submit">{signup ? 'Create account' : 'Sign in'}</button>
        <button className="text-button" type="button" onClick={() => { setSignup(!signup); setError(''); }}>
          {signup ? 'Already have an account? Sign in' : 'New here? Create an account'}
        </button>
      </form>
    </div>
  );

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand"><div className="small-mark">U</div><span>ULTRON</span></div>
        <button className="new-chat-button" onClick={newChat}>＋ <span>New chat</span></button>
        <div className="history-label">YOUR CHATS</div>
        <div className="chat-list">
          {chats.map(chat => <div className={`chat-row ${activeId === chat.id ? 'selected' : ''}`} key={chat.id}>
            <button className="chat-title" onClick={() => openChat(chat.id)} title={chat.title}>{chat.title}</button>
            <button className="delete-chat" onClick={() => deleteChat(chat.id)} title="Delete chat" aria-label="Delete chat">×</button>
          </div>)}
          {!chats.length && <p className="empty-history">Your conversations will appear here.</p>}
        </div>
        <button className="signout-button" onClick={() => supabase.auth.signOut()}>↪ <span>Sign out</span></button>
      </aside>

      <main className="main-panel">
        <header className="topbar"><div className="mobile-brand">ULTRON</div><div className="model-label">ULTRON <span>ASSISTANT</span></div><div className="status"><i /> Ready</div></header>
        <section className="conversation">
          {!messages.length ? <div className="welcome-panel"><div className="brand-mark large">U</div><h1>What can I help you with?</h1><p>Ask a question, explore an idea, or upload a document.</p><div className="suggestions"><button onClick={() => setInput('Explain a difficult topic in simple words.')}>Explain a topic</button><button onClick={() => setInput('Help me brainstorm some ideas.')}>Brainstorm ideas</button><button onClick={() => setInput('Help me write a professional email.')}>Write something</button></div></div> : messages.map(message => <article className={`message ${message.role}`} key={message.id}>
            <div className="message-avatar">{message.role === 'assistant' ? 'U' : 'Y'}</div>
            <div className="message-body"><div className="message-name">{message.role === 'assistant' ? 'ULTRON' : 'YOU'}</div><div className="message-content">{message.content || (busy ? <span className="typing">Thinking...</span> : '')}</div>
              {message.role === 'assistant' && message.content && <button className="copy-button" onClick={() => navigator.clipboard.writeText(message.content).catch(() => setError('Could not copy text.'))}>Copy response</button>}
            </div>
          </article>)}
          <div ref={bottomRef} />
        </section>
        {error && <div className="error-banner"><span>{error}</span><button onClick={() => setError('')}>×</button></div>}
        {file && <div className="file-preview">📎 {file.name}<button onClick={() => setFile(null)}>Remove</button></div>}
        <form className="composer" onSubmit={sendMessage}>
          <label className="attach-button" title="Attach a file">＋<input type="file" accept=".txt,.md,.csv,.pdf,.docx" onChange={event => setFile(event.target.files?.[0] || null)} /></label>
          <textarea value={input} onChange={event => setInput(event.target.value)} placeholder="Message ULTRON..." rows={1} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); sendMessage(); } }} />
          <button className="voice-button" type="button" onClick={startVoiceInput} title="Voice typing">⌁</button>
          {busy ? <button className="send-button stop-button" type="button" onClick={() => abortRef.current?.abort()} title="Stop generating">■</button> : <button className="send-button" type="submit" disabled={!input.trim() && !file} title="Send">↑</button>}
        </form>
        <div className="footer-note">ULTRON can make mistakes. Check important information.</div>
      </main>
    </div>
  );
}
