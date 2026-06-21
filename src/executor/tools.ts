import type Anthropic from '@anthropic-ai/sdk';

// Zeus が使えるツール一覧（Anthropic tool_use 形式）
// Claude が問題の内容を読んで自律的に選択・組み合わせて実行する
export const ZEUS_TOOLS: Anthropic.Tool[] = [
  {
    name: 'railway_restart',
    description: 'Railwayのサービスを再起動する。デプロイ失敗・メモリリーク・ハング時に有効。',
    input_schema: {
      type: 'object' as const,
      properties: {
        service_name: { type: 'string', description: '再起動するサービス名（例: sterepo）。不明なら全サービスを再起動' },
      },
      required: [],
    },
  },
  {
    name: 'slack_send',
    description: 'Slackのチャンネルにメッセージを送る。関係者への通知・報告に使う。',
    input_schema: {
      type: 'object' as const,
      properties: {
        channel: { type: 'string', description: 'チャンネル名（例: #aidx-room, #su_dev）' },
        message: { type: 'string', description: '送るメッセージ。Markdownで書ける。' },
      },
      required: ['channel', 'message'],
    },
  },
  {
    name: 'github_create_issue',
    description: 'GitHubリポジトリにIssueを作成する。コード修正が必要な問題・バグ追跡に使う。',
    input_schema: {
      type: 'object' as const,
      properties: {
        repo: { type: 'string', description: 'リポジトリ名（例: tkgathr2/sterepo）' },
        title: { type: 'string', description: 'Issueタイトル' },
        body: { type: 'string', description: 'Issue本文（Markdown）。原因・修正案・再現手順を含める。' },
        labels: { type: 'array', items: { type: 'string' }, description: 'ラベル（例: ["bug", "priority-high"]）' },
      },
      required: ['repo', 'title', 'body'],
    },
  },
  {
    name: 'web_search',
    description: '最新情報・エラー解決策・ベストプラクティスをウェブ検索する。追加情報が必要なときに使う。',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: '検索クエリ（日本語・英語どちらでも可）' },
      },
      required: ['query'],
    },
  },
  {
    name: 'knowhow_save',
    description: 'ノウハウキングに知識・解決策・しくじり先生カードを記録する。次回同じ問題が起きたときに参照できる。',
    input_schema: {
      type: 'object' as const,
      properties: {
        title: { type: 'string', description: '記録タイトル' },
        content: { type: 'string', description: '記録内容（原因・解決策・再発防止策）' },
        tags: { type: 'array', items: { type: 'string' }, description: 'タグ（例: ["Railway", "デプロイ", "エラー"]）' },
        project_key: { type: 'string', description: 'knowhowのプロジェクトキー（省略可・デフォルト: zeus-knowledge）' },
      },
      required: ['title', 'content'],
    },
  },
  {
    name: 'line_report',
    description: '社長のLINEに中間報告・進捗・完了を送る。長時間かかる処理の途中報告に使う。',
    input_schema: {
      type: 'object' as const,
      properties: {
        message: { type: 'string', description: '報告メッセージ（何を実行中か・結果はどうか）' },
      },
      required: ['message'],
    },
  },
  {
    name: 'notion_log',
    description: 'Notionの開発ログ・記録ページに作業内容を追記する。',
    input_schema: {
      type: 'object' as const,
      properties: {
        title: { type: 'string', description: '記録タイトル' },
        content: { type: 'string', description: '内容（Markdown）' },
      },
      required: ['title', 'content'],
    },
  },
  {
    name: 'complete',
    description: '全ての実行が完了したことを宣言する。必ず最後にこれを呼ぶ。',
    input_schema: {
      type: 'object' as const,
      properties: {
        summary: { type: 'string', description: '何をしたか・結果がどうだったかの1〜3行サマリー' },
        actions_taken: { type: 'array', items: { type: 'string' }, description: '実行したアクションのリスト（例: ["Railway再起動", "Slack通知", "Issue#42作成"]）' },
        success: { type: 'boolean', description: '問題が解決したか' },
      },
      required: ['summary', 'actions_taken', 'success'],
    },
  },
];
