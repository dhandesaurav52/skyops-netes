import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Building2,
  Check,
  Copy,
  Globe,
  Info,
  KeyRound,
  Loader2,
  Lock,
  Mail,
  Network,
  Server,
  User as UserIcon,
  Zap
} from 'lucide-react';
import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { ElectricCircuitBackground } from '../landing/ElectricCircuitBackground';

interface AuthViewProps {
  initialMode?: 'signin' | 'signup';
  onBackToHome: () => void;
  onAuthSuccess?: () => void;
}

export const AuthView: React.FC<AuthViewProps> = ({
  initialMode = 'signin',
  onBackToHome,
  onAuthSuccess
}) => {
  const { signInWithEmail, signUpWithEmail, signInWithGoogle, sendPasswordReset, error: authError } = useAuth();
  const [mode, setMode] = useState<'signin' | 'signup' | 'forgot'>(initialMode);

  // Form states
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [orgName, setOrgName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [resetSuccess, setResetSuccess] = useState(false);
  const [copiedDomain, setCopiedDomain] = useState(false);

  // Google Org prompt state (if Google login needs org name)
  const [showGoogleOrgModal, setShowGoogleOrgModal] = useState(false);
  const [googleOrgName, setGoogleOrgName] = useState('');

  const currentHostname = typeof window !== 'undefined' ? window.location.hostname : 'your-domain.run.app';

  const handleCopyDomain = () => {
    navigator.clipboard.writeText(currentHostname);
    setCopiedDomain(true);
    setTimeout(() => setCopiedDomain(false), 2500);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    setResetSuccess(false);

    if (mode === 'forgot') {
      if (!email.trim()) {
        setLocalError('Please enter your work email address');
        return;
      }
      try {
        setSubmitting(true);
        await sendPasswordReset(email.trim());
        setResetSuccess(true);
      } catch (err: any) {
        setLocalError(err.message || 'Failed to send password reset email');
      } finally {
        setSubmitting(false);
      }
      return;
    }

    if (!email.trim() || !password.trim()) {
      setLocalError('Please enter both email and password');
      return;
    }

    if (mode === 'signup' && !orgName.trim()) {
      setLocalError('Please specify an Organization Name (e.g. Acme DevOps)');
      return;
    }

    try {
      setSubmitting(true);
      if (mode === 'signup') {
        await signUpWithEmail(email.trim(), password, orgName.trim(), displayName.trim() || undefined);
      } else {
        await signInWithEmail(email.trim(), password);
      }
      if (onAuthSuccess) onAuthSuccess();
    } catch (err: any) {
      setLocalError(err.message || 'Authentication failed. Please verify credentials.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleGoogleAuth = async (customOrg?: string) => {
    setLocalError(null);
    try {
      setSubmitting(true);
      await signInWithGoogle(customOrg || orgName.trim() || undefined);
      if (onAuthSuccess) onAuthSuccess();
    } catch (err: any) {
      setLocalError(err.message || 'Google authentication failed');
    } finally {
      setSubmitting(false);
      setShowGoogleOrgModal(false);
    }
  };

  const errorMessage = localError || authError;
  const isUnauthorizedDomain =
    errorMessage &&
    (errorMessage.includes('UNAUTHORIZED_DOMAIN') ||
      errorMessage.includes('unauthorized-domain') ||
      errorMessage.includes('auth/unauthorized-domain'));

  return (
    <div className="min-h-screen bg-[#02050d] flex flex-col justify-between text-zinc-100 font-sans selection:bg-cyan-500/30 selection:text-cyan-100 relative overflow-hidden">
      {/* Dynamic Electric Circuit Background */}
      <ElectricCircuitBackground />

      {/* Top Header */}
      <header className="relative z-10 p-6 max-w-7xl w-full mx-auto flex items-center justify-between border-b border-cyan-500/10 backdrop-blur-md bg-[#02050d]/60">
        <button
          onClick={onBackToHome}
          className="flex items-center gap-2 text-xs font-mono text-zinc-400 hover:text-cyan-300 transition-colors cursor-pointer group"
        >
          <ArrowLeft className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" />
          <span>Back to Home</span>
        </button>

        <a
          href="/"
          onClick={(e) => {
            e.preventDefault();
            onBackToHome();
          }}
          className="flex items-center gap-2.5 text-white hover:text-cyan-300 transition-colors cursor-pointer"
        >
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-sky-400 to-blue-600 flex items-center justify-center text-zinc-950 shadow-md shadow-sky-500/25">
            <Network className="w-4 h-4 text-white" />
          </div>
          <span className="text-sm font-bold tracking-tight">SkyOps</span>
        </a>
      </header>

      {/* Main Container */}
      <main className="relative z-10 flex-1 flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-md space-y-6">
          {/* Card Container with Electric Border and Glow */}
          <div className="p-8 rounded-2xl bg-[#060c18]/90 border border-cyan-500/25 shadow-2xl shadow-cyan-950/80 backdrop-blur-2xl space-y-6 relative overflow-hidden electric-circuit-border">
            {/* Top glowing electric bus line */}
            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-sky-400 via-cyan-400 to-sky-300" />

            {/* Header */}
            <div className="text-center space-y-1.5">
              <div className="inline-flex items-center gap-1.5 text-[11px] font-mono text-cyan-400 font-semibold uppercase tracking-wider mb-1">
                <Zap className="w-3.5 h-3.5 text-cyan-400" />
                <span>Enterprise Identity Bus</span>
              </div>
              <h1 className="text-2xl font-bold tracking-tight text-white">
                {mode === 'signup'
                  ? 'Create SkyOps Account'
                  : mode === 'forgot'
                  ? 'Reset Your Password'
                  : 'Sign In to SkyOps'}
              </h1>
              <p className="text-xs font-mono text-zinc-400">
                {mode === 'signup'
                  ? 'Initialize your tenant workspace & team environment'
                  : mode === 'forgot'
                  ? 'We will send a password reset link to your email'
                  : 'Enter your credentials to access your clusters'}
              </p>
            </div>

            {/* Mode Switcher Tabs */}
            {mode !== 'forgot' && (
              <div className="grid grid-cols-2 p-1 bg-[#02050b] rounded-xl border border-cyan-500/15">
                <button
                  type="button"
                  onClick={() => {
                    setMode('signin');
                    setLocalError(null);
                  }}
                  className={`py-2 text-xs font-mono font-medium rounded-lg transition-all cursor-pointer ${
                    mode === 'signin'
                      ? 'bg-gradient-to-r from-sky-500/20 to-cyan-500/20 text-cyan-300 border border-cyan-500/30 font-bold shadow-xs'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  Sign In
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMode('signup');
                    setLocalError(null);
                  }}
                  className={`py-2 text-xs font-mono font-medium rounded-lg transition-all cursor-pointer ${
                    mode === 'signup'
                      ? 'bg-gradient-to-r from-sky-500/20 to-cyan-500/20 text-cyan-300 border border-cyan-500/30 font-bold shadow-xs'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  Create Account
                </button>
              </div>
            )}

            {/* Unauthorized Domain Specific Alert */}
            {isUnauthorizedDomain ? (
              <div className="p-4 rounded-xl bg-amber-950/30 border border-amber-800/80 text-amber-200 text-xs font-mono space-y-3">
                <div className="flex items-start gap-2.5 font-semibold text-amber-300">
                  <Globe className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                  <div>Firebase OAuth Domain Notice</div>
                </div>
                <p className="text-[11px] text-zinc-300 leading-relaxed">
                  Google OAuth requires adding this app's preview host to your Firebase Console (<strong>Authentication &gt; Settings &gt; Authorized Domains</strong>):
                </p>
                <div className="flex items-center justify-between bg-[#02050b] px-2.5 py-1.5 rounded border border-zinc-800 text-[11px] text-zinc-300 font-mono">
                  <span className="truncate mr-2">{currentHostname}</span>
                  <button
                    type="button"
                    onClick={handleCopyDomain}
                    className="text-cyan-400 hover:text-cyan-300 shrink-0 flex items-center gap-1 font-semibold cursor-pointer"
                  >
                    {copiedDomain ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                    <span>{copiedDomain ? 'Copied!' : 'Copy'}</span>
                  </button>
                </div>
                <div className="pt-1 flex items-center justify-between gap-2">
                  <div className="text-[11px] text-emerald-400 flex items-center gap-1.5 font-sans font-medium">
                    <Check className="w-3.5 h-3.5" />
                    <span>Work Email & Password authentication is active below</span>
                  </div>
                </div>
              </div>
            ) : errorMessage ? (
              <div className="p-3.5 rounded-xl bg-rose-950/40 border border-rose-800 text-rose-300 text-xs font-mono flex items-start gap-2.5">
                <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                <div>{errorMessage}</div>
              </div>
            ) : null}

            {/* Success Message for Forgot Password */}
            {resetSuccess && (
              <div className="p-3.5 rounded-xl bg-emerald-950/40 border border-emerald-800 text-emerald-300 text-xs font-mono flex items-start gap-2.5">
                <Check className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <div>Password reset email sent! Check your inbox to set a new password.</div>
              </div>
            )}

            {/* Google Auth Button (For Sign In & Sign Up) */}
            {mode !== 'forgot' && (
              <div className="space-y-3">
                <button
                  type="button"
                  id="auth-google-btn"
                  onClick={() => {
                    if (mode === 'signup' && !orgName.trim()) {
                      setShowGoogleOrgModal(true);
                    } else {
                      handleGoogleAuth();
                    }
                  }}
                  disabled={submitting}
                  className="w-full py-2.5 px-4 bg-[#03060d] hover:bg-[#080f1e] border border-cyan-500/20 hover:border-cyan-500/40 rounded-xl text-xs font-mono font-medium text-zinc-100 flex items-center justify-center gap-3 transition-all cursor-pointer shadow-xs disabled:opacity-50"
                >
                  <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
                    <path
                      fill="#4285F4"
                      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                    />
                    <path
                      fill="#34A853"
                      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                    />
                    <path
                      fill="#FBBC05"
                      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                    />
                    <path
                      fill="#EA4335"
                      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                    />
                  </svg>
                  <span>Continue with Google</span>
                </button>

                <div className="relative flex items-center justify-center py-2">
                  <div className="border-t border-cyan-500/10 w-full" />
                  <span className="bg-[#060c18] px-3 text-[11px] font-mono text-zinc-400 uppercase tracking-wider absolute">
                    or with work email
                  </span>
                </div>
              </div>
            )}

            {/* Email Form */}
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Organization Name (Required for Sign Up) */}
              {mode === 'signup' && (
                <div>
                  <label className="block text-xs font-mono font-medium text-zinc-300 mb-1.5">
                    Organization / Workspace Name <span className="text-cyan-400">*</span>
                  </label>
                  <div className="relative">
                    <Building2 className="w-4 h-4 text-cyan-400 absolute left-3 top-2.5" />
                    <input
                      type="text"
                      required
                      placeholder="e.g. Acme Cloud Engineering"
                      value={orgName}
                      onChange={(e) => setOrgName(e.target.value)}
                      className="w-full pl-9 pr-3 py-2 text-xs bg-[#02050b] border border-cyan-500/20 rounded-lg text-white placeholder-zinc-500 focus:outline-none focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400/30 font-mono transition-all"
                    />
                  </div>
                </div>
              )}

              {/* Full Name (Optional for Sign Up) */}
              {mode === 'signup' && (
                <div>
                  <label className="block text-xs font-mono font-medium text-zinc-300 mb-1.5">
                    Full Name (Optional)
                  </label>
                  <div className="relative">
                    <UserIcon className="w-4 h-4 text-zinc-500 absolute left-3 top-2.5" />
                    <input
                      type="text"
                      placeholder="e.g. Alex Rivera"
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      className="w-full pl-9 pr-3 py-2 text-xs bg-[#02050b] border border-cyan-500/20 rounded-lg text-white placeholder-zinc-500 focus:outline-none focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400/30 font-mono transition-all"
                    />
                  </div>
                </div>
              )}

              {/* Work Email */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-xs font-mono font-medium text-zinc-300">
                    Work Email <span className="text-cyan-400">*</span>
                  </label>
                </div>
                <div className="relative">
                  <Mail className="w-4 h-4 text-cyan-400 absolute left-3 top-2.5" />
                  <input
                    type="email"
                    required
                    placeholder="name@company.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 text-xs bg-[#02050b] border border-cyan-500/20 rounded-lg text-white placeholder-zinc-500 focus:outline-none focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400/30 font-mono transition-all"
                  />
                </div>
              </div>

              {/* Password */}
              {mode !== 'forgot' && (
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="block text-xs font-mono font-medium text-zinc-300">
                      Password <span className="text-cyan-400">*</span>
                    </label>
                    {mode === 'signin' && (
                      <button
                        type="button"
                        onClick={() => {
                          setMode('forgot');
                          setLocalError(null);
                        }}
                        className="text-[11px] font-mono text-cyan-400 hover:text-cyan-300 transition-colors"
                      >
                        Forgot password?
                      </button>
                    )}
                  </div>
                  <div className="relative">
                    <Lock className="w-4 h-4 text-cyan-400 absolute left-3 top-2.5" />
                    <input
                      type="password"
                      required
                      placeholder="••••••••••••"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full pl-9 pr-3 py-2 text-xs bg-[#02050b] border border-cyan-500/20 rounded-lg text-white placeholder-zinc-500 focus:outline-none focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400/30 font-mono transition-all"
                    />
                  </div>
                </div>
              )}

              {/* Submit Button */}
              <button
                type="submit"
                id="auth-submit-btn"
                disabled={submitting}
                className="w-full py-2.5 px-4 bg-gradient-to-r from-sky-400 via-cyan-400 to-sky-300 hover:from-sky-300 hover:to-cyan-200 text-zinc-950 font-mono font-bold text-xs rounded-xl shadow-lg shadow-cyan-500/25 flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-50 mt-2"
              >
                {submitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Processing...</span>
                  </>
                ) : mode === 'signup' ? (
                  <>
                    <span>Create Account & Organization</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                ) : mode === 'forgot' ? (
                  <>
                    <span>Send Reset Email</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                ) : (
                  <>
                    <span>Sign In</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </form>

            {/* Toggle Modes */}
            <div className="pt-2 border-t border-cyan-500/10 text-center text-xs font-mono text-zinc-400">
              {mode === 'signup' ? (
                <div>
                  Already have an account?{' '}
                  <button
                    onClick={() => {
                      setMode('signin');
                      setLocalError(null);
                    }}
                    className="text-cyan-400 hover:text-cyan-300 font-semibold cursor-pointer underline"
                  >
                    Sign In
                  </button>
                </div>
              ) : mode === 'forgot' ? (
                <div>
                  Remember your password?{' '}
                  <button
                    onClick={() => {
                      setMode('signin');
                      setLocalError(null);
                    }}
                    className="text-cyan-400 hover:text-cyan-300 font-semibold cursor-pointer underline"
                  >
                    Back to Sign In
                  </button>
                </div>
              ) : (
                <div>
                  Don't have an account yet?{' '}
                  <button
                    onClick={() => {
                      setMode('signup');
                      setLocalError(null);
                    }}
                    className="text-cyan-400 hover:text-cyan-300 font-semibold cursor-pointer underline"
                  >
                    Create Account & Organization
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>

      {/* Google Org Prompt Modal */}
      {showGoogleOrgModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-[#060c18] border border-cyan-500/30 rounded-2xl p-6 max-w-md w-full space-y-4 shadow-2xl electric-circuit-border">
            <div className="space-y-1">
              <h3 className="text-sm font-bold text-white">Set Up Your Organization Name</h3>
              <p className="text-xs font-mono text-zinc-400">
                To complete your Google sign up, specify your team workspace or organization name.
              </p>
            </div>

            <div>
              <label className="block text-xs font-mono font-medium text-zinc-300 mb-1.5">
                Organization Name
              </label>
              <input
                type="text"
                required
                placeholder="e.g. Acme DevOps"
                value={googleOrgName}
                onChange={(e) => setGoogleOrgName(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-[#02050b] border border-cyan-500/20 rounded-lg text-white placeholder-zinc-500 focus:outline-none focus:border-cyan-400 font-mono"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-cyan-500/10">
              <button
                type="button"
                onClick={() => setShowGoogleOrgModal(false)}
                className="px-3 py-1.5 text-xs font-mono text-zinc-400 hover:text-zinc-200"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleGoogleAuth(googleOrgName.trim() || 'My Workspace')}
                disabled={submitting}
                className="px-4 py-1.5 text-xs font-mono font-bold bg-gradient-to-r from-sky-400 to-cyan-400 text-zinc-950 rounded-lg flex items-center gap-1.5 shadow-sm shadow-cyan-500/25"
              >
                {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Continue to SkyOps'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="relative z-10 p-6 text-center text-xs font-mono text-zinc-500 border-t border-cyan-500/10 backdrop-blur-md bg-[#02050d]/60">
        SkyOps • High-Assurance Kubernetes Observability
      </footer>
    </div>
  );
};
