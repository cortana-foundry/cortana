import {
  getSessionStorePath,
  getNextResetTime,
  getTimeUntilReset,
  formatDuration,
  getQuotaIndicator,
  estimateContextUsage,
  collectUsageStats,
} from '../../skills/telegram-usage/session-reader';

describe('skills/telegram-usage/session-reader', () => {
  it('getSessionStorePath returns expected structure', () => {
    const p = getSessionStorePath('main');
    expect(p).toContain('.openclaw');
    expect(p).toContain('/agents/main/sessions/sessions.json');
  });

  it('getNextResetTime returns a future Date', () => {
    const reset = getNextResetTime(4);
    expect(reset).toBeInstanceOf(Date);
    expect(reset.getTime()).toBeGreaterThan(Date.now());
  });

  it('getTimeUntilReset returns positive number', () => {
    expect(getTimeUntilReset(4)).toBeGreaterThan(0);
  });

  it('formatDuration formats expected values', () => {
    expect(formatDuration(0)).toBe('0m');
    expect(formatDuration(3600000)).toBe('1h 0m');
  });

  it('getQuotaIndicator returns threshold emojis', () => {
    expect(getQuotaIndicator(75)).toBe('🟢');
    expect(getQuotaIndicator(50)).toBe('🟡');
    expect(getQuotaIndicator(25)).toBe('🟠');
    expect(getQuotaIndicator(24)).toBe('🔴');
  });

  it('estimateContextUsage uses known model windows', () => {
    const usage = estimateContextUsage(
      {
        sessionId: 's1',
        updatedAt: new Date().toISOString(),
        inputTokens: 100,
        outputTokens: 100,
        totalTokens: 200,
        contextTokens: 1000,
        model: 'gpt-4-turbo',
        provider: 'openai',
      },
      'gpt-4-turbo',
    );

    expect(usage.total).toBe(8192);
    expect(usage.used).toBe(1000);
    expect(usage.percentage).toBeGreaterThanOrEqual(0);
  });

  it('collectUsageStats returns default structure when session not found', () => {
    const stats = collectUsageStats('missing-session-key', { agentId: `missing-${Date.now()}` });
    expect(stats.sessionFound).toBe(false);
    expect(stats.model).toBe('Unknown');
    expect(stats.totalTokens).toEqual({ input: 0, output: 0 });
    expect(stats.contextUsage).toEqual({ used: 0, total: 4096 });
  });
});
