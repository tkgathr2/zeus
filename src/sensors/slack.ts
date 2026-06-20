import axios from 'axios';
import type { SensorAlert } from '../types/index.js';

export async function checkSlack(): Promise<SensorAlert[]> {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) return [];

  const alerts: SensorAlert[] = [];

  try {
    // エラー系キーワードを含むメッセージを検索
    const res = await axios.get('https://slack.com/api/search.messages', {
      headers: { Authorization: `Bearer ${token}` },
      params: {
        query: 'エラー OR 障害 OR 止まった OR 動かない OR バグ after:today',
        count: 10,
        sort: 'timestamp',
      },
      timeout: 10000,
    });

    const messages = res.data?.messages?.matches ?? [];

    if (messages.length >= 3) {
      const channels = [...new Set(messages.map((m: { channel: { name: string } }) => m.channel?.name))];
      alerts.push({
        system: 'Slack',
        severity: 'medium',
        title: `エラー報告が急増（${messages.length}件/24h）`,
        rawData: {
          summary: `${channels.join(', ')}でエラー言及が${messages.length}件`,
          count: messages.length,
          channels,
          samples: messages.slice(0, 3).map((m: { text: string; channel: { name: string } }) => ({
            text: m.text?.slice(0, 80),
            channel: m.channel?.name,
          })),
        },
        detectedAt: new Date().toISOString(),
      });
    }
  } catch (err) {
    console.warn('[Slack sensor] チェック失敗:', err);
  }

  return alerts;
}
