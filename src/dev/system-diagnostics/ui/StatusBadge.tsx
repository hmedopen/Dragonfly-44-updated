import React from 'react';
import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  ShieldAlert,
  Radio,
  CircleDashed,
  MinusCircle,
  Info,
} from 'lucide-react';
import type {
  CheckSafetyLevel,
  CoverageTier,
  DiagnosticEventStatus,
  DiagnosticHealthStatus,
  DiagnosticSeverity,
} from '../types';

type AnyStatus = DiagnosticHealthStatus | DiagnosticEventStatus | DiagnosticSeverity;

const STATUS_STYLES: Record<
  string,
  {
    label: string;
    classes: string;
    icon: React.ComponentType<{ className?: string }>;
  }
> = {
  healthy: {
    label: 'Healthy',
    classes: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/25',
    icon: CheckCircle2,
  },
  succeeded: {
    label: 'Succeeded',
    classes: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/25',
    icon: CheckCircle2,
  },
  warning: {
    label: 'Warning',
    classes: 'bg-amber-500/10 text-amber-400 border-amber-500/25',
    icon: AlertTriangle,
  },
  degraded: {
    label: 'Degraded',
    classes: 'bg-amber-500/10 text-amber-400 border-amber-500/25',
    icon: AlertTriangle,
  },
  error: {
    label: 'Error',
    classes: 'bg-rose-500/10 text-rose-400 border-rose-500/30',
    icon: XCircle,
  },
  failed: {
    label: 'Failed',
    classes: 'bg-rose-500/10 text-rose-400 border-rose-500/30',
    icon: XCircle,
  },
  critical: {
    label: 'Critical',
    classes: 'bg-rose-500/15 text-rose-300 border-rose-500/40',
    icon: ShieldAlert,
  },
  running: {
    label: 'Running',
    classes: 'bg-sky-500/15 text-sky-400 border-sky-500/30',
    icon: Radio,
  },
  not_checked: {
    label: 'Not Checked',
    classes: 'bg-zinc-900 text-zinc-400 border-white/[0.08]',
    icon: CircleDashed,
  },
  unsupported: {
    label: 'Unsupported',
    classes: 'bg-zinc-900 text-zinc-400 border-white/[0.08]',
    icon: MinusCircle,
  },
  cancelled: {
    label: 'Cancelled',
    classes: 'bg-zinc-900 text-zinc-400 border-white/[0.08]',
    icon: MinusCircle,
  },
  skipped: {
    label: 'Skipped',
    classes: 'bg-zinc-900 text-zinc-400 border-white/[0.08]',
    icon: MinusCircle,
  },
  info: {
    label: 'Info',
    classes: 'bg-zinc-900 text-zinc-300 border-white/[0.08]',
    icon: Info,
  },
};

export interface StatusBadgeProps {
  status: AnyStatus;
  labelOverride?: string;
  compact?: boolean;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({
  status,
  labelOverride,
  compact = false,
}) => {
  const cfg = STATUS_STYLES[status] || STATUS_STYLES.not_checked;
  const Icon = cfg.icon;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded border font-mono uppercase tracking-wider shrink-0 ${
        compact ? 'px-1.5 py-0.5 text-[9px]' : 'px-2 py-0.5 text-[10px]'
      } ${cfg.classes}`}
    >
      <Icon className={compact ? 'w-2.5 h-2.5 shrink-0' : 'w-3 h-3 shrink-0'} aria-hidden="true" />
      <span>{labelOverride || cfg.label}</span>
    </span>
  );
};

export const CoverageBadge: React.FC<{ tier: CoverageTier }> = ({ tier }) => {
  const labelMap: Record<CoverageTier, { label: string; classes: string }> = {
    full: {
      label: 'Full Instrumentation',
      classes: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20',
    },
    partial: {
      label: 'Partial Instrumentation',
      classes: 'bg-amber-500/10 text-amber-300 border-amber-500/20',
    },
    read_only_check: {
      label: 'Read-Only Check',
      classes: 'bg-sky-500/10 text-sky-300 border-sky-500/20',
    },
    unsupported: {
      label: 'Unsupported',
      classes: 'bg-zinc-900 text-zinc-400 border-white/[0.08]',
    },
  };
  const cfg = labelMap[tier];
  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 rounded border font-mono text-[9px] uppercase tracking-wider shrink-0 ${cfg.classes}`}
    >
      {cfg.label}
    </span>
  );
};

export const SafetyBadge: React.FC<{ safety: CheckSafetyLevel }> = ({ safety }) => {
  const cfg =
    safety === 'read_only'
      ? { label: 'Read-Only', classes: 'bg-zinc-900 text-zinc-300 border-white/[0.08]' }
      : safety === 'controlled_test'
      ? { label: 'Controlled Test', classes: 'bg-sky-500/10 text-sky-300 border-sky-500/25' }
      : { label: 'Potentially Modifying', classes: 'bg-amber-500/10 text-amber-300 border-amber-500/30' };

  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 rounded border font-mono text-[9px] uppercase tracking-wider shrink-0 ${cfg.classes}`}
    >
      {cfg.label}
    </span>
  );
};
