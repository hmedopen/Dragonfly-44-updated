import React, { useEffect } from 'react';
import { bootstrapSystemDiagnostics, getSystemDiagnosticsEngine } from '../bootstrap';
import { DiagnosticStudioWindow } from './DiagnosticStudioWindow';

export interface DiagnosticStudioHostProps {
  isOpen: boolean;
  onClose: () => void;
  onToggle: () => void;
}

class DiagnosticErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; errorMessage: string }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, errorMessage: '' };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, errorMessage: error?.message || 'Diagnostic UI error' };
  }

  componentDidCatch(error: Error) {
    try {
      getSystemDiagnosticsEngine().emit({
        subsystem: 'rendering-ui',
        component: 'DiagnosticStudioBoundary',
        operation: 'renderDiagnosticUI',
        eventType: 'error',
        severity: 'error',
        status: 'failed',
        explanation: `Diagnostic Studio UI caught an isolated rendering error: ${error?.message || 'Unknown error'}`,
        error,
      });
    } catch {
      // Never propagate from diagnostic UI
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="fixed bottom-4 right-4 z-50 p-3 rounded-lg bg-[#12131a] border border-rose-500/30 text-xs font-mono text-rose-300 shadow-2xl">
          Diagnostic Studio encountered an isolated UI error: {this.state.errorMessage}
        </div>
      );
    }
    return this.props.children;
  }
}

export const DiagnosticStudioHost: React.FC<DiagnosticStudioHostProps> = ({
  isOpen,
  onClose,
  onToggle,
}) => {
  useEffect(() => {
    bootstrapSystemDiagnostics();
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        onToggle();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onToggle]);

  if (!isOpen) return null;

  return (
    <DiagnosticErrorBoundary>
      <DiagnosticStudioWindow onClose={onClose} />
    </DiagnosticErrorBoundary>
  );
};

export default DiagnosticStudioHost;
