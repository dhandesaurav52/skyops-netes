import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BookOpen,
  Cpu,
  Database,
  ExternalLink,
  FileText,
  HelpCircle,
  Key,
  Layers,
  Lock,
  Mail,
  Network,
  Radio,
  Server,
  Shield,
  ShieldCheck,
  Terminal,
  Zap
} from 'lucide-react';
import React from 'react';
import { DocTopic } from '../docs/KnowledgeBaseModal';
import { NavigationTab } from './Sidebar';

export interface FooterProps {
  /**
   * If provided, allows direct navigation between application console tabs.
   */
  onNavigateTab?: (tab: NavigationTab) => void;
  /**
   * Triggers the "Add Cluster" onboarding workflow.
   */
  onOpenAddCluster?: () => void;
  /**
   * Opens the SkyOps Technical Reference & Knowledge Base to a specific verified article.
   */
  onOpenDoc: (topic: DocTopic) => void;
  /**
   * Authentication / Getting Started callback.
   */
  onGetStarted?: () => void;
  /**
   * Optional custom container class.
   */
  className?: string;
  /**
   * Whether the user is currently authenticated in the app console.
   */
  isAuthenticated?: boolean;
}

export const Footer: React.FC<FooterProps> = ({
  onNavigateTab,
  onOpenAddCluster,
  onOpenDoc,
  onGetStarted,
  className = '',
  isAuthenticated = false
}) => {
  // Handler for product navigation
  const handleProductClick = (tab: NavigationTab, fallbackTopic?: DocTopic) => {
    if (isAuthenticated && onNavigateTab) {
      onNavigateTab(tab);
    } else if (onGetStarted) {
      onGetStarted();
    } else if (fallbackTopic) {
      onOpenDoc(fallbackTopic);
    }
  };

  const handleConnectClusterClick = () => {
    if (isAuthenticated && onOpenAddCluster) {
      onOpenAddCluster();
    } else {
      onOpenDoc('connect-cluster');
    }
  };

  return (
    <footer
      id="skyops-main-footer"
      className={`border-t border-cyan-500/20 bg-[#02050d] text-zinc-300 font-sans selection:bg-cyan-500/30 selection:text-cyan-100 relative ${className}`}
    >
      {/* Top glowing electric conduit line */}
      <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-cyan-400/40 to-transparent" />

      <div className="max-w-7xl mx-auto px-6 lg:px-12 pt-16 pb-12">
        {/* Main 5-Column Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-10 lg:gap-8 mb-12">
          {/* Column 1: Brand & Identity */}
          <div className="lg:col-span-2 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-sky-400 to-blue-600 flex items-center justify-center text-zinc-950 shadow-md shadow-sky-500/25">
                <Network className="w-4 h-4 text-white" />
              </div>
              <div>
                <span className="text-base font-bold tracking-tight text-white flex items-center gap-2">
                  SkyOps
                  <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-[#060c18] text-cyan-400 border border-cyan-500/30">
                    v1.5
                  </span>
                </span>
                <span className="block text-xs font-mono text-zinc-400 leading-none mt-0.5">
                  Kubernetes Incident Management Platform
                </span>
              </div>
            </div>

            <p className="text-xs text-zinc-400 leading-relaxed max-w-sm">
              Observe, investigate, and safely operate Kubernetes environments with evidence-driven intelligence.
            </p>

            {/* Customer-Oriented Helpful CTA Block */}
            <div className="pt-2">
              <div className="rounded-xl bg-[#060c18]/90 border border-cyan-500/20 p-4 space-y-2.5 max-w-sm electric-circuit-border">
                <div className="flex items-center gap-2 text-xs font-mono font-bold text-white">
                  <Terminal className="w-3.5 h-3.5 text-cyan-400" />
                  Need help connecting your cluster?
                </div>
                <p className="text-[11px] text-zinc-400 leading-normal">
                  Follow the quickstart guide or contact SkyOps support.
                </p>
                <div className="pt-1 flex items-center gap-3">
                  <button
                    id="footer-cta-quickstart-btn"
                    onClick={() => {
                      if (isAuthenticated && onOpenAddCluster) {
                        onOpenAddCluster();
                      } else if (onGetStarted) {
                        onGetStarted();
                      } else {
                        onOpenDoc('quickstart');
                      }
                    }}
                    className="text-xs font-mono font-bold text-cyan-400 hover:text-cyan-300 inline-flex items-center gap-1 transition-colors cursor-pointer group"
                  >
                    <span>Get Started</span>
                    <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
                  </button>
                  <span className="text-zinc-700">•</span>
                  <a
                    id="footer-cta-email-link"
                    href="mailto:skyopsnetes2000@gmail.com"
                    className="text-xs font-mono text-zinc-400 hover:text-white transition-colors"
                  >
                    Ask Support
                  </a>
                </div>
              </div>
            </div>
          </div>

          {/* Column 2: Product (Real Verified Routes Only) */}
          <div className="space-y-3">
            <h4 className="text-xs font-mono font-semibold uppercase tracking-wider text-zinc-200">
              Product
            </h4>
            <ul className="space-y-2 text-xs font-mono">
              <li>
                <button
                  id="footer-product-command-center"
                  onClick={() => handleProductClick('overview', 'quickstart')}
                  className="text-zinc-400 hover:text-zinc-100 transition-colors cursor-pointer text-left"
                >
                  Command Center
                </button>
              </li>
              <li>
                <button
                  id="footer-product-infrastructure"
                  onClick={() => handleProductClick('infrastructure', 'agent-guide')}
                  className="text-zinc-400 hover:text-zinc-100 transition-colors cursor-pointer text-left"
                >
                  Infrastructure
                </button>
              </li>
              <li>
                <button
                  id="footer-product-observability"
                  onClick={() => handleProductClick('observability', 'metrics')}
                  className="text-zinc-400 hover:text-zinc-100 transition-colors cursor-pointer text-left"
                >
                  Observability
                </button>
              </li>
              <li>
                <button
                  id="footer-product-incidents"
                  onClick={() => handleProductClick('incidents', 'incidents')}
                  className="text-zinc-400 hover:text-zinc-100 transition-colors cursor-pointer text-left"
                >
                  Incidents
                </button>
              </li>
              <li>
                <button
                  id="footer-product-services"
                  onClick={() => handleProductClick('services', 'architecture')}
                  className="text-zinc-400 hover:text-zinc-100 transition-colors cursor-pointer text-left"
                >
                  Services
                </button>
              </li>
              <li>
                <button
                  id="footer-product-ai-investigation"
                  onClick={() => {
                    if (isAuthenticated && onNavigateTab) {
                      onNavigateTab('incidents');
                    } else {
                      onOpenDoc('incidents');
                    }
                  }}
                  className="text-zinc-400 hover:text-zinc-100 transition-colors cursor-pointer text-left"
                >
                  AI Investigation
                </button>
              </li>
              <li>
                <button
                  id="footer-product-safe-remediation"
                  onClick={() => {
                    if (isAuthenticated && onNavigateTab) {
                      onNavigateTab('incidents');
                    } else {
                      onOpenDoc('remediation');
                    }
                  }}
                  className="text-zinc-400 hover:text-zinc-100 transition-colors cursor-pointer text-left"
                >
                  Safe Remediation
                </button>
              </li>
            </ul>
          </div>

          {/* Column 3: Learn / Get Started (Answers Questions 2-7, 9) */}
          <div className="space-y-3">
            <h4 className="text-xs font-mono font-semibold uppercase tracking-wider text-zinc-200">
              Get Started
            </h4>
            <ul className="space-y-2 text-xs font-mono">
              <li>
                <button
                  id="footer-learn-getting-started"
                  onClick={() => onOpenDoc('quickstart')}
                  className="text-zinc-400 hover:text-zinc-100 transition-colors cursor-pointer text-left"
                >
                  Getting Started
                </button>
              </li>
              <li>
                <button
                  id="footer-learn-connect-cluster"
                  onClick={handleConnectClusterClick}
                  className="text-zinc-400 hover:text-zinc-100 transition-colors cursor-pointer text-left"
                >
                  Connect Cluster
                </button>
              </li>
              <li>
                <button
                  id="footer-learn-agent-guide"
                  onClick={() => onOpenDoc('agent-guide')}
                  className="text-zinc-400 hover:text-zinc-100 transition-colors cursor-pointer text-left"
                >
                  Agent Guide
                </button>
              </li>
              <li>
                <button
                  id="footer-learn-metrics"
                  onClick={() => onOpenDoc('metrics')}
                  className="text-zinc-400 hover:text-zinc-100 transition-colors cursor-pointer text-left"
                >
                  Metrics
                </button>
              </li>
              <li>
                <button
                  id="footer-learn-logs"
                  onClick={() => onOpenDoc('logs')}
                  className="text-zinc-400 hover:text-zinc-100 transition-colors cursor-pointer text-left"
                >
                  Logs
                </button>
              </li>
              <li>
                <button
                  id="footer-learn-events"
                  onClick={() => onOpenDoc('events')}
                  className="text-zinc-400 hover:text-zinc-100 transition-colors cursor-pointer text-left"
                >
                  Events
                </button>
              </li>
              <li>
                <button
                  id="footer-learn-incident-intelligence"
                  onClick={() => onOpenDoc('incidents')}
                  className="text-zinc-400 hover:text-zinc-100 transition-colors cursor-pointer text-left"
                >
                  Incident Intelligence
                </button>
              </li>
              <li>
                <button
                  id="footer-learn-troubleshooting"
                  onClick={() => onOpenDoc('troubleshooting')}
                  className="text-zinc-400 hover:text-zinc-100 transition-colors cursor-pointer text-left"
                >
                  Troubleshooting
                </button>
              </li>
            </ul>
          </div>

          {/* Column 4: Security & Support */}
          <div className="space-y-6">
            {/* Security Sub-group (Real documented architecture only) */}
            <div className="space-y-3">
              <h4 className="text-xs font-mono font-semibold uppercase tracking-wider text-zinc-200">
                Security
              </h4>
              <ul className="space-y-2 text-xs font-mono">
                <li>
                  <button
                    id="footer-security-model"
                    onClick={() => onOpenDoc('security-model')}
                    className="text-zinc-400 hover:text-zinc-100 transition-colors cursor-pointer text-left"
                  >
                    Security Model
                  </button>
                </li>
                <li>
                  <button
                    id="footer-security-architecture"
                    onClick={() => onOpenDoc('architecture')}
                    className="text-zinc-400 hover:text-zinc-100 transition-colors cursor-pointer text-left"
                  >
                    Architecture
                  </button>
                </li>
                <li>
                  <button
                    id="footer-security-rbac"
                    onClick={() => onOpenDoc('rbac')}
                    className="text-zinc-400 hover:text-zinc-100 transition-colors cursor-pointer text-left"
                  >
                    {'RBAC & Tenant Isolation'}
                  </button>
                </li>
                <li>
                  <button
                    id="footer-security-persistence"
                    onClick={() => onOpenDoc('persistence')}
                    className="text-zinc-400 hover:text-zinc-100 transition-colors cursor-pointer text-left"
                  >
                    {'Data & Persistence'}
                  </button>
                </li>
                <li>
                  <button
                    id="footer-security-api-reference"
                    onClick={() => onOpenDoc('api-reference')}
                    className="text-zinc-400 hover:text-zinc-100 transition-colors cursor-pointer text-left"
                  >
                    API Reference
                  </button>
                </li>
              </ul>
            </div>

            {/* Support Sub-group (Single Official Email) */}
            <div className="space-y-2.5 pt-2 border-t border-zinc-800/80">
              <h4 className="text-xs font-mono font-semibold uppercase tracking-wider text-zinc-200">
                Support
              </h4>
              <ul className="space-y-2 text-xs font-mono">
                <li>
                  <button
                    id="footer-support-troubleshooting"
                    onClick={() => onOpenDoc('troubleshooting')}
                    className="text-zinc-400 hover:text-zinc-100 transition-colors cursor-pointer text-left"
                  >
                    Troubleshooting
                  </button>
                </li>
                <li>
                  <button
                    id="footer-support-contact"
                    onClick={() => onOpenDoc('support')}
                    className="text-zinc-400 hover:text-zinc-100 transition-colors cursor-pointer text-left"
                  >
                    Contact Support
                  </button>
                </li>
                <li className="pt-1">
                  <a
                    id="footer-support-email-link"
                    href="mailto:skyopsnetes2000@gmail.com"
                    className="text-cyan-400 hover:text-cyan-300 transition-colors break-all flex items-center gap-1.5"
                  >
                    <Mail className="w-3.5 h-3.5 shrink-0" />
                    <span>skyopsnetes2000@gmail.com</span>
                  </a>
                </li>
              </ul>
            </div>
          </div>
        </div>

        {/* Bottom Sub-footer */}
        <div className="pt-8 border-t border-zinc-800/60 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs font-mono text-zinc-500">
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            <span className="text-zinc-400">Built for Kubernetes operations</span>
          </div>

          <div className="flex items-center gap-6">
            <button
              onClick={() => onOpenDoc('security-model')}
              className="hover:text-zinc-300 transition-colors cursor-pointer"
            >
              Zero Inbound Ports
            </button>
            <button
              onClick={() => onOpenDoc('api-reference')}
              className="hover:text-zinc-300 transition-colors cursor-pointer"
            >
              REST v1 API
            </button>
            <span className="text-zinc-600">© 2026 SkyOps</span>
          </div>
        </div>
      </div>
    </footer>
  );
};
