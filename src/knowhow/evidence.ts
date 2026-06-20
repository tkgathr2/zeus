import axios from 'axios';
import { prisma } from '../db.js';
import type { SensorAlert } from '../types/index.js';

const KNOWHOW_BASE = 'https://knowhow.up.railway.app';

export interface Evidence {
  successRate: number;    // 0-100（実績ベース or AI推定）
  sampleSize: number;     // 根拠となった過去事例数
  avgDurationMin: number; // 平均修正時間
  source: 'historical' | 'ai_estimate'; // 実績か推定か
  relatedCases: string[]; // 参考事例の要約
}

function alertKey(alert: SensorAlert): string {
  return `${alert.system.split(':')[0].toLowerCase()}`;
}

export async function gatherEvidence(alert: SensorAlert): Promise<Evidence> {
  const key = alertKey(alert);
  const apiKey = process.env.KB_API_KEY;

  // 1. 自前DBの過去実績を確認
  const resolutions = await prisma.resolution.findMany({
    where: { alertKey: { contains: key } },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });

  if (resolutions.length >= 3) {
    const successes = resolutions.filter(r => r.success).length;
    const avgDuration = resolutions
      .filter(r => r.durationMin != null)
      .reduce((sum, r) => sum + (r.durationMin ?? 0), 0) / (resolutions.length || 1);

    return {
      successRate: Math.round((successes / resolutions.length) * 100),
      sampleSize: resolutions.length,
      avgDurationMin: Math.round(avgDuration),
      source: 'historical',
      relatedCases: resolutions.slice(0, 3).map(r => r.notes ?? r.solution),
    };
  }

  // 2. ノウハウキングから類似事例を検索
  if (apiKey) {
    try {
      const res = await axios.post(
        `${KNOWHOW_BASE}/api/devin/recall`,
        {
          project_key: 'shikujiri-pdca',
          query: `${alert.system} ${alert.title} 修正 解決`,
          top_k: 10,
        },
        {
          headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey },
          timeout: 8000,
        }
      );

      const results: Array<{ raw_log: string }> = res.data?.results ?? [];
      if (results.length >= 2) {
        // 「D 対策=成功」を含むものを成功とカウント
        const successCount = results.filter(r =>
          r.raw_log?.includes('D 対策') && !r.raw_log?.includes('失敗')
        ).length;

        return {
          successRate: Math.round((successCount / results.length) * 100),
          sampleSize: results.length,
          avgDurationMin: 30, // ノウハウキングには時間情報なし → デフォルト
          source: 'historical',
          relatedCases: results.slice(0, 3).map(r => r.raw_log?.slice(0, 100) ?? ''),
        };
      }
    } catch {
      // ノウハウキング取得失敗はサイレントに無視
    }
  }

  // 3. 実績なし → AI推定として明示
  return {
    successRate: 80,
    sampleSize: 0,
    avgDurationMin: 30,
    source: 'ai_estimate',
    relatedCases: [],
  };
}

export async function recordResolution(
  alert: SensorAlert,
  solution: string,
  success: boolean,
  durationMin?: number
): Promise<void> {
  await prisma.resolution.create({
    data: {
      alertKey: alertKey(alert),
      solution,
      success,
      durationMin,
      notes: `${alert.system}: ${alert.title}`,
    },
  });

  // ノウハウキングにも記録
  const apiKey = process.env.KB_API_KEY;
  if (apiKey) {
    try {
      await axios.post(
        `${KNOWHOW_BASE}/api/devin/memorize`,
        {
          project_key: 'zeus-resolutions',
          tool: 'zeus',
          status: success ? 'success' : 'failure',
          environment: `${alert.system}/${alertKey(alert)}`,
          tags: ['zeus', alert.system, success ? '成功' : '失敗'],
          raw_log: `【Zeus解決記録】${alert.system}: ${alert.title} → ${solution} → ${success ? '成功' : '失敗'}${durationMin ? ` (${durationMin}分)` : ''}`,
        },
        {
          headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey },
          timeout: 8000,
        }
      );
    } catch {
      // サイレントに無視
    }
  }
}
