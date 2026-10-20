import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  /** Region name for the accessible label and the console message. */
  name: string;
  /** When this value changes (e.g. a new graph or model), a caught error is cleared. */
  resetKey: string;
  children: ReactNode;
  className?: string;
}

interface State {
  failedKey: string | null;
}

/**
 * Catches render errors in the viewport / inspector so the sidebar stays usable (spec Phase 5).
 * The message is fixed, app-authored text; error details only go to the console.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { failedKey: null };

  static getDerivedStateFromError(): Partial<State> {
    return { failedKey: '__pending__' };
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error(`${this.props.name} failed to render`, error, info.componentStack);
    this.setState({ failedKey: this.props.resetKey });
  }

  componentDidUpdate(prev: Props): void {
    if (this.state.failedKey !== null && prev.resetKey !== this.props.resetKey) {
      this.setState({ failedKey: null });
    }
  }

  render(): ReactNode {
    if (this.state.failedKey === null) return this.props.children;
    return (
      <div
        role="alert"
        aria-label={this.props.name}
        className={`flex items-center justify-center bg-viewport p-6 ${this.props.className ?? ''}`}
      >
        <div className="max-w-xs text-center">
          <p className="text-sm font-semibold text-text">
            Something went wrong rendering this graph
          </p>
          <p className="mt-1 text-xs text-muted">
            Pick another graph or model in the sidebar. Details are in the browser console.
          </p>
          <button
            type="button"
            onClick={() => this.setState({ failedKey: null })}
            className="mt-3 rounded-md border border-border bg-panel px-3 py-1.5 text-[12px] text-text hover:bg-row-alt"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }
}
