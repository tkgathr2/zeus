import 'dotenv/config';
import { startServer } from './server/app.js';
import { startWeeklyReport } from './cron/weekly-report.js';
import { startScheduler } from './cron/scheduler.js';
import { startDailyNippou } from './cron/daily-nippou.js';
import { prisma } from './db.js';

async function main() {
  console.log('⚡ Zeus (全知全能モード) 起動中...');
  console.log('[Zeus] モード: イベントドリブン（Sentry/LINE/API webhook で発動）');

  const checks = {
    'LINE     ': process.env.LINE_CHANNEL_ACCESS_TOKEN,
    'Sentry   ': process.env.SENTRY_AUTH_TOKEN,
    'Slack    ': process.env.SLACK_BOT_TOKEN,
    'Railway  ': process.env.RAILWAY_API_TOKEN,
    'KnowHow  ': process.env.KB_API_KEY,
    'Tavily   ': process.env.TAVILY_API_KEY,
    'Zeus DB  ': process.env.ZEUS_DATABASE_URL ?? process.env.DATABASE_URL,
    'OpenAI   ': process.env.OPENAI_API_KEY,
    'Gemini   ': process.env.GOOGLE_GENERATIVE_AI_API_KEY,
  };

  for (const [name, val] of Object.entries(checks)) {
    console.log(`  ${name}: ${val ? '✅' : '⚠️  未設定'}`);
  }

  await prisma.$connect();
  console.log('[Zeus] DB接続完了');
  console.log('[Zeus] 受け口: POST /webhook (LINE) | POST /sentry | POST /alert | POST /zeus/invoke');
  console.log('[Zeus] 画面: GET / (ダッシュボード) | GET /api/stats | POST /zeus/nippou/run');

  startServer();
  startWeeklyReport();
  startDailyNippou();

  // R1: 8センサーの15分自律監視。既定ON、ZEUS_SCHEDULER_ENABLED=false で停止可。
  if (process.env.ZEUS_SCHEDULER_ENABLED !== 'false') {
    startScheduler();
  } else {
    console.log('[Zeus] 自律監視スケジューラーは無効（ZEUS_SCHEDULER_ENABLED=false）');
  }
}

main().catch(err => {
  console.error('[Zeus] 起動エラー:', err);
  process.exit(1);
});

process.on('SIGTERM', async () => {
  await prisma.$disconnect();
  process.exit(0);
});
