// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import BlockerBadge from '../src/components/BlockerBadge.js';

describe('BlockerBadge', () => {
  it('renders a DECISION badge', () => {
    render(<BlockerBadge type="DECISION" />);
    expect(screen.getByText('DECISION').className).toContain('badge-decision');
  });

  it('renders a CLARIFICATION badge', () => {
    render(<BlockerBadge type="CLARIFICATION" />);
    expect(screen.getByText('CLARIFICATION').className).toContain('badge-clarification');
  });

  it('renders a RISK badge with severity in both the label and the class', () => {
    render(<BlockerBadge type="RISK" severity="critical" />);
    expect(screen.getByText('RISK (critical)').className).toContain('badge-risk-critical');
  });

  it('defaults RISK styling to "low" when no severity is given, with no parens in the label', () => {
    render(<BlockerBadge type="RISK" />);
    expect(screen.getByText('RISK').className).toContain('badge-risk-low');
  });

  it('renders a SUBTASK badge', () => {
    render(<BlockerBadge type="SUBTASK" />);
    expect(screen.getByText('SUBTASK').className).toContain('badge-subtask');
  });

  it('renders a CAPABILITY badge', () => {
    render(<BlockerBadge type="CAPABILITY" />);
    expect(screen.getByText('CAPABILITY').className).toContain('badge-capability');
  });
});
