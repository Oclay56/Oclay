"use client";

import React from "react";
import { ErrorState } from "./ErrorState";

interface RouteErrorBoundaryProps {
  children: React.ReactNode;
}

interface RouteErrorBoundaryState {
  error: Error | null;
}

export class RouteErrorBoundary extends React.Component<
  RouteErrorBoundaryProps,
  RouteErrorBoundaryState
> {
  state: RouteErrorBoundaryState = {
    error: null,
  };

  static getDerivedStateFromError(error: Error): RouteErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error("Route render failed", error, info);
  }

  private handleRetry = (): void => {
    this.setState({ error: null });
    window.location.reload();
  };

  render() {
    if (this.state.error) {
      return (
        <ErrorState
          title="Page failed to render"
          description={this.state.error.message || "Unknown renderer error."}
          onRetry={this.handleRetry}
        />
      );
    }

    return this.props.children;
  }
}
