/**
 * GEON'S GAMEHUB - subjectStats.js
 * Subject statistics boundary (per questioner, per subject):
 * plays, correct, wrong, best score, best streak, reviewed count, accuracy.
 */
import { GAME } from '../gameCore.js';

export function statsFor(state, questioner, subject) {
  const q = GAME.QUESTIONERS.includes(questioner) ? questioner : 'previous';
  return state.stats[q][subject];
}

export function accuracy(state, questioner, subject) {
  const s = statsFor(state, questioner, subject);
  if (!s) return 0;
  const total = s.correct + s.wrong;
  if (!total) return 0;
  return Math.round((s.correct / total) * 100);
}

/** All subjects' stats for a questioner (for the profile/leaderboards). */
export function allStats(state, questioner) {
  const q = GAME.QUESTIONERS.includes(questioner) ? questioner : 'previous';
  return GAME.SUBJECTS.map((subject) => {
    const s = state.stats[q][subject];
    const total = s.correct + s.wrong;
    return {
      subject,
      ...s,
      accuracy: total ? Math.round((s.correct / total) * 100) : 0,
    };
  });
}
