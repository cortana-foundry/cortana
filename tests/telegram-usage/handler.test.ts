import {
  formatDuration,
  formatNumber,
  getQuotaIndicator,
  generateUsageReport,
  parseContextData,
} from '../../skills/telegram-usage/handler';

describe('skills/telegram-usage/handler', () => {
  it('formatDuration handles minute/hour boundaries', () => {
    expect(formatDuration(0)).toBe('0m');
    expect(formatDuration(60000)).toBe('1m');
    expect(formatDuration(3600000)).toBe('1h 0m');
    expect(formatDuration(7200000 + 5 * 60000)).toBe('2h 5m');
  });

  it('formatNumber adds thousands separators', () => {
    expect(formatNumber(0)).toBe('0');
    expect(formatNumber(1234)).toBe('1,234');
    expect(formatNumber(1234567)).toBe('1,234,567');
  });

  it('getQuotaIndicator returns emoji by threshold', () => {
    expect(getQuotaIndicator(80)).toBe('🟢');
    expect(getQuotaIndicator(60)).toBe('🟡');
    expect(getQuotaIndicator(30)).toBe('🟠');
    expect(getQuotaIndicator(10)).toBe('🔴');
  });

  it('generateUsageReport includes expected sections and values', () => {
    const report = generateUsageReport({ quotaRemaining: 82, sessionTimeRemaining: 3600000 });
    expect(report).toContain('📊 API Usage');
    expect(report).toContain('🔋 Quota: 🟢 82%');
    expect(report).toContain('⏱️ Resets in: 1h 0m');
  });

  it('parseContextData handles valid and null input', () => {
    expect(parseContextData('1856 / 4096')).toEqual({ used: 1856, total: 4096 });
    expect(parseContextData(null)).toBeNull();
    expect(parseContextData('no tokens')).toBeNull();
  });
});
