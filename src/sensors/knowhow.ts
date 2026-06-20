import axios from 'axios';
import type { SensorAlert } from '../types/index.js';

const KNOWHOW_BASE = 'https://knowhow.up.railway.app';

export async function checkKnowHow(): Promise<SensorAlert[]> {
  const apiKey = process.env.KB_API_KEY;
  if (!apiKey) return [];

  const alerts: SensorAlert[] = [];

  try {
    // 直近のしくじり先生カードを参照して再発パターンを検知
    const res = await axios.post(
      `${KNOWHOW_BASE}/api/devin/recall`,
      {
        project_key: 'shikujiri-pdca',
        query: '再発 繰り返し 同じミス',
        top_k: 5,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': apiKey,
        },
        timeout: 10000,
      }
    );

    const results: Array<{ raw_log: string; tags: string[]; created_at: string }> = res.data?.results ?? [];
    const recentRecurrence = results.filter(r =>
      r.raw_log?.includes('再発') || r.tags?.includes('再発')
    );

    if (recentRecurrence.length >= 2) {
      alerts.push({
        system: 'ノウハウキング',
        severity: 'medium',
        title: `過去ミスの再発パターンを検知（${recentRecurrence.length}件）`,
        rawData: {
          summary: `類似のしくじりが${recentRecurrence.length}件記録済み。同じ轍を踏むリスクあり`,
          count: recentRecurrence.length,
          samples: recentRecurrence.slice(0, 2).map(r => r.raw_log?.slice(0, 100)),
        },
        detectedAt: new Date().toISOString(),
      });
    }
  } catch (err) {
    console.warn('[KnowHow sensor] チェック失敗:', err);
  }

  return alerts;
}
