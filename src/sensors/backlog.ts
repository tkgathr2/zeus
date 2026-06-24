import axios from 'axios';
import type { SensorAlert } from '../types/index.js';

const BACKLOG_BASE = 'https://takagigr.backlog.com/api/v2';

export async function checkBacklog(): Promise<SensorAlert[]> {
  const apiKey = process.env.BACKLOG_API_KEY;
  if (!apiKey) return [];

  const alerts: SensorAlert[] = [];
  const now = new Date();

  try {
    // 期限切れ未完了タスクを取得
    const res = await axios.get(`${BACKLOG_BASE}/issues`, {
      params: {
        apiKey,
        statusId: [1, 2, 3], // 未対応・処理中・処理済み
        dueDateUntil: now.toISOString().split('T')[0],
        count: 50,
      },
      timeout: 10000,
    });

    const issues: Array<{
      id: number;
      summary: string;
      dueDate: string;
      priority: { name: string };
      projectId: number;
    }> = res.data ?? [];

    const overdueHigh = issues.filter(i => i.priority?.name === '高');

    if (overdueHigh.length > 0) {
      alerts.push({
        system: 'Backlog',
        severity: overdueHigh.length >= 3 ? 'high' : 'medium',
        title: `優先度「高」の期限切れタスクが${overdueHigh.length}件`,
        rawData: {
          summary: `優先度高タスク${overdueHigh.length}件が期限切れで未完了`,
          count: overdueHigh.length,
          tasks: overdueHigh.slice(0, 5).map(i => ({
            id: i.id,
            summary: i.summary,
            dueDate: i.dueDate,
          })),
        },
        detectedAt: new Date().toISOString(),
      });
    }

    if (issues.length >= 20) {
      alerts.push({
        system: 'Backlog',
        severity: 'low',
        title: `期限切れタスクが${issues.length}件以上滞留`,
        rawData: {
          summary: `${issues.length}件以上のタスクが期限切れ。要棚卸し`,
          count: issues.length,
        },
        detectedAt: new Date().toISOString(),
      });
    }
  } catch (err) {
    console.warn('[Backlog sensor] チェック失敗:', err);
  }

  return alerts;
}
