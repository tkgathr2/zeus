import axios from 'axios';
import type { SensorAlert } from '../types/index.js';

const HEALTH_URL = 'https://brainos-web-git-master-atsuhiro-takagis-projects.vercel.app/api/health';

export async function checkBrainOS(): Promise<SensorAlert[]> {
  const alerts: SensorAlert[] = [];

  try {
    const res = await axios.get(HEALTH_URL, { timeout: 10000 });
    const data = res.data as { ok: boolean; db?: string; timestamp?: string; version?: string };

    if (!data.ok || data.db !== 'ok') {
      alerts.push({
        system: 'BrainOS',
        severity: 'high',
        title: `BrainOS ヘルスチェック異常: db=${data.db ?? 'unknown'}`,
        rawData: {
          summary: 'BrainOS /api/health が異常を返しました',
          healthResponse: data,
          url: HEALTH_URL,
        },
        detectedAt: new Date().toISOString(),
      });
    }
  } catch (err) {
    alerts.push({
      system: 'BrainOS',
      severity: 'critical',
      title: 'BrainOS ヘルスエンドポイント到達不可',
      rawData: {
        summary: '/api/health へのリクエストが失敗しました',
        error: String(err),
        url: HEALTH_URL,
      },
      detectedAt: new Date().toISOString(),
    });
  }

  return alerts;
}
