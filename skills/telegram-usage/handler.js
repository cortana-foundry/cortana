#!/usr/bin/env node

/**
 * Telegram /usage Command Handler
 * Displays session usage statistics in a clean, formatted message
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

/**
 * Format a time duration in milliseconds to human-readable string
 */
function formatDuration(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

/**
 * Format a number with thousands separator
 */
function formatNumber(n) {
  return n.toLocaleString('en-US');
}

/**
 * Calculate percentage bar with emoji indicators
 */
function getQuotaIndicator(percentage) {
  if (percentage >= 75) return '🟢'; // Good
  if (percentage >= 50) return '🟡'; // Warning
  if (percentage >= 25) return '🟠'; // Low
  return '🔴'; // Critical
}

/**
 * Get real quota data from clawdbot models status
 */
function getRealQuotaData() {
  const commands = [
    // OpenClaw is the active runtime here
    'openclaw models status',
    // Legacy fallback
    'clawdbot models status'
  ];

  for (const cmd of commands) {
    try {
      const output = execSync(cmd, { encoding: 'utf-8' });

      // Parse lines like:
      // "- openai-codex usage: 5h 87% left ⏱37m · Day 94% left ⏱1d 16h"
      // "- anthropic usage: 5h 58% left ⏱1h 1m"
      const usageLine = output.split('\n').find(line => line.includes(' usage: '));
      if (!usageLine) continue;

      const pctMatch = usageLine.match(/(\d+)%\s+left/);
      const timeMatch = usageLine.match(/⏱\s*([^·\n]+)/);

      if (pctMatch) {
        const percentage = parseInt(pctMatch[1], 10);
        const timeRemaining = (timeMatch?.[1] || '0m').trim();
        const timeMs = parseTimeToMs(timeRemaining);

        return {
          quotaRemaining: percentage,
          sessionTimeRemaining: timeMs,
          timeRemainingFormatted: timeRemaining
        };
      }
    } catch (error) {
      // Try next command
    }
  }

  // Unknown/unavailable => return null-ish instead of false critical 0%
  return {
    quotaRemaining: null,
    sessionTimeRemaining: null,
    timeRemainingFormatted: 'unknown'
  };
}

/**
 * Parse time string like "1h 1m" to milliseconds
 */
function parseTimeToMs(timeStr) {
  let totalMs = 0;

  const hourMatch = timeStr.match(/(\d+)h/);
  if (hourMatch) {
    totalMs += parseInt(hourMatch[1], 10) * 60 * 60 * 1000;
  }

  const minMatch = timeStr.match(/(\d+)m/);
  if (minMatch) {
    totalMs += parseInt(minMatch[1], 10) * 60 * 1000;
  }

  return totalMs;
}

/**
 * Get quota tracker file path
 */
function getQuotaTrackerPath() {
  const homeDir = process.env.HOME || process.env.USERPROFILE;
  return path.join(homeDir, '.openclaw', 'quota-tracker.json');
}

/**
 * Read quota start time from tracker
 */
function getQuotaStartTime() {
  const trackerPath = getQuotaTrackerPath();

  if (!fs.existsSync(trackerPath)) {
    // Create new tracker with current time
    const quotaData = {
      startTime: Date.now(),
      resetHours: 4
    };
    try {
      fs.writeFileSync(trackerPath, JSON.stringify(quotaData, null, 2));
    } catch (error) {
      console.error('Failed to create quota tracker:', error.message);
    }
    return quotaData;
  }

  try {
    const data = JSON.parse(fs.readFileSync(trackerPath, 'utf-8'));
    return data;
  } catch (error) {
    console.error('Failed to read quota tracker:', error.message);
    return { startTime: Date.now(), resetHours: 4 };
  }
}

/**
 * Calculate time remaining until quota reset (4 hours from start)
 */
function getTimeUntilReset() {
  const quotaData = getQuotaStartTime();
  const resetHours = quotaData.resetHours || 4;
  const resetTime = quotaData.startTime + (resetHours * 60 * 60 * 1000);
  const timeRemaining = resetTime - Date.now();

  // If quota period has passed, reset it
  if (timeRemaining <= 0) {
    const trackerPath = getQuotaTrackerPath();
    const newQuotaData = {
      startTime: Date.now(),
      resetHours: resetHours
    };
    try {
      fs.writeFileSync(trackerPath, JSON.stringify(newQuotaData, null, 2));
    } catch (error) {
      console.error('Failed to reset quota tracker:', error.message);
    }
    return resetHours * 60 * 60 * 1000; // Return full period
  }

  return timeRemaining;
}

/**
 * Generate usage report message
 * @param {Object} stats - Session statistics
 * @returns {string} Formatted Telegram message
 */
function generateUsageReport(stats) {
  const {
    quotaRemaining = null,
    sessionTimeRemaining = null,
    provider = 'anthropic'
  } = stats;

  const quotaKnown = Number.isFinite(quotaRemaining);
  const timeKnown = Number.isFinite(sessionTimeRemaining);

  const quotaIndicator = quotaKnown ? getQuotaIndicator(quotaRemaining) : '⚪️';
  const timeRemaining = timeKnown ? formatDuration(sessionTimeRemaining) : 'unknown';

  let message = `📊 API Usage\n\n`;
  message += `🔋 Quota: ${quotaIndicator} ${quotaKnown ? `${quotaRemaining}%` : 'unknown'}\n`;
  message += `⏱️ Resets in: ${timeRemaining}`;

  return message;
}

/**
 * Parse status/context data if provided
 */
function parseContextData(contextInfo) {
  if (!contextInfo) return null;
  
  // Extract token counts from context info
  const tokenMatch = contextInfo.match(/(\d+)\s*\/\s*(\d+)/);
  if (tokenMatch) {
    return {
      used: parseInt(tokenMatch[1]),
      total: parseInt(tokenMatch[2])
    };
  }
  return null;
}

/**
 * Main handler
 */
async function main() {
  // Parse command arguments if any
  const args = process.argv.slice(2);
  const command = args[0] || 'report';

  // Get real quota data from clawdbot
  const quotaData = getRealQuotaData();

  // Default session statistics
  // In a real implementation, these would come from the gateway API or session state
  const stats = {
    quotaRemaining: quotaData.quotaRemaining,
    sessionTimeRemaining: quotaData.sessionTimeRemaining,
    totalTokens: {
      input: 2847,
      output: 1523
    },
    contextUsage: {
      used: 1856,
      total: 4096
    },
    model: 'Claude 3.5 Haiku',
    provider: 'anthropic'
  };

  if (command === 'report') {
    const report = generateUsageReport(stats);
    console.log(report);
    process.exit(0);
  }

  if (command === 'json') {
    console.log(JSON.stringify(stats, null, 2));
    process.exit(0);
  }

  // Unknown command
  console.error(`Unknown command: ${command}`);
  process.exit(1);
}

// Export for use as module
module.exports = {
  generateUsageReport,
  formatDuration,
  formatNumber,
  getQuotaIndicator,
  parseContextData,
  getQuotaStartTime,
  getTimeUntilReset
};

// Run if invoked directly
if (require.main === module) {
  main().catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
  });
}
