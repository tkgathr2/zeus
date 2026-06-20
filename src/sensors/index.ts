import type { SensorAlert } from '../types/index.js';
import { checkRailway } from './railway.js';
import { checkSentry } from './sentry.js';
import { checkSlack } from './slack.js';
import { checkKnowHow } from './knowhow.js';

export async function collectAlerts(): Promise<SensorAlert[]> {
  const results = await Promise.allSettled([
    checkRailway(),
    checkSentry(),
    checkSlack(),
    checkKnowHow(),
  ]);

  const alerts: SensorAlert[] = [];
  for (const r of results) {
    if (r.status === 'fulfilled') {
      alerts.push(...r.value);
    } else {
      console.warn('[Zeus sensor] エラー:', r.reason);
    }
  }

  // severity順にソート（critical > high > medium > low）
  const order = { critical: 0, high: 1, medium: 2, low: 3 };
  alerts.sort((a, b) => order[a.severity] - order[b.severity]);

  return alerts;
}
