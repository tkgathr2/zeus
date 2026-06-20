import axios from 'axios';
import type { SensorAlert } from '../types/index.js';

export async function checkCalendar(): Promise<SensorAlert[]> {
  const token = process.env.GOOGLE_CALENDAR_ACCESS_TOKEN;
  if (!token) return [];

  const alerts: SensorAlert[] = [];
  const now = new Date();
  const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  try {
    const res = await axios.get(
      'https://www.googleapis.com/calendar/v3/calendars/atsuhiro@takagi.bz/events',
      {
        params: {
          timeMin: now.toISOString(),
          timeMax: in24h.toISOString(),
          singleEvents: true,
          orderBy: 'startTime',
        },
        headers: { Authorization: `Bearer ${token}` },
        timeout: 10000,
      }
    );

    const events: Array<{
      summary?: string;
      start?: { dateTime?: string };
      description?: string;
    }> = res.data?.items ?? [];

    // 2時間以内に重要な予定があるか
    const in2h = new Date(now.getTime() + 2 * 60 * 60 * 1000);
    const urgent = events.filter(e => {
      const start = e.start?.dateTime ? new Date(e.start.dateTime) : null;
      return start && start <= in2h;
    });

    // 大事な予定なのに準備関連タスクがBacklogに残ってる可能性を指摘
    for (const e of urgent) {
      const title = e.summary ?? '予定';
      if (
        title.includes('打合') ||
        title.includes('面談') ||
        title.includes('ミーティング') ||
        title.includes('商談')
      ) {
        const startStr = e.start?.dateTime
          ? new Date(e.start.dateTime).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })
          : '';
        alerts.push({
          system: 'Google カレンダー',
          severity: 'low',
          title: `2時間以内に重要な予定：${title}`,
          rawData: {
            summary: `${startStr}「${title}」があります。資料・準備の確認を推奨`,
            eventTitle: title,
            startTime: e.start?.dateTime,
          },
          detectedAt: new Date().toISOString(),
        });
      }
    }
  } catch (err) {
    console.warn('[Calendar sensor] チェック失敗:', err);
  }

  return alerts;
}
