import cron from 'node-cron';
import { collectAlerts } from '../sensors/index.js';
import { runDebate } from '../debate/engine.js';
import { sendProposal } from '../line/notify.js';

let proposalCounter = 1;
const sentAlertKeys = new Set<string>();

function alertKey(title: string, system: string): string {
  return `${system}:${title}`;
}

async function zeusRun(): Promise<void> {
  console.log(`[Zeus] センサー収集開始 ${new Date().toISOString()}`);

  const alerts = await collectAlerts();
  console.log(`[Zeus] ${alerts.length}件のアラート検知`);

  // 重複送信防止（同じ問題は6時間以内に再送しない）
  const newAlerts = alerts.filter(a => !sentAlertKeys.has(alertKey(a.title, a.system)));

  if (newAlerts.length === 0) {
    console.log('[Zeus] 新規アラートなし');
    return;
  }

  // 最重要1件だけ処理（severity順にソート済み）
  const topAlert = newAlerts[0];
  const key = alertKey(topAlert.title, topAlert.system);

  try {
    const result = await runDebate(topAlert);
    await sendProposal(result, proposalCounter);
    proposalCounter++;
    sentAlertKeys.add(key);

    // 6時間後にキャッシュ削除（再発時に再送可能に）
    setTimeout(() => sentAlertKeys.delete(key), 6 * 60 * 60 * 1000);
  } catch (err) {
    console.error('[Zeus] 処理エラー:', err);
  }
}

export function startScheduler(): void {
  // 15分ごとに実行
  cron.schedule('*/15 * * * *', () => {
    zeusRun().catch(err => console.error('[Zeus cron] 予期せぬエラー:', err));
  });

  console.log('[Zeus] スケジューラー起動（15分ごと）');

  // 起動直後に1回実行
  setTimeout(() => {
    zeusRun().catch(err => console.error('[Zeus] 初回実行エラー:', err));
  }, 5000);
}
