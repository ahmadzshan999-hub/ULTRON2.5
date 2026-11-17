import { useEffect, useRef, useState } from 'react';
import { supabase } from './supabase';

const starterPrompts = [
  'Explain a difficult topic simply',
  'Help me write something excellent',
  'Debug or explain my code',
  'Give me ideas for a project'
];

function Icon({ children }) { return <span className="icon" aria-hidden="true">{children}</span>; }

function AuthScreen() {
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function submit(e) {
    e.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      const result = mode === 'signup'
        ? await supabase.auth.signUp({ email, password })
        : await supabase.auth.signInWithPassword({ email, password });
      if (result.error) throw result.error;
      if (mode === 'signup' && !result.data.session) setNotice('Account created. Check your email to confirm, then sign in.');
    } catch (err) { setError(err.message || 'Authentication failed.'); }
    finally { setBusy(false); }
  }

  return <main className="auth-wrap"><section className="auth-card">
    <div className="brand-mark">U</div><div className="eyebrow">YOUR PERSONAL AI</div>
    <h1>Meet <span>ULTRON</span></h1><p className="muted">A smarter space to think, create and get things done.</p>
    <div className="auth-tabs"><button className={mode==='login'?'active':''} onClick={()=>setMode('login')}>Sign in</button><button className={mode==='signup'?'active':''} onClick={()=>setMode('signup')}>Create account</button></div>
    <form onSubmit={submit} className="auth-form">
      <label>Email address<input type="email" autoComplete="email" required value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@example.com" /></label>
      <label>Password<input type="password" autoComplete={mode==='signup'?'new-password':'current-password'} minLength="6" required value={password} onChange={e=>setPassword(e.target.value)} placeholder="At least 6 characters" /></label>
      {error && <p className="error">{error}</p>}{notice && <p className="notice">{notice}</p>}
      <button className="primary full" disabled={busy}>{busy?'Please wait…':mode==='signup'?'Create account':'Sign in'}</button>
    </form><p className="tiny muted">Your conversations are private to your account.</p>
  </section></main>;
}

export default function App() {
  const [session, setSession] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [chats, setChats] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [file, setFile] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [search, setSearch] = useState('');
  const bottomRef = useRef(null);
  const inputRef = useRef(null);
  const abortRef = useRef(null);

  useEffect(() => {
    if (!supabase) { setAuthReady(true); return; }
    supabase.auth.getSession().then(({data}) => { setSession(data.session); setAuthReady(true); });
    const {data:{subscription}} = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => { if (session) loadChats(); else { setChats([]); setMessages([]); setActiveId(null); } }, [session?.user?.id]);
  useEffect(() => { bottomRef.current?.scrollIntoView({behavior:'smooth'}); }, [messages, busy]);
  useEffect(() => { inputRef.current?.focus(); }, [activeId]);

  async function loadChats() {
    const {data,error} = await supabase.from('conversations').select('id,title,updated_at').order('updated_at',{ascending:false});
    if (error) setError(error.message); else setChats(data || []);
  }

  async function openChat(id) {
    setError(''); setActiveId(id);
    const {data,error} = await supabase.from('messages').select('id,role,content,created_at').eq('conversation_id',id).order('created_at',{ascending:true});
    if (error) setError(error.message); else setMessages(data || []);
    setSidebarOpen(false);
  }

  async function newChat() {
    setActiveId(null); setMessages([]); setInput(''); setFile(null); setError(''); setSidebarOpen(false);
    inputRef.current?.focus();
  }

  async function ensureConversation(firstText) {
    if (activeId) return activeId;
    const title = firstText.trim().slice(0,48) || 'New chat';
    const {data,error} = await supabase.from('conversations').insert({user_id:session.user.id,title}).select('id,title,updated_at').single();
    if (error) throw error;
    setActiveId(data.id); setChats(prev=>[data,...prev]);
    return data.id;
  }

  async function sendMessage(text = input) {
    const clean = text.trim();
    if ((!clean && !file) || busy) return;
    setError(''); setInput(''); setBusy(true);
    const attachment = file; setFile(null);
    const optimisticUser = {id:crypto.randomUUID(),role:'user',content:clean + (attachment ? `\n\n📎 ${attachment.name}` : '')};
    const assistantId = crypto.randomUUID();
    setMessages(prev=>[...prev,optimisticUser,{id:assistantId,role:'assistant',content:''}]);
    abortRef.current = new AbortController();
    try {
      const conversationId = await ensureConversation(clean || attachment?.name || 'Attachment');
      const {error:saveError} = await supabase.from('messages').insert({conversation_id:conversationId,user_id:session.user.id,role:'user',content:optimisticUser.content});
      if (saveError) throw saveError;

      const form = new FormData();
      form.append('message',clean);
      form.append('history',JSON.stringify(messages.slice(-16).map(m=>({role:m.role,content:m.content}))));
      if (attachment) form.append('file',attachment);
      const response = await fetch('/api/chat',{method:'POST',headers:{Authorization:`Bearer ${session.access_token}`},body:form,signal:abortRef.current.signal});
      if (!response.ok) {
        const payload = await response.json().catch(()=>({}));
        throw new Error(payload.error || `Request failed (${response.status})`);
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let answer = '';
      while (true) {
        const {value,done} = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value,{stream:true});
        for (const line of chunk.split('\n')) {
          if (!line.startsWith('data:')) continue;
          const raw = line.slice(5).trim();
          if (!raw) continue;
          const event = JSON.parse(raw);
          if (event.delta) {
            answer += event.delta;
            setMessages(prev=>prev.map(m=>m.id===assistantId?{...m,content:answer}:m));
          }
          if (event.error) throw new Error(event.error);
        }
      }
      if (!answer.trim()) answer = 'I could not generate a response. Please try again.';
      const {error:assistantSaveError} = await supabase.from('messages').insert({conversation_id:conversationId,user_id:session.user.id,role:'assistant',content:answer});
      if (assistantSaveError) throw assistantSaveError;
      await supabase.from('conversations').update({updated_at:new Date().toISOString()}).eq('id',conversationId);
      loadChats();
    } catch (err) {
      if (err.name !== 'AbortError') {
        setError(err.message || 'Something went wrong.');
        setMessages(prev=>prev.map(m=>m.id===assistantId?{...m,content:'Sorry — something went wrong. Check the error above and try again.'}:m));
      }
    } finally { setBusy(false); abortRef.current = null; }
  }

  async function deleteChat(id,e) {
    e?.stopPropagation();
    if (!confirm('Delete this conversation permanently?')) return;
    const {error} = await supabase.from('conversations').delete().eq('id',id);
    if (error) setError(error.message);
    else { setChats(prev=>prev.filter(c=>c.id!==id)); if(activeId===id) newChat(); }
  }

  async function renameChat(id) {
    const chat = chats.find(c=>c.id===id);
    const title = prompt('Rename conversation:',chat?.title || '');
    if (!title?.trim()) return;
    const {error} = await supabase.from('conversations').update({title:title.trim()}).eq('id',id);
    if (error) setError(error.message); else loadChats();
  }

  async function signOut() { abortRef.current?.abort(); await supabase.auth.signOut(); }

  function startVoice() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) { setError('Voice typing is not supported in this browser.'); return; }
    const recognition = new SpeechRecognition();
    recognition.lang = 'en-US'; recognition.interimResults = false;
    recognition.onresult = e => setInput(v => (v ? v + ' ' : '') + e.results[0][0].transcript);
    recognition.onerror = () => setError('Voice input could not start. Check microphone permission.');
    recognition.start();
  }

  function speak(text) {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1; window.speechSynthesis.speak(utterance);
  }

  if (!authReady) return <div className="loading-screen">Loading ULTRON…</div>;
  if (!supabase) return <div className="setup-error"><h1>ULTRON setup needed</h1><p>Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to your root .env file, then restart the app.</p></div>;
  if (!session) return <AuthScreen />;

  const visibleChats = chats.filter(c=>c.title.toLowerCase().includes(search.toLowerCase()));

  return <div className="app-shell">
    <aside className={`sidebar ${sidebarOpen?'open':''}`}>
      <div className="side-top"><div className="brand"><span className="brand-mark small">U</span><span>ULTRON</span></div><button className="icon-btn mobile-only" onClick={()=>setSidebarOpen(false)}>✕</button></div>
      <button className="new-chat" onClick={newChat}><Icon>＋</Icon> New chat</button>
      <div className="search-box"><span>⌕</span><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search chats" /></div>
      <div className="history-label">YOUR CHATS</div>
      <div className="chat-list">{visibleChats.map(chat=><div key={chat.id} className={`chat-row ${activeId===chat.id?'selected':''}`} onClick={()=>openChat(chat.id)}>
        <span className="chat-title">▤ {chat.title}</span><div className="chat-actions"><button title="Rename" onClick={e=>{e.stopPropagation();renameChat(chat.id)}}>✎</button><button title="Delete" onClick={e=>deleteChat(chat.id,e)}>×</button></div>
      </div>)}</div>
      <div className="side-bottom"><div className="user-avatar">{(session.user.email||'U')[0].toUpperCase()}</div><div className="user-info"><strong>{session.user.email}</strong><span>Personal account</span></div><button className="icon-btn" title="Sign out" onClick={signOut}>↪</button></div>
    </aside>

    <main className="main-panel">
      <header className="topbar"><button className="icon-btn mobile-only" onClick={()=>setSidebarOpen(true)}>☰</button><div className="top-brand">ULTRON <span>AI</span></div><div className="top-right"><span className="status-dot"></span> Online</div></header>
      <section className="conversation">
        {messages.length===0 ? <div className="welcome">
          <div className="glow-orb"><span>U</span></div><p className="eyebrow">YOUR AI COMPANION</p><h1>What can I help you <span>with?</span></h1><p className="muted">Ask anything. Explore ideas. Get things done.</p>
          <div className="prompt-grid">{starterPrompts.map(p=><button key={p} onClick={()=>sendMessage(p)}>{p}<span>↗</span></button>)}</div>
        </div> : <div className="message-list">{messages.map((m,i)=><article className={`message ${m.role}`} key={m.id}>
          <div className="message-avatar">{m.role==='assistant'?'U':(session.user.email||'Y')[0].toUpperCase()}</div><div className="message-body"><div className="message-name">{m.role==='assistant'?'ULTRON':'You'}</div><div className="message-content">{m.content || (busy && i===messages.length-1 ? <span className="typing">Thinking<span>.</span><span>.</span><span>.</span></span> : '')}</div>
          {m.role==='assistant' && m.content && <div className="message-tools"><button onClick={()=>navigator.clipboard.writeText(m.content)}>Copy</button><button onClick={()=>speak(m.content)}>Read aloud</button></div>}</div>
        </article>)}</div>}
        <div ref={bottomRef}/>
      </section>
      <footer className="composer-area">
        {error && <div className="error-banner">{error}<button onClick={()=>setError('')}>Dismiss</button></div>}
        {file && <div className="file-chip">📎 {file.name}<button onClick={()=>setFile(null)}>×</button></div>}
        <form className="composer" onSubmit={e=>{e.preventDefault();sendMessage();}}>
          <label className="attach-btn" title="Attach a file">＋<input type="file" accept=".txt,.md,.csv,.pdf,.docx" onChange={e=>setFile(e.target.files?.[0]||null)} /></label>
          <textarea ref={inputRef} rows="1" value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendMessage();}}} placeholder="Message ULTRON…" />
          <button type="button" className="icon-btn voice-btn" title="Voice input" onClick={startVoice}>♩</button>
          {busy ? <button type="button" className="send-btn stop" onClick={()=>abortRef.current?.abort()}>■</button> : <button className="send-btn" disabled={!input.trim()&&!file}>↑</button>}
        </form><p className="disclaimer">ULTRON can make mistakes. Check important information.</p>
      </footer>
    </main>
  </div>;
}
