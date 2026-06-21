import cron from 'node-cron';
import { generateText } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { messagingApi } from '@line/bot-sdk';
import { getWeeklyStats } from '../learning/feedback.js';

function getLineClient(): messagingApi.MessagingApiClient {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) throw new Error('LINE_CHANNEL_ACCESS_TOKEN が未設定です');
  return new messagingApi.MessagingApiClient({ channelAccessToken: token });
}

async function buildWeeklyReport(): Promise<string> {
  const stats = await getWeeklyStats();

  if (stats.total === 0) {
    return '📊 今週のZeusレポート\n\n今週は発動なし。全システム平常運転中です⚡';
  }

  const successRate = stats.total > 0
    ? Math.round((stats.executed / Math.max(stats.approved, 1)) * 100)
    : 0;

  const topSystemsText = stats.topSystems.length > 0
    ? stats.topSystems.map((s, i) => `${i + 1}. ${s.system}（${s.count}件）`).join('\n')
    : 'なし';

  // Claude が週次サマリーと改善提案を生成
  const { text: aiInsight } = await generateText({
    model: anthropic('claude-sonnet-4-6'),
    system: 'あなたはZEUSの週次振り返りAIです。データを見て、社長に簡潔な洞察と来週の改善提案を3行以内で返してください。',
    prompt: `今週のZeusデータ:
発動: ${stats.total}件 / 承認: ${stats.approved}件 / スキップ: ${stats.rejected}件
実行成功: ${stats.executed}件 / 失敗: ${stats.failed}件
よく問題が起きたシステム: ${topSystemsText}

洞察と来週の改善提案を日本語3行以内で（数字あり・素人語）:`,
  });

  return [
    '📊 Zeus週次レポート',
    '',
    `⚡ 今週の発動: ${stats.total}件`,
    `✅ 承認・実行: ${stats.approved}件`,
    `⏭️ スキップ: ${stats.rejected}件`,
    `🎯 実行成功率: ${successRate}%`,
    `❌ 失敗: ${stats.failed}件`,
    '',
    '🔥 よく問題が起きたシステム:',
    topSystemsText,
    '',
    '💡 Zeusからの分析:',
    aiInsight.trim(),
  ].join('\n');
}

export function startWeeklyReport(): void {
  // 毎週月曜 朝8時に週次レポートをLINEに送信
  cron.schedule('0 8 * * 1', async () => {
    console.log('[Zeus] 週次レポート生成中...');
    try {
      const userId = process.env.LINE_USER_ID;
      if (!userId) return;

      const report = await buildWeeklyReport();
      await getLineClient().pushMessage({
        to: userId,
        messages: [{ type: 'text', text: report }],
      });
      console.log('[Zeus] 週次レポートを送信しました');
    } catch (err) {
      console.error('[Zeus] 週次レポート送信エラー:', err);
    }
  }, { timezone: 'Asia/Tokyo' });

  console.log('[Zeus] 週次レポート: 毎週月曜 8:00 JST にLINEで送信');
}
