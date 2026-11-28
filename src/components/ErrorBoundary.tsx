"use client";

import React from "react";

/**
 * Top-level error boundary for the Z Trading Terminal.
 *
 * Catches any uncaught render-time exception in the React tree (including
 * errors thrown by child components, hooks, or synchronous effects during
 * render) and shows a fallback UI instead of the default Next.js
 * "Application error: a client-side exception has occurred" white page.
 *
 * The fallback includes the error message and a Reload button so the user
 * can recover without leaving the page. Errors are also logged to the
 * browser console for debugging.
 *
 * Note: error boundaries do NOT catch errors in async callbacks, event
 * handlers, or setTimeout/setInterval callbacks. Those must be wrapped in
 * try/catch at the call site. This boundary is the safety net for render
 * errors that would otherwise crash the entire app.
 */
interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    // Log to console for debugging. Vercel's runtime picks this up too.
    console.error("[ErrorBoundary] Uncaught render error:", error, info);
  }

  render(): React.ReactNode {
    if (this.state.hasError) {
      const message =
        this.state.error?.message ||
        "An unexpected error occurred while rendering the terminal.";
      return (
        <div className="flex min-h-screen items-center justify-center bg-[#0a0e17] p-4">
          <div className="max-w-md rounded-lg border border-[var(--panel-border)] bg-[#0d1117] p-6 text-center">
            <h2 className="mb-2 text-lg font-bold text-foreground">
              Something went wrong
            </h2>
            <p className="mb-4 text-sm text-muted-foreground">{message}</p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded-md bg-[var(--bull)] px-4 py-2 text-sm font-semibold text-[#0a0e17] transition-opacity hover:opacity-90"
            >
              Reload page
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
