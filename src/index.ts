import 'dotenv/config';
import { startScheduler } from './cron/scheduler.js';

console.log('⚡ Zeus 起動中...');
console.log(`  環境: ${process.env.NODE_ENV ?? 'development'}`);
console.log(`  LINE: ${process.env.LINE_CHANNEL_ACCESS_TOKEN ? '✅' : '⚠️ 未設定'}`);
console.log(`  Railway: ${process.env.RAILWAY_API_TOKEN ? '✅' : '⚠️ 未設定'}`);
console.log(`  Sentry: ${process.env.SENTRY_AUTH_TOKEN ? '✅' : '⚠️ 未設定'}`);
console.log(`  Slack: ${process.env.SLACK_BOT_TOKEN ? '✅' : '⚠️ 未設定'}`);
console.log(`  KnowHow: ${process.env.KB_API_KEY ? '✅' : '⚠️ 未設定'}`);

startScheduler();

process.on('SIGTERM', () => {
  console.log('[Zeus] シャットダウン');
  process.exit(0);
});
