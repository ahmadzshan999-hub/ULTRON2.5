import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';

class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('ULTRON render error:', error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <main className="fatal-screen">
          <div className="fatal-card">
            <div className="brand-mark">U</div>
            <h1>ULTRON could not start</h1>
            <p>The interface encountered an error instead of loading. Refresh the page. If it continues, share this error with the app developer.</p>
            <pre>{this.state.error.message || String(this.state.error)}</pre>
            <button className="primary-button" onClick={() => window.location.reload()}>Reload ULTRON</button>
          </div>
        </main>
      );
    }
    return this.props.children;
  }
}

const root = createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </React.StrictMode>
);
