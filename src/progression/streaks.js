/**
 * GEON'S GAMEHUB - streaks.js
 * Streak logic boundary: multiplier/milestone lookups and streak bookkeeping
 * helpers. Numbers come from the documented tables in gameCore.
 */
import { multiplierForStreak, milestoneForStreak, STREAK_MILESTONES } from '../gameCore.js';

export { multiplierForStreak, milestoneForStreak };

export function nextMilestone(streak) {
  const thresholds = Object.keys(STREAK_MILESTONES).map(Number).sort((a, b) => a - b);
  return thresholds.find((t) => t > streak) || null;
}

export function describeStreak(streak) {
  const milestone = milestoneForStreak(streak);
  if (milestone) return milestone.name;
  if (streak >= 20) return 'LEGENDARY STREAK';
  if (streak >= 10) return 'UNSTOPPABLE';
  if (streak >= 5) return 'ON FIRE';
  if (streak >= 3) return 'HOT START';
  return streak > 0 ? `${streak} in a row` : 'No streak';
}
