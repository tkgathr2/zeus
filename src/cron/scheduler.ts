import cron from 'node-cron';
import type { Prisma } from '@prisma/client';
import { collectAlerts } from '../sensors/index.js';
import { runDebate } from '../debate/engine.js';
import { sendProposal } from '../line/notify.js';
import { prisma } from '../db.js';

async function zeusRun(): Promise<void> {
  console.log(`[Zeus] センサー収集開始 ${new Date().toISOString()}`);

  const alerts = await collectAlerts();
  console.log(`[Zeus] ${alerts.length}件検知`);
  if (alerts.length === 0) return;

  // DB上で pending な直近24h以内の同一アラートはスキップ（重複防止）
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
  for (const alert of alerts) {
    const exists = await prisma.proposal.findFirst({
      where: {
        system: alert.system,
        title: alert.title,
        status: { in: ['pending', 'approved', 'executed'] },
        createdAt: { gte: since24h },
      },
    });
    if (exists) continue;

    try {
      const result = await runDebate(alert);
      const lineMsg = (await import('../line/notify.js')).buildMessage(result, 0);

      const proposal = await prisma.proposal.create({
        data: {
          system: alert.system,
          title: alert.title,
          severity: alert.severity,
          rawData: alert.rawData as unknown as Prisma.InputJsonValue,
          debateResult: result as unknown as Prisma.InputJsonValue,
          lineMessage: lineMsg,
          status: 'pending',
        },
      });

      await sendProposal(result, proposal.id);
      console.log(`[Zeus] 提案 #${proposal.id} 送信完了`);

      // 1件ずつ処理（LINE通知を1つずつ送る）
      break;
    } catch (err) {
      console.error('[Zeus] アラート処理エラー:', err);
    }
  }
}

export function startScheduler(): void {
  cron.schedule('*/15 * * * *', () => {
    zeusRun().catch(err => console.error('[Zeus cron] エラー:', err));
  });

  console.log('[Zeus] スケジューラー起動（15分ごと）');

  setTimeout(() => {
    zeusRun().catch(err => console.error('[Zeus] 初回実行エラー:', err));
  }, 5000);
}

