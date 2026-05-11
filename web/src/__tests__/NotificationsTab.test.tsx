import { describe, expect, it } from 'vitest';
import source from '../components/settings/tabs/NotificationsTab.tsx?raw';

describe('NotificationsTab Hermes cutover settings', () => {
  it('does not expose legacy OpenClaw mode or gateway fields', () => {
    expect(source).toContain('HermesAgent API');
    expect(source).toContain('http://127.0.0.1:8642');
    expect(source).not.toContain('Legacy Gateway Alias');
    expect(source).not.toContain('value="openclaw"');
    expect(source).not.toContain('openclawGatewayUrl');
    expect(source).not.toContain('openclawGatewayToken');
    expect(source).not.toContain('127.0.0.1:18789');
    expect(source).not.toContain('CLAWDBOT');
    expect(source).not.toContain('/hooks/agent');
    expect(source).not.toContain('/tools/invoke');
  });

  it('renders Hermes gateway fields only for supported hermes mode', () => {
    expect(source).toContain("webhookMode === 'hermes'");
    expect(source).not.toContain("webhookMode === 'openclaw'");
    expect(source).toContain('hermesGatewayUrl');
    expect(source).toContain('hermesGatewayToken');
  });
});
