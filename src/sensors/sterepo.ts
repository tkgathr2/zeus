import axios from 'axios';
import type { SensorAlert } from '../types/index.js';

const STEREPO_BASE = process.env.STEREPO_URL ?? 'https://sterepo-production.up.railway.app';

export async function checkSterepo(): Promise<SensorAlert[]> {
  const alerts: SensorAlert[] = [];

  try {
    const res = await axios.get(`${STEREPO_BASE}/api/kpi/summary`, {
      timeout: 10000,
      headers: process.env.STEREPO_API_KEY
        ? { Authorization: `Bearer ${process.env.STEREPO_API_KEY}` }
        : {},
    });

    const kpi = res.data as {
      thisWeek?: { interviews?: number; entries?: number; offers?: number };
      lastWeek?: { interviews?: number; entries?: number; offers?: number };
      activeStaff?: number;
    };

    const tw = kpi.thisWeek ?? {};
    const lw = kpi.lastWeek ?? {};

    // 面談数が先週比30%以上減少
    if (lw.interviews && tw.interviews != null) {
      const drop = ((lw.interviews - tw.interviews) / lw.interviews) * 100;
      if (drop >= 30) {
        alerts.push({
          system: 'ステレポ（採用）',
          severity: drop >= 50 ? 'high' : 'medium',
          title: `面談数が先週比${Math.round(drop)}%減少`,
          rawData: {
            summary: `今週${tw.interviews}件 → 先週${lw.interviews}件から${Math.round(drop)}%減`,
            thisWeek: tw.interviews,
            lastWeek: lw.interviews,
            dropRate: drop,
          },
          detectedAt: new Date().toISOString(),
        });
      }
    }

    // 内定数がゼロ（2週間連続）
    if (tw.offers === 0 && lw.offers === 0) {
      alerts.push({
        system: 'ステレポ（採用）',
        severity: 'medium',
        title: '内定ゼロが2週間続いています',
        rawData: {
          summary: '今週・先週とも内定数0件。採用活動を要確認',
          thisWeekOffers: tw.offers,
          lastWeekOffers: lw.offers,
        },
        detectedAt: new Date().toISOString(),
      });
    }
  } catch (err) {
    console.warn('[Sterepo sensor] チェック失敗:', err);
  }

  return alerts;
}
