import axios from 'axios';
import type { SensorAlert } from '../types/index.js';

// MFクラウド会計 API（高木産業・日本交通誘導）
const MF_BASE = 'https://api.mfkessai.co.jp/v2';

export async function checkMF(): Promise<SensorAlert[]> {
  const token = process.env.MF_ACCESS_TOKEN;
  if (!token) return [];

  const alerts: SensorAlert[] = [];

  try {
    // 口座残高確認
    const res = await axios.get(`${MF_BASE}/accounts`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      timeout: 10000,
    });

    const accounts: Array<{ name: string; balance: number; account_type: string }> = res.data?.accounts ?? [];

    for (const acc of accounts) {
      // 普通預金で残高が100万円未満
      if (acc.account_type === '普通' && acc.balance < 1_000_000) {
        alerts.push({
          system: 'MFクラウド会計',
          severity: acc.balance < 300_000 ? 'critical' : 'high',
          title: `口座残高不足：${acc.name}`,
          rawData: {
            summary: `${acc.name} の残高が ${(acc.balance / 10000).toFixed(1)}万円に低下`,
            balance: acc.balance,
            accountName: acc.name,
          },
          detectedAt: new Date().toISOString(),
        });
      }
    }
  } catch (err) {
    console.warn('[MF sensor] チェック失敗:', err);
  }

  return alerts;
}
