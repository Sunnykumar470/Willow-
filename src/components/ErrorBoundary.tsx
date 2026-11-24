import React from 'react';

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  render() {
    if (this.state.error) {
      let friendly = this.state.error.message || 'An unexpected error occurred.';
      try {
        const parsed = JSON.parse(friendly) as { error?: string; operationType?: string; path?: string };
        if (parsed.error) {
          friendly = `${parsed.error}${parsed.path ? ` (${parsed.operationType || 'op'} on ${parsed.path})` : ''}`;
        }
      } catch {
        // non-JSON message
      }

      return (
        <div className="min-h-screen flex items-center justify-center bg-[#F0F2F5] dark:bg-[#0B141A] p-4">
          <div className="max-w-md w-full bg-white dark:bg-[#202C33] border border-[#D1D7DB] dark:border-[#2A3942] rounded-2xl p-6 shadow-xl space-y-4 text-center">
            <h2 className="text-lg font-bold text-[#111B21] dark:text-[#E9EDEF]">
              Something went wrong
            </h2>
            <p className="text-xs text-[#54656F] dark:text-[#8696A0] break-words">
              {friendly}
            </p>
            <button
              type="button"
              onClick={() => {
                this.setState({ error: null });
                window.location.reload();
              }}
              className="px-4 py-2 rounded-xl bg-[#00A884] hover:bg-[#008F6F] text-white text-xs font-semibold"
            >
              Reload Willow
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
