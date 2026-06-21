import type { Request, Response } from 'express';
import { invokeZeus } from './zeus-invoke.js';
import type { SensorAlert } from '../types/index.js';

// Sentry Alert Rule Webhook
// Settings → Alerts → Create Alert Rule → Webhook → https://zeus-xxx.up.railway.app/sentry
export async function sentryWebhook(req: Request, res: Response): Promise<void> {
  res.status(200).send('OK'); // Sentry は即 200 を要求

  try {
    const body = req.body;
    // Sentry webhook ペイロード (issue alert)
    const event = body?.data?.event ?? body;
    const issue = body?.data?.issue ?? {};

    const title = String(event?.title ?? issue?.title ?? body?.message ?? 'Sentry Error').substring(0, 100);
    const level = String(event?.level ?? issue?.level ?? 'error');
    const project = String(event?.project?.name ?? event?.project ?? body?.project?.name ?? 'unknown');
    const url = String(event?.web_url ?? issue?.permalink ?? '');
    const errorType = String(event?.type ?? event?.exception?.values?.[0]?.type ?? '');
    const errorValue = String(event?.exception?.values?.[0]?.value ?? event?.message ?? title);

    const severity: SensorAlert['severity'] =
      level === 'fatal' ? 'critical' :
      level === 'error' ? 'high' :
      level === 'warning' ? 'medium' : 'low';

    const alert: SensorAlert = {
      system: `Sentry/${project}`,
      severity,
      title: `[${level.toUpperCase()}] ${title}`,
      rawData: {
        source: 'sentry_webhook',
        project,
        level,
        errorType,
        errorValue,
        url,
        raw: body,
      },
      detectedAt: new Date().toISOString(),
    };

    await invokeZeus(alert);
  } catch (err) {
    console.error('[Zeus] Sentry webhook 処理エラー:', err);
  }
}

// Railway / GitHub Actions / 任意サービスからの汎用アラート
// POST /alert  body: { system, title, severity?, description? }
export async function genericAlert(req: Request, res: Response): Promise<void> {
  res.status(200).send('OK');

  try {
    const { system, title, severity = 'medium', description = '' } = req.body ?? {};
    if (!system || !title) return;

    const alert: SensorAlert = {
      system: String(system),
      severity: severity as SensorAlert['severity'],
      title: String(title).substring(0, 100),
      rawData: { source: 'generic_alert', description, raw: req.body },
      detectedAt: new Date().toISOString(),
    };

    await invokeZeus(alert);
  } catch (err) {
    console.error('[Zeus] generic alert 処理エラー:', err);
  }
}
