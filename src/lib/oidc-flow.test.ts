import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerFlow, peekFlow, takeFlow, FLOW_POLICY, FLOW_COOKIE } from './oidc-flow';

describe('oidc-flow', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('registers a flow and returns a state token', async () => {
    const { registerFlow: reg } = await import('./oidc-flow');
    const state = reg({ slug: 'hris', verifier: 'verifier-abc' });
    expect(typeof state).toBe('string');
    expect(state.length).toBeGreaterThan(0);
  });

  it('peekFlow returns the registered flow', async () => {
    const { registerFlow: reg, peekFlow: peek } = await import('./oidc-flow');
    const state = reg({ slug: 'hris', verifier: 'verifier-abc' });
    const flow = peek(state);
    expect(flow).not.toBeNull();
    expect(flow!.slug).toBe('hris');
    expect(flow!.verifier).toBe('verifier-abc');
  });

  it('peekFlow returns null for unknown state', async () => {
    const { peekFlow: peek } = await import('./oidc-flow');
    expect(peek('unknown-state')).toBeNull();
  });

  it('takeFlow removes the flow (single-use)', async () => {
    const { registerFlow: reg, takeFlow: take } = await import('./oidc-flow');
    const state = reg({ slug: 'hris', verifier: 'verifier-abc' });
    const first = take(state);
    expect(first).not.toBeNull();
    expect(first!.slug).toBe('hris');
    const second = take(state);
    expect(second).toBeNull();
  });

  it('peekFlow does not consume the flow', async () => {
    const { registerFlow: reg, peekFlow: peek } = await import('./oidc-flow');
    const state = reg({ slug: 'hris', verifier: 'verifier-abc' });
    expect(peek(state)).not.toBeNull();
    expect(peek(state)).not.toBeNull();
  });

  it('peekFlow returns null after expiry', async () => {
    const { registerFlow: reg, peekFlow: peek } = await import('./oidc-flow');
    vi.useFakeTimers();
    const state = reg({ slug: 'hris', verifier: 'verifier-abc' });
    expect(peek(state)).not.toBeNull();
    vi.advanceTimersByTime(FLOW_POLICY.ttlMs + 1000);
    expect(peek(state)).toBeNull();
    vi.useRealTimers();
  });

  it('takeFlow returns null after expiry', async () => {
    const { registerFlow: reg, takeFlow: take } = await import('./oidc-flow');
    vi.useFakeTimers();
    const state = reg({ slug: 'hris', verifier: 'verifier-abc' });
    vi.advanceTimersByTime(FLOW_POLICY.ttlMs + 1000);
    expect(take(state)).toBeNull();
    vi.useRealTimers();
  });

  it('FLOW_COOKIE is the expected cookie name', async () => {
    const { FLOW_COOKIE: cookie } = await import('./oidc-flow');
    expect(cookie).toBe('lgu_oidc_flow');
  });

  it('FLOW_POLICY matches documented values', async () => {
    const { FLOW_POLICY: policy } = await import('./oidc-flow');
    expect(policy.ttlMs).toBe(10 * 60 * 1000);
    expect(policy.maxPending).toBe(500);
  });
});
