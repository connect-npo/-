require('dotenv').config(); // 環境変数を読み込む（念のため残しますが、このコードでは使われません）

const express = require('express');
const app = express();

// LINEからのWebhookリクエストをJSONとしてパースする設定
app.use(express.json());

// Webhookエンドポイント
// LINEからのWebhookリクエストが来たら、常に200 OKを返します
app.post('/webhook', (req, res) => {
    console.log('Webhookイベントを受信しました。');
    // LINEからのWebhookイベントを受け取ったら、即座に200 OKを返します。
    // メッセージの処理やLINEへの応答は一切行いません。
    res.status(200).send('OK');
});

// サーバー起動
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`🚀 最低限のサーバーがポート ${PORT} で起動しました`);
    console.log(`LINE Webhook URL: http://localhost:${PORT}/webhook (Renderでは自動でドメインが割り当てられます)`);
    console.log(`このサーバーはWebhookを受信し、200 OKを返すだけのシンプルなものです。`);
    console.log(`デプロイ成功後、Renderサービスを停止してください。`);
});
