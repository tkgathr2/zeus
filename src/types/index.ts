import type { Evidence } from '../knowhow/evidence.js';

export interface SensorAlert {
  system: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  title: string;
  rawData: Record<string, unknown>;
  detectedAt: string;
}

export interface AIPosition {
  ai: 'claude' | 'chatgpt' | 'gemini';
  analysis: string;
  confidence?: number;
  successRate?: number;
  riskLevel?: number;
  estimatedLoss?: number;
  reoccurrenceRate?: number;
  rawData?: Record<string, unknown>;
}

export interface DebateResult {
  alert: SensorAlert;
  round1: AIPosition[];
  round2: AIPosition[];
  consensus: {
    title: string;
    cause: string;
    solution: string;
    confidence: number;
    successRate: number;
    stopRisk: number;
    dataLossRisk: number;
    monthlyLoss: number;
    reoccurrence30d: number;
    estimatedMinutes: number;
    executorHint: string;
    alternativeSolution: string; // マスク(Gemini)視点の根本解決案
  };
  evidence: Evidence;
}
