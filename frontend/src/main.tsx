import React, { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import 'leaflet/dist/leaflet.css';
import './styles.css';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class RootErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  public state: ErrorBoundaryState = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('Unhandled React Error:', error, errorInfo);
  }

  public render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div style={{
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '2rem',
          fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
          background: '#f8fafc',
          color: '#1e293b',
        }}>
          <div style={{
            maxWidth: '520px',
            width: '100%',
            background: '#ffffff',
            borderRadius: '16px',
            padding: '2.5rem',
            boxShadow: '0 10px 30px rgba(0,0,0,0.08)',
            textAlign: 'center',
            border: '1px solid #e2e8f0',
          }}>
            <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🌸</div>
            <h1 style={{ fontSize: '1.4rem', fontWeight: 800, color: '#4a1553', marginBottom: '0.5rem' }}>
              eSakhi Workspace
            </h1>
            <p style={{ fontSize: '0.92rem', color: '#64748b', marginBottom: '1.5rem', lineHeight: 1.5 }}>
              A temporary issue occurred while rendering this page.
            </p>
            {this.state.error && (
              <pre style={{
                background: '#f1f5f9',
                padding: '0.75rem 1rem',
                borderRadius: '8px',
                fontSize: '0.78rem',
                color: '#dc2626',
                textAlign: 'left',
                overflowX: 'auto',
                marginBottom: '1.5rem',
              }}>
                {this.state.error.message}
              </pre>
            )}
            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center' }}>
              <button
                type="button"
                onClick={() => { window.location.href = '/'; }}
                style={{
                  background: '#6b215c',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '8px',
                  padding: '0.65rem 1.25rem',
                  fontWeight: 700,
                  fontSize: '0.88rem',
                  cursor: 'pointer',
                }}
              >
                Go to Home
              </button>
              <button
                type="button"
                onClick={() => { window.location.reload(); }}
                style={{
                  background: '#f1f5f9',
                  color: '#334155',
                  border: '1px solid #cbd5e1',
                  borderRadius: '8px',
                  padding: '0.65rem 1.25rem',
                  fontWeight: 700,
                  fontSize: '0.88rem',
                  cursor: 'pointer',
                }}
              >
                Reload Page
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RootErrorBoundary>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </RootErrorBoundary>
  </React.StrictMode>,
);
