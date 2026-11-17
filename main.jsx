
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('ULTRON frontend error:', error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="fatal-error">
          <h1>ULTRON could not start</h1>
          <p>{this.state.error.message}</p>
          <p>Check the browser console for the full error.</p>
          <button onClick={() => window.location.reload()}>
            Reload ULTRON
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

const rootElement = document.getElementById('root');

if (!rootElement) {
  document.body.innerHTML =
    '<h1 style="color:white;padding:30px">ULTRON error: root element missing.</h1>';
} else {
  createRoot(rootElement).render(
    <React.StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </React.StrictMode>
  );
}
