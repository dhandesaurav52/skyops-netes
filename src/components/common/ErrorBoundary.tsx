import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertOctagon, RefreshCw, Home } from 'lucide-react';

interface Props {
  children: ReactNode;
  fallbackTitle?: string;
  fallbackMessage?: string;
  onReset?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  state: State;

  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null
    };
  }

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[SkyOps ErrorBoundary Caught Error]:', error, errorInfo);
    (this as any).setState({ errorInfo });
  }

  private handleReload = () => {
    (this as any).setState({ hasError: false, error: null, errorInfo: null });
    const props = (this as any).props as Props;
    if (props && props.onReset) {
      props.onReset();
    } else {
      window.location.reload();
    }
  };

  private handleGoHome = () => {
    window.location.href = '/';
  };

  public render(): ReactNode {
    const state = (this as any).state as State;
    const props = (this as any).props as Props;

    if (state && state.hasError) {
      return (
        <div className="min-h-[400px] flex items-center justify-center p-6 bg-zinc-950 font-mono">
          <div className="max-w-lg w-full bg-zinc-900 border border-zinc-800 rounded-xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-3 border-b border-zinc-800 pb-3">
              <div className="p-2 rounded-lg bg-rose-950/80 text-rose-400 border border-rose-800">
                <AlertOctagon className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-sm text-zinc-100">
                  {props?.fallbackTitle || 'Component Rendering Exception'}
                </h3>
                <p className="text-xs text-zinc-500">SkyOps telemetry view safely isolated this error.</p>
              </div>
            </div>

            <div className="space-y-2">
              <div className="p-3 rounded-lg bg-zinc-950 border border-zinc-800/80 text-xs text-rose-300 font-mono break-words">
                {state.error?.message || 'An unexpected runtime error occurred.'}
              </div>
              <p className="text-[11px] text-zinc-400">
                {props?.fallbackMessage ||
                  'The requested view encountered a rendering anomaly. The application state remains secure.'}
              </p>
            </div>

            <div className="flex items-center gap-2 pt-2 border-t border-zinc-800">
              <button
                onClick={this.handleReload}
                className="px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Recover View</span>
              </button>
              <button
                onClick={this.handleGoHome}
                className="px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <Home className="w-3.5 h-3.5" />
                <span>Return to Overview</span>
              </button>
            </div>
          </div>
        </div>
      );
    }

    return props?.children;
  }
}
