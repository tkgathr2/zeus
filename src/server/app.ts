import express from 'express';
import { lineWebhook } from './webhook.js';
import { sentryWebhook, genericAlert } from './sentry-webhook.js';
import { invokeZeus } from './zeus-invoke.js';
import { prisma } from '../db.js';
import type { SensorAlert } from '../types/index.js';

const app = express();

app.use(express.json({ verify: (req, _res, buf) => { (req as { rawBody?: Buffer }).rawBody = buf; } }));

// ─── LINE双方向チャット ────────────────────────────────────
// 社長がLINEで何でも投げれば Zeus が3AIディベートして応答
app.post('/webhook', lineWebhook);

// ─── Sentry エラー webhook ────────────────────────────────
// Sentry → Alert Rules → Webhook → https://zeus-xxx.up.railway.app/sentry
app.post('/sentry', sentryWebhook);

// ─── 汎用アラート (Railway/GitHub/任意) ──────────────────
// POST /alert  { system, title, severity?, description? }
app.post('/alert', genericAlert);

// ─── Zeus 直接呼び出し API ───────────────────────────────
// 任意のシステムから Zeus を発動できる汎用エンドポイント
// POST /zeus/invoke  { system, title, severity?, rawData? }
app.post('/zeus/invoke', async (req, res) => {
  const { system, title, severity = 'medium', rawData = {} } = req.body ?? {};
  if (!system || !title) {
    res.status(400).json({ error: 'system と title は必須です' });
    return;
  }
  const alert: SensorAlert = {
    system: String(system),
    severity: severity as SensorAlert['severity'],
    title: String(title).substring(0, 100),
    rawData: { ...rawData, source: 'direct_api' },
    detectedAt: new Date().toISOString(),
  };
  invokeZeus(alert)
    .then(r => console.log(`[Zeus API] 発動完了 #${r.proposalId}`))
    .catch(err => console.error('[Zeus API] エラー:', err));
  res.json({ status: 'accepted', message: 'Zeusが分析を開始しました。LINEに提案が届きます。' });
});

// ─── ヘルスチェック ──────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString(), mode: '全知全能モード（イベントドリブン）' });
});

// ─── 提案一覧 ────────────────────────────────────────────
app.get('/proposals', async (_req, res) => {
  const proposals = await prisma.proposal.findMany({
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: { id: true, system: true, title: true, severity: true, status: true, createdAt: true },
  });
  res.json(proposals);
});

export function startServer(): void {
  const port = process.env.PORT ?? 3000;
  app.listen(port, () => {
    console.log(`[Zeus Server] http://localhost:${port}`);
    console.log(`[Zeus Server] Webhook: http://localhost:${port}/webhook`);
  });
}
