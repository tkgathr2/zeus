import 'dotenv/config';
import { startServer } from './server/app.js';
import { startScheduler } from './cron/scheduler.js';
import { prisma } from './db.js';

async function main() {
  console.log('⚡ Zeus 起動中...');

  const checks = {
    'LINE     ': process.env.LINE_CHANNEL_ACCESS_TOKEN,
    'Railway  ': process.env.RAILWAY_API_TOKEN,
    'Sentry   ': process.env.SENTRY_AUTH_TOKEN,
    'Slack    ': process.env.SLACK_BOT_TOKEN,
    'MF       ': process.env.MF_ACCESS_TOKEN,
    'Backlog  ': process.env.BACKLOG_API_KEY,
    'Calendar ': process.env.GOOGLE_CALENDAR_ACCESS_TOKEN,
    'KnowHow  ': process.env.KB_API_KEY,
  };

  for (const [name, val] of Object.entries(checks)) {
    console.log(`  ${name}: ${val ? '✅' : '⚠️  未設定'}`);
  }

  await prisma.$connect();
  console.log('[Zeus] DB接続完了');

  startServer();
  startScheduler();
}

main().catch(err => {
  console.error('[Zeus] 起動エラー:', err);
  process.exit(1);
});

process.on('SIGTERM', async () => {
  await prisma.$disconnect();
  process.exit(0);
});
