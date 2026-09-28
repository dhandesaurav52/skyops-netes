import React from 'react';
import { Network } from 'lucide-react';

interface SkyOpsLogoProps {
  compact?: boolean;
  className?: string;
}

export const SkyOpsLogo: React.FC<SkyOpsLogoProps> = ({ compact = false, className = '' }) => (
  <span className={`inline-flex items-center gap-2.5 ${className}`} aria-label="SkyOps">
    <span className="w-7 h-7 rounded-lg bg-gradient-to-br from-sky-400 to-blue-600 flex items-center justify-center shadow-md shadow-sky-500/25" aria-hidden="true">
      <Network className="w-4 h-4 text-white" />
    </span>
    {!compact && <span className="font-bold tracking-tight text-white">SkyOps</span>}
  </span>
);
