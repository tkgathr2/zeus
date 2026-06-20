import axios from 'axios';
import type { SensorAlert } from '../types/index.js';

const SENTRY_BASE = 'https://sentry.io/api/0';

export async function checkSentry(): Promise<SensorAlert[]> {
  const token = process.env.SENTRY_AUTH_TOKEN;
  const org = process.env.SENTRY_ORG;
  if (!token || !org) return [];

  const alerts: SensorAlert[] = [];

  try {
    const res = await axios.get(`${SENTRY_BASE}/organizations/${org}/issues/`, {
      headers: { Authorization: `Bearer ${token}` },
      params: {
        query: 'is:unresolved',
        sort: 'date',
        limit: 25,
        statsPeriod: '1h',
      },
      timeout: 10000,
    });

    const issues: Array<{ title: string; project: { name: string }; count: string; firstSeen: string }> = res.data ?? [];
    const highCount = issues.filter(i => Number(i.count) >= 10);

    for (const issue of highCount) {
      alerts.push({
        system: `Sentry: ${issue.project?.name ?? org}`,
        severity: Number(issue.count) >= 50 ? 'critical' : 'high',
        title: issue.title,
        rawData: {
          summary: `1時間で${issue.count}件発生`,
          count: issue.count,
          firstSeen: issue.firstSeen,
          project: issue.project?.name,
        },
        detectedAt: new Date().toISOString(),
      });
    }
  } catch (err) {
    console.warn('[Sentry sensor] チェック失敗:', err);
  }

  return alerts;
}
