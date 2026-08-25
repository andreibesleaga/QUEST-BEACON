'use client';
// BEACON — ErrorBoundary (E8·T-348a; UIUX §4 / ADR-009). A thrown render error inside any panel shows a
// labelled, RECOVERABLE fallback instead of blanking the COP (protects "never a dead-end" at runtime).
// React error boundaries must be class components — this is the one class in the UI kit.
import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { ErrorState } from './error-state.js';
import { useT } from '../../_lib/i18n.js';

export interface ErrorBoundaryProps {
  children: ReactNode;
  /** Custom fallback; receives the error + a reset() that re-mounts the children. */
  fallback?: ((error: Error, reset: () => void) => ReactNode) | undefined;
  /** Label for the default fallback (e.g. the panel name). */
  label?: string | undefined;
  /** Side-effect hook for logging/telemetry. */
  onError?: ((error: Error, info: ErrorInfo) => void) | undefined;
}

interface ErrorBoundaryState {
  error: Error | null;
}

interface BoundaryFallbackProps {
  label?: string | undefined;
  message: string;
  onReset: () => void;
}

/**
 * The default fallback body, as a FUNCTION component: React error boundaries must be classes, and a class
 * cannot call the `useT` hook — so the translated title is resolved one level down, inside a real render.
 */
function BoundaryFallback({ label, message, onReset }: BoundaryFallbackProps): ReactNode {
  const t = useT('ui');
  return (
    <ErrorState
      title={label ? t('errorBoundary.labelledTitle', { label }) : t('errorBoundary.title')}
      description={message}
      onRetry={onReset}
    />
  );
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { error: null };
    this.reset = this.reset.bind(this);
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    this.props.onError?.(error, info);
  }

  reset(): void {
    this.setState({ error: null });
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (error === null) return this.props.children;
    if (this.props.fallback) return this.props.fallback(error, this.reset);
    return <BoundaryFallback label={this.props.label} message={error.message} onReset={this.reset} />;
  }
}
