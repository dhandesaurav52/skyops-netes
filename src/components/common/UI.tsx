import { AlertCircle, Check, Copy, Loader2, X } from 'lucide-react';
import React, { useState } from 'react';

export const Button: React.FC<{
  id?: string;
  children: React.ReactNode;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost' | 'outline';
  size?: 'sm' | 'md' | 'lg';
  onClick?: () => void;
  disabled?: boolean;
  loading?: boolean;
  type?: 'button' | 'submit' | 'reset';
  className?: string;
  icon?: React.ReactNode;
}> = ({
  id,
  children,
  variant = 'secondary',
  size = 'md',
  onClick,
  disabled = false,
  loading = false,
  type = 'button',
  className = '',
  icon
}) => {
  const base =
    'inline-flex items-center justify-center gap-2 font-medium transition-colors rounded border cursor-pointer focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed';

  const sizes = {
    sm: 'px-2.5 py-1 text-xs',
    md: 'px-3.5 py-1.5 text-sm',
    lg: 'px-4 py-2 text-base'
  };

  const variants = {
    primary: 'bg-gradient-to-r from-sky-600 to-blue-600 hover:from-sky-500 hover:to-blue-500 text-white border-sky-400/40 shadow-[0_0_15px_-3px_rgba(14,165,233,0.4)]',
    secondary: 'bg-[#081024] hover:bg-[#0d1a38] text-zinc-100 border-sky-500/20 hover:border-sky-500/40 shadow-xs',
    danger: 'bg-rose-900/80 hover:bg-rose-800 text-white border-rose-500/50 shadow-[0_0_12px_rgba(244,63,94,0.3)]',
    ghost: 'bg-transparent hover:bg-sky-950/30 text-zinc-300 hover:text-white border-transparent',
    outline: 'bg-[#081024]/60 hover:bg-[#0d1a38] text-zinc-200 hover:text-white border-sky-500/25 hover:border-sky-500/45 shadow-xs'
  };

  return (
    <button
      id={id}
      type={type}
      onClick={onClick}
      disabled={disabled || loading}
      className={`${base} ${sizes[size]} ${variants[variant]} ${className}`}
    >
      {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : icon && <span className="w-4 h-4">{icon}</span>}
      {children}
    </button>
  );
};

export const CopyButton: React.FC<{ text: string; label?: string }> = ({ text, label }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-mono text-zinc-300 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded transition-colors"
      title="Copy to clipboard"
    >
      {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5 text-zinc-400" />}
      <span>{copied ? 'Copied' : label || 'Copy'}</span>
    </button>
  );
};

export const CodeBlock: React.FC<{ code: string; language?: string; title?: string }> = ({
  code,
  language = 'yaml',
  title
}) => {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950 overflow-hidden my-3">
      {title && (
        <div className="flex items-center justify-between px-4 py-2 bg-zinc-900 border-b border-zinc-800 text-xs text-zinc-400 font-mono">
          <span>{title}</span>
          <CopyButton text={code} />
        </div>
      )}
      <pre className="p-4 text-xs font-mono text-zinc-200 overflow-x-auto leading-relaxed scrollbar-subtle">
        <code>{code}</code>
      </pre>
    </div>
  );
};

export const Modal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  maxWidth?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | 'max-w-sm' | 'max-w-md' | 'max-w-lg' | 'max-w-xl' | 'max-w-2xl' | string;
}> = ({ isOpen, onClose, title, children, maxWidth = 'lg' }) => {
  if (!isOpen) return null;

  const widths: Record<string, string> = {
    sm: 'max-w-md',
    md: 'max-w-lg',
    lg: 'max-w-2xl',
    xl: 'max-w-4xl',
    '2xl': 'max-w-6xl',
    'max-w-sm': 'max-w-sm',
    'max-w-md': 'max-w-md',
    'max-w-lg': 'max-w-lg',
    'max-w-xl': 'max-w-xl',
    'max-w-2xl': 'max-w-2xl'
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
      <div
        className={`w-full ${widths[maxWidth]} storm-card border-sky-500/30 rounded-2xl shadow-[0_25px_50px_rgba(0,0,0,0.8),0_0_30px_rgba(14,165,233,0.15)] overflow-hidden flex flex-col max-h-[90vh]`}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-sky-500/15 bg-[#050b18]/90">
          <h3 className="text-base font-semibold text-white font-mono tracking-tight">{title}</h3>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-sky-300 p-1.5 rounded-lg hover:bg-sky-950/40 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-6 overflow-y-auto flex-1 scrollbar-subtle">{children}</div>
      </div>
    </div>
  );
};

export const EmptyState: React.FC<{
  title: string;
  description: string;
  action?: { label: string; onClick: () => void };
  icon?: React.ReactNode;
}> = ({ title, description, action, icon }) => {
  return (
    <div className="flex flex-col items-center justify-center p-12 text-center storm-card rounded-2xl border-sky-500/20 shadow-xl">
      {icon ? (
        <div className="p-3.5 bg-sky-950/50 border border-sky-500/30 rounded-2xl text-sky-400 mb-4 shadow-[0_0_15px_-3px_rgba(14,165,233,0.3)]">{icon}</div>
      ) : (
        <AlertCircle className="w-10 h-10 text-sky-400/80 mb-4" />
      )}
      <h4 className="text-base font-semibold text-white font-mono mb-1">{title}</h4>
      <p className="text-sm text-zinc-400 font-mono max-w-md mb-6">{description}</p>
      {action && (
        <Button variant="primary" onClick={action.onClick} className="font-mono text-xs">
          {action.label}
        </Button>
      )}
    </div>
  );
};

export const LoadingState: React.FC<{ message?: string }> = ({ message = 'Loading SkyOps telemetry...' }) => {
  return (
    <div className="flex flex-col items-center justify-center p-16 text-center text-zinc-400">
      <Loader2 className="w-8 h-8 animate-spin text-sky-500 mb-3" />
      <span className="text-sm font-mono">{message}</span>
    </div>
  );
};

export const ErrorState: React.FC<{ message: string; onRetry?: () => void }> = ({ message, onRetry }) => {
  return (
    <div className="p-6 border border-rose-900/50 bg-rose-950/20 rounded-xl text-rose-200 my-4">
      <div className="flex items-start gap-3">
        <AlertCircle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
        <div className="flex-1">
          <h5 className="font-semibold text-rose-300 text-sm">Operational Failure</h5>
          <p className="text-xs text-rose-400 mt-1 font-mono">{message}</p>
          {onRetry && (
            <Button variant="outline" size="sm" onClick={onRetry} className="mt-3 text-xs border-rose-800 hover:bg-rose-900/50">
              Retry
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};
