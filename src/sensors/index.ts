import type { SensorAlert } from '../types/index.js';
import { checkRailway } from './railway.js';
import { checkSentry } from './sentry.js';
import { checkSlack } from './slack.js';
import { checkKnowHow } from './knowhow.js';
import { checkMF } from './mf.js';
import { checkSterepo } from './sterepo.js';
import { checkBacklog } from './backlog.js';
import { checkCalendar } from './calendar.js';
import { checkBrainOS } from './brainos.js';

const ORDER = { critical: 0, high: 1, medium: 2, low: 3 };

export async function collectAlerts(): Promise<SensorAlert[]> {
  const results = await Promise.allSettled([
    checkRailway(),
    checkSentry(),
    checkSlack(),
    checkKnowHow(),
    checkMF(),
    checkSterepo(),
    checkBacklog(),
    checkCalendar(),
    checkBrainOS(),
  ]);

  const alerts: SensorAlert[] = [];
  for (const r of results) {
    if (r.status === 'fulfilled') alerts.push(...r.value);
    else console.warn('[Zeus sensor] エラー:', r.reason);
  }

  alerts.sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);
  return alerts;
}
