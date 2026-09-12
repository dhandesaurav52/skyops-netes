import { AlertCircle, Check, Copy, Loader2, X } from 'lucide-react';
import React, { useState } from 'react';

export const Button: React.FC<{
  children: React.ReactNode;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost' | 'outline';
  size?: 'sm' | 'md' | 'lg';
  onClick?: () => void;
  disabled?: boolean;
  type?: 'button' | 'submit' | 'reset';
  className?: string;
  icon?: React.ReactNode;
}> = ({
  children,
  variant = 'secondary',
  size = 'md',
  onClick,
  disabled = false,
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
    primary: 'bg-sky-600 hover:bg-sky-500 text-white border-sky-500 shadow-sm',
    secondary: 'bg-zinc-800 hover:bg-zinc-700 text-zinc-100 border-zinc-700',
    danger: 'bg-rose-600/90 hover:bg-rose-600 text-white border-rose-500',
    ghost: 'bg-transparent hover:bg-zinc-800 text-zinc-300 border-transparent',
    outline: 'bg-transparent hover:bg-zinc-800 text-zinc-200 border-zinc-700'
  };

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`${base} ${sizes[size]} ${variants[variant]} ${className}`}
    >
      {icon && <span className="w-4 h-4">{icon}</span>}
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
  maxWidth?: 'sm' | 'md' | 'lg' | 'xl' | '2xl';
}> = ({ isOpen, onClose, title, children, maxWidth = 'lg' }) => {
  if (!isOpen) return null;

  const widths = {
    sm: 'max-w-md',
    md: 'max-w-lg',
    lg: 'max-w-2xl',
    xl: 'max-w-4xl',
    '2xl': 'max-w-6xl'
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs">
      <div
        className={`w-full ${widths[maxWidth]} bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]`}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800 bg-zinc-900/90">
          <h3 className="text-base font-semibold text-zinc-100">{title}</h3>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-200 p-1 rounded hover:bg-zinc-800 transition-colors"
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
    <div className="flex flex-col items-center justify-center p-12 text-center border border-dashed border-zinc-800 rounded-xl bg-zinc-900/30">
      {icon ? (
        <div className="p-3 bg-zinc-800/80 rounded-full text-zinc-400 mb-4">{icon}</div>
      ) : (
        <AlertCircle className="w-10 h-10 text-zinc-500 mb-4" />
      )}
      <h4 className="text-base font-semibold text-zinc-200 mb-1">{title}</h4>
      <p className="text-sm text-zinc-400 max-w-md mb-6">{description}</p>
      {action && (
        <Button variant="primary" onClick={action.onClick}>
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
