import express from 'express';
import { lineWebhook } from './webhook.js';
import { prisma } from '../db.js';

const app = express();

app.use(express.json({ verify: (req, _res, buf) => { (req as { rawBody?: Buffer }).rawBody = buf; } }));

// LINE Webhook
app.post('/webhook', lineWebhook);

// ヘルスチェック
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// 提案一覧（デバッグ用）
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
