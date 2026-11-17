
import { useEffect, useRef, useState } from 'react';
import { supabase, supabaseConfigured } from './supabase';

export default function App() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [signup, setSignup] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [chats, setChats] = useState([]);
  const [activeChat, setActiveChat] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const bottomRef = useRef(null);
  const abortRef = useRef(null);

  useEffect(() => {
    if (!supabaseConfigured) {
      setLoading(false);
      return;
    }

    let mounted = true;

    supabase.auth.getSession().then(({ data, error }) => {
      if (!mounted) return;
      if (error) setError(error.message);
      setSession(data?.session ?? null);
      setLoading(false);
    });

    const { data } = supabase.auth.onAuthStateChange(
      (_event, newSession) => {
        setSession(newSession);
      }
    );

    return () => {
      mounted = false;
      data.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (session) loadChats();
    else {
      setChats([]);
      setMessages([]);
      setActiveChat(null);
    }
  }, [session]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function loadChats() {
    const { data, error } = await supabase
      .from('conversations')
      .select('id,title,updated_at')
      .order('updated_at', { ascending: false });

    if (error) {
      setError(`Could not load conversations: ${error.message}`);
      return;
    }

    setChats(data || []);
  }

  async function authenticate(event) {
    event.preventDefault();
    setError('');

    try {
      const result = signup
        ? await supabase.auth.signUp({ email, password })
        : await supabase.auth.signInWithPassword({ email, password });

      if (result.error) throw result.error;

      if (signup && !result.data.session) {
        setError('Account created. Check your email to confirm your account.');
      }
    } catch (err) {
      setError(err.message || 'Authentication failed.');
    }
  }

  async function openChat(id) {
    setError('');
    setActiveChat(id);
    setMessages([]);

    const { data, error } = await supabase
      .from('messages')
      .select('id,role,content,created_at')
      .eq('conversation_id', id)
      .order('created_at', { ascending: true });

    if (error) {
      setError(`Could not open conversation: ${error.message}`);
      return;
    }

    setMessages(data || []);
  }

  function newChat() {
    abortRef.current?.abort();
    setActiveChat(null);
    setMessages([]);
    setInput('');
    setFile(null);
    setError('');
  }

  async function sendMessage(event) {
    event?.preventDefault();

    const text = input.trim();
    if ((!text && !file) || busy) return;

    const attachment = file;
    const displayText = text +
      (attachment ? `\n[Attached: ${attachment.name}]` : '');

    setInput('');
    setFile(null);
    setError('');
    setBusy(true);

    const temporaryUserId = crypto.randomUUID();
    const temporaryAssistantId = crypto.randomUUID();

    setMessages(old => [
      ...old,
      {
        id: temporaryUserId,
        role: 'user',
        content: displayText
      },
      {
        id: temporaryAssistantId,
        role: 'assistant',
        content: ''
      }
    ]);

    try {
      let conversationId = activeChat;

      if (!conversationId) {
        const { data, error } = await supabase
          .from('conversations')
          .insert({
            user_id: session.user.id,
            title: (text || attachment?.name || 'New chat').slice(0, 70)
          })
          .select('id,title,updated_at')
          .single();

        if (error) throw error;

        conversationId = data.id;
        setActiveChat(conversationId);
      }

      const { error: saveError } = await supabase
        .from('messages')
        .insert({
          conversation_id: conversationId,
          user_id: session.user.id,
          role: 'user',
          content: displayText
        });

      if (saveError) throw saveError;

      const form = new FormData();
      form.append('message', text);

      const history = messages
        .filter(m => m.role === 'user' || m.role === 'assistant')
        .slice(-12)
        .map(m => ({
          role: m.role,
          content: m.content
        }));

      form.append('history', JSON.stringify(history));

      if (attachment) form.append('file', attachment);

      abortRef.current = new AbortController();

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`
        },
        body: form,
        signal: abortRef.current.signal
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || `Server error: ${response.status}`);
      }

      if (!response.body) {
        throw new Error('The server did not return a response stream.');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let answer = '';

      while (true) {
        const { value, done } = await reader.read();

        buffer += decoder.decode(value || new Uint8Array(), {
          stream: !done
        });

        const frames = buffer.split('\n\n');
        buffer = frames.pop() || '';

        for (const frame of frames) {
          const line = frame
            .split('\n')
            .find(part => part.startsWith('data:'));

          if (!line) continue;

          const payload = JSON.parse(line.slice(5).trim());

          if (payload.error) {
            throw new Error(payload.error);
          }

          if (payload.delta) {
            answer += payload.delta;

            setMessages(old => old.map(message =>
              message.id === temporaryAssistantId
                ? { ...message, content: answer }
                : message
            ));
          }
        }

        if (done) break;
      }

      if (!answer.trim()) {
        throw new Error('ULTRON received an empty answer from the AI service.');
      }

      const { error: assistantSaveError } = await supabase
        .from('messages')
        .insert({
          conversation_id: conversationId,
          user_id: session.user.id,
          role: 'assistant',
          content: answer
        });

      if (assistantSaveError) throw assistantSaveError;

      await supabase
        .from('conversations')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', conversationId);

      await loadChats();
    } catch (err) {
      if (err.name !== 'AbortError') {
        setError(err.message || 'Something went wrong.');
      }

      setMessages(old => old.filter(message =>
        message.id !== temporaryAssistantId ||
        message.content.length > 0
      ));
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }

  async function deleteChat(id) {
    if (!window.confirm('Delete this conversation permanently?')) return;

    const { error } = await supabase
      .from('conversations')
      .delete()
      .eq('id', id);

    if (error) {
      setError(error.message);
      return;
    }

    if (activeChat === id) newChat();
    await loadChats();
  }

  async function renameChat(chat) {
    const title = window.prompt('Enter a new conversation name:', chat.title);
    if (!title?.trim()) return;

    const { error } = await supabase
      .from('conversations')
      .update({ title: title.trim() })
      .eq('id', chat.id);

    if (error) setError(error.message);
    else await loadChats();
  }

  function startVoiceInput() {
    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setError('Voice input is not supported by this browser.');
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = 'en-US';
    recognition.onresult = event => {
      setInput(current =>
        `${current} ${event.results[0][0].transcript}`.trim()
      );
    };
    recognition.onerror = () => {
      setError('Voice input could not start. Check your microphone permission.');
    };
    recognition.start();
  }

  if (loading) {
    return <div className="screen-message">Starting ULTRON...</div>;
  }

  if (!supabaseConfigured) {
    return (
      <div className="screen-message">
        <div className="brand-mark">U</div>
        <h1>ULTRON needs configuration</h1>
        <p>
          Supabase is not configured. The frontend cannot sign in
          until its public project URL and publishable key are set.
        </p>
        <p className="muted">
          Check VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
          in your environment settings.
        </p>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="auth-screen">
        <form className="auth-card" onSubmit={authenticate}>
          <div className="brand-mark">U</div>
          <h1>ULTRON AI</h1>
          <p>Your intelligent personal assistant.</p>

          <input
            type="email"
            placeholder="Email address"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
          />

          <input
            type="password"
            placeholder="Password (minimum 6 characters)"
            value={password}
            onChange={e => setPassword(e.target.value)}
            minLength={6}
            required
          />

          {error && <div className="notice">{error}</div>}

          <button className="primary-button" type="submit">
            {signup ? 'Create account' : 'Sign in'}
          </button>

          <button
            className="text-button"
            type="button"
            onClick={() => {
              setSignup(value => !value);
              setError('');
            }}
          >
            {signup
              ? 'Already have an account? Sign in'
              : 'New to ULTRON? Create an account'}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="app-layout">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="small-mark">U</div>
          <span>ULTRON</span>
        </div>

        <button className="new-chat-button" onClick={newChat}>
          <span>＋</span> New chat
        </button>

        <div className="history-heading">YOUR CHATS</div>

        <div className="history-list">
          {chats.map(chat => (
            <div
              key={chat.id}
              className={`history-item ${activeChat === chat.id ? 'selected' : ''}`}
            >
              <button
                className="history-title"
                onClick={() => openChat(chat.id)}
                title={chat.title}
              >
                {chat.title}
              </button>

              <button
                className="history-action"
                title="Rename"
                onClick={() => renameChat(chat)}
              >
                ✎
              </button>

              <button
                className="history-action"
                title="Delete"
                onClick={() => deleteChat(chat.id)}
              >
                ×
              </button>
            </div>
          ))}
        </div>

        <div className="account-area">
          <span>{session.user.email}</span>
          <button onClick={() => supabase.auth.signOut()}>
            Sign out
          </button>
        </div>
      </aside>

      <main className="main-panel">
        <header className="topbar">
          <strong>ULTRON <span>AI</span></strong>
          <span className="status"><i /> Ready</span>
        </header>

        <section className="conversation">
          {messages.length === 0 ? (
            <div className="welcome">
              <div className="brand-mark">U</div>
              <h1>What can I help you with?</h1>
              <p>Ask a question, explore an idea or upload a document.</p>
            </div>
          ) : (
            messages.map(message => (
              <article
                key={message.id}
                className={`message ${message.role}`}
              >
                <div className="message-label">
                  {message.role === 'assistant' ? 'ULTRON' : 'YOU'}
                </div>
                <div className="message-content">
                  {message.content || (busy ? 'Thinking...' : '')}
                </div>
                {message.role === 'assistant' && message.content && (
                  <button
                    className="copy-button"
                    onClick={() =>
                      navigator.clipboard.writeText(message.content)
                    }
                  >
                    Copy response
                  </button>
                )}
              </article>
            ))
          )}
          <div ref={bottomRef} />
        </section>

        {error && (
          <div className="error-banner" role="alert">
            {error}
            <button onClick={() => setError('')}>Dismiss</button>
          </div>
        )}

        {file && (
          <div className="attachment-chip">
            {file.name}
            <button onClick={() => setFile(null)}>×</button>
          </div>
        )}

        <form className="composer" onSubmit={sendMessage}>
          <label className="attach-button" title="Attach a document">
            ＋
            <input
              type="file"
              accept=".txt,.md,.csv,.pdf,.docx"
              onChange={event => setFile(event.target.files?.[0] || null)}
            />
          </label>

          <textarea
            value={input}
            onChange={event => setInput(event.target.value)}
            placeholder="Message ULTRON..."
            rows={1}
            onKeyDown={event => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                sendMessage();
              }
            }}
          />

          <button
            type="button"
            className="voice-button"
            onClick={startVoiceInput}
            title="Voice input"
          >
            🎙
          </button>

          {busy ? (
            <button
              type="button"
              className="send-button"
              onClick={() => abortRef.current?.abort()}
              title="Stop"
            >
              ■
            </button>
          ) : (
            <button
              type="submit"
              className="send-button"
              disabled={!input.trim() && !file}
              title="Send message"
            >
              ↑
            </button>
          )}
        </form>

        <p className="disclaimer">
          ULTRON may make mistakes. Check important information.
        </p>
      </main>
    </div>
  );
}
