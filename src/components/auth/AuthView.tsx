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
  Server,
  User as UserIcon
} from 'lucide-react';
import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';

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
  const { signInWithEmail, signUpWithEmail, signInWithGoogle, signInWithDemo, sendPasswordReset, error: authError } = useAuth();
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

  const handleFillTestAccount = () => {
    if (mode === 'signup') {
      setOrgName('Acme Site Reliability');
      setDisplayName('Alex Rivera');
      setEmail('dhandesaurav52@gmail.com');
      setPassword('SkyOpsPass2026!');
    } else {
      setEmail('dhandesaurav52@gmail.com');
      setPassword('SkyOpsPass2026!');
    }
  };

  const handleQuickDemoAccess = async () => {
    setLocalError(null);
    try {
      setSubmitting(true);
      const targetEmail = email.trim() || 'dhandesaurav52@gmail.com';
      const targetName = displayName.trim() || 'Alex Rivera (Staff SRE)';
      const targetOrg = orgName.trim() || undefined;
      await signInWithDemo(targetEmail, targetName, targetOrg);
      if (onAuthSuccess) onAuthSuccess();
    } catch (err: any) {
      setLocalError(err.message || 'Demo sign-in failed');
    } finally {
      setSubmitting(false);
    }
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
    <div className="min-h-screen bg-zinc-950 flex flex-col justify-between text-zinc-100 font-sans selection:bg-sky-500/30 selection:text-sky-200">
      {/* Top Bar */}
      <header className="p-6 max-w-7xl w-full mx-auto flex items-center justify-between">
        <button
          onClick={onBackToHome}
          className="flex items-center gap-2 text-xs font-mono text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer group"
        >
          <ArrowLeft className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" />
          Back to Home
        </button>

        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-sky-500 to-sky-700 flex items-center justify-center text-zinc-950 font-black">
            <Server className="w-4 h-4 text-white" />
          </div>
          <span className="text-sm font-bold tracking-tight text-zinc-200">SkyOps</span>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 flex items-center justify-center px-4 py-8">
        <div className="w-full max-w-md space-y-6">
          {/* Card Container */}
          <div className="p-8 rounded-2xl bg-zinc-900/60 border border-zinc-800 shadow-2xl backdrop-blur-sm space-y-6">
            {/* Header */}
            <div className="text-center space-y-1.5">
              <h1 className="text-2xl font-bold tracking-tight text-zinc-100">
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
                <div className="flex items-center justify-between bg-zinc-950 px-2.5 py-1.5 rounded border border-zinc-800 text-[11px] text-zinc-300 font-mono">
                  <span className="truncate mr-2">{currentHostname}</span>
                  <button
                    type="button"
                    onClick={handleCopyDomain}
                    className="text-sky-400 hover:text-sky-300 shrink-0 flex items-center gap-1 font-semibold cursor-pointer"
                  >
                    {copiedDomain ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                    <span>{copiedDomain ? 'Copied!' : 'Copy'}</span>
                  </button>
                </div>
                <div className="pt-1 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="text-[11px] text-emerald-400 flex items-center gap-1.5 font-sans font-medium">
                    <Check className="w-3.5 h-3.5" />
                    <span>Work Email & Password authentication is active below</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      handleFillTestAccount();
                      setLocalError(null);
                    }}
                    className="text-[10px] font-mono text-sky-400 hover:text-sky-300 underline underline-offset-2 text-left cursor-pointer"
                  >
                    Auto-fill credentials & continue →
                  </button>
                </div>
              </div>
            ) : errorMessage ? (
              <div className="p-3.5 rounded-xl bg-rose-950/40 border border-rose-800 text-rose-300 text-xs font-mono flex flex-col gap-2">
                <div className="flex items-start gap-2.5">
                  <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                  <div>{errorMessage}</div>
                </div>
                {(errorMessage.includes('operation-not-allowed') || errorMessage.includes('auth/operation-not-allowed')) && (
                  <div className="pt-1">
                    <button
                      type="button"
                      onClick={handleQuickDemoAccess}
                      className="text-sky-400 hover:text-sky-300 underline font-semibold cursor-pointer text-xs"
                    >
                      Click here to enter workspace directly →
                    </button>
                  </div>
                )}
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
                  className="w-full py-2.5 px-4 bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 hover:border-zinc-700 rounded-xl text-xs font-mono font-medium text-zinc-200 flex items-center justify-center gap-3 transition-all cursor-pointer shadow-xs disabled:opacity-50"
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
                  <div className="border-t border-zinc-800 w-full" />
                  <span className="bg-zinc-900 px-3 text-[11px] font-mono text-zinc-500 uppercase tracking-wider absolute">
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
                    Organization / Workspace Name <span className="text-rose-400">*</span>
                  </label>
                  <div className="relative">
                    <Building2 className="w-4 h-4 text-zinc-500 absolute left-3 top-2.5" />
                    <input
                      type="text"
                      required
                      placeholder="e.g. Acme Cloud Engineering"
                      value={orgName}
                      onChange={(e) => setOrgName(e.target.value)}
                      className="w-full pl-9 pr-3 py-2 text-xs bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-sky-500 font-mono"
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
                      className="w-full pl-9 pr-3 py-2 text-xs bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-sky-500 font-mono"
                    />
                  </div>
                </div>
              )}

              {/* Work Email */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-xs font-mono font-medium text-zinc-300">
                    Work Email <span className="text-rose-400">*</span>
                  </label>
                  <button
                    type="button"
                    onClick={handleFillTestAccount}
                    className="text-[10px] font-mono text-sky-400 hover:text-sky-300 transition-colors"
                  >
                    Auto-fill demo credentials
                  </button>
                </div>
                <div className="relative">
                  <Mail className="w-4 h-4 text-zinc-500 absolute left-3 top-2.5" />
                  <input
                    type="email"
                    required
                    placeholder="name@company.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 text-xs bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-sky-500 font-mono"
                  />
                </div>
              </div>

              {/* Password */}
              {mode !== 'forgot' && (
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="block text-xs font-mono font-medium text-zinc-300">
                      Password <span className="text-rose-400">*</span>
                    </label>
                    {mode === 'signin' && (
                      <button
                        type="button"
                        onClick={() => {
                          setMode('forgot');
                          setLocalError(null);
                        }}
                        className="text-[11px] font-mono text-sky-400 hover:text-sky-300 transition-colors"
                      >
                        Forgot password?
                      </button>
                    )}
                  </div>
                  <div className="relative">
                    <Lock className="w-4 h-4 text-zinc-500 absolute left-3 top-2.5" />
                    <input
                      type="password"
                      required
                      placeholder="••••••••••••"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full pl-9 pr-3 py-2 text-xs bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-sky-500 font-mono"
                    />
                  </div>
                </div>
              )}

              {/* Submit Button */}
              <button
                type="submit"
                id="auth-submit-btn"
                disabled={submitting}
                className="w-full py-2.5 px-4 bg-sky-500 hover:bg-sky-400 text-zinc-950 font-mono font-semibold text-xs rounded-xl shadow-lg shadow-sky-500/10 flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-50 mt-2"
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

              {mode !== 'forgot' && (
                <button
                  type="button"
                  id="auth-instant-demo-btn"
                  onClick={handleQuickDemoAccess}
                  disabled={submitting}
                  className="w-full py-2 px-3 bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 hover:border-zinc-700 text-zinc-300 hover:text-zinc-100 font-mono text-xs rounded-xl flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-50"
                >
                  <Server className="w-3.5 h-3.5 text-sky-400" />
                  <span>Instant Demo Workspace Access (1-Click)</span>
                </button>
              )}
            </form>

            {/* Toggle Modes */}
            <div className="pt-2 border-t border-zinc-800/80 text-center text-xs font-mono text-zinc-400">
              {mode === 'signup' ? (
                <div>
                  Already have an account?{' '}
                  <button
                    onClick={() => {
                      setMode('signin');
                      setLocalError(null);
                    }}
                    className="text-sky-400 hover:text-sky-300 font-semibold cursor-pointer underline"
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
                    className="text-sky-400 hover:text-sky-300 font-semibold cursor-pointer underline"
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
                    className="text-sky-400 hover:text-sky-300 font-semibold cursor-pointer underline"
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
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 max-w-md w-full space-y-4 shadow-2xl">
            <div className="space-y-1">
              <h3 className="text-sm font-bold text-zinc-100">Set Up Your Organization Name</h3>
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
                className="w-full px-3 py-2 text-xs bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-sky-500 font-mono"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-zinc-800">
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
                className="px-4 py-1.5 text-xs font-mono font-semibold bg-sky-500 hover:bg-sky-400 text-zinc-950 rounded-lg flex items-center gap-1.5"
              >
                {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Continue to SkyOps'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="p-6 text-center text-xs font-mono text-zinc-600">
        SkyOps • High-Assurance Kubernetes Observability
      </footer>
    </div>
  );
};
