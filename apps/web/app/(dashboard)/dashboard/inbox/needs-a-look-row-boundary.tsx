"use client";

import { Component, type ReactNode } from "react";

interface NeedsALookRowBoundaryProps {
  children: ReactNode;
}

interface NeedsALookRowBoundaryState {
  failed: boolean;
}

/**
 * One row's error boundary: a row that fails to render is left out, and the
 * rest of the list stays. A class, as React offers error boundaries only so.
 */
export class NeedsALookRowBoundary extends Component<
  NeedsALookRowBoundaryProps,
  NeedsALookRowBoundaryState
> {
  state: NeedsALookRowBoundaryState = { failed: false };

  static getDerivedStateFromError(): NeedsALookRowBoundaryState {
    return { failed: true };
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}
