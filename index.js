const express = require('express');
const axios = require('axios');
const { Client, middleware } = require('@line/bot-sdk');

const app = express();
app.use(express.json());

// ✅ 最新チャネルシークレットとアクセストークン（以前のアクセストークン使用）
const config = {
  channelAccessToken: '2eGPRk98EDRrCndZQpuyb+ZV5KnSVhwRWovMUQtYfn0VnR9m4SNPKlANmQGkdk/OqX3sTrqlRFtlYAQydhLUWVyz6BbCAbY8xd/orUSsLPLZuv7b5z2Mn89B49BKIlCytTTXU/GMBFA+TIQGnhA8jgdB04t89/1O/w1cDnyilFU=',
  channelSecret: 'b92f9268ac74443181ffdd7ddbcac7c7'
};

const client = new Client(config);

// 危険ワード一覧
const dangerWords = [
  'しにたい', '死にたい', '自殺', '消えたい', 'いなくなりたい', '助けて', '限界',
  '働きすぎ', 'つらい', '苦しい', '疲れた', '眠れない', '孤独', '絶望',
  'リストカット', 'リスカ', 'OD', 'オーバードーズ', '薬', '睡眠薬', '大量服薬',
  '殴られる', 'たたかれる', '暴力', '家庭内暴力', 'DV', '虐待', '怒鳴られる',
  'いじめ', '無視される', '仲間はずれ', '学校にいけない', '登校できない', '教室に入れない',
  'お金がない', 'お金が足りない', '借金', '貧乏', '生活できない', '家賃が払えない',
  '誰もわかってくれない', 'もうだめ', '死にたいです', '人生終わった', '逃げたい', '死にたくなる'
];

// 通知先グループID（必要に応じて書き換え）
const groupId = 'C9ff658373801593d72ccbf1a1f09ab49';

// Webhookエンドポイント
app.post('/webhook', middleware(config), async (req, res) => {
  try {
    const events = req.body.events;

    for (const event of events) {
      if (event.type === 'message' && event.message.type === 'text') {
        const userMessage = event.message.text;
        const replyToken = event.replyToken;

        const matchedWord = dangerWords.find(word => userMessage.includes(word));

        if (matchedWord) {
          await axios.post(
            'https://api.line.me/v2/bot/message/push',
            {
              to: groupId,
              messages: [
                {
                  type: 'text',
                  text: `⚠️ 危険ワードを検知しました: 「${matchedWord}」\n📞 至急対応してください。090-4839-3313`
                }
              ]
            },
            {
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${config.channelAccessToken}`
              }
            }
          );
        }

        await client.replyMessage(replyToken, [
          {
            type: 'text',
            text: '大丈夫ですか？ご無理なさらず、少しずつ進んでいきましょう。'
          }
        ]);
      }
    }

    res.sendStatus(200);
  } catch (err) {
    console.error('❌ Webhook処理エラー:', err);
    res.status(500).end();
  }
});

// サーバー起動（Renderで使うポート）
const port = process.env.PORT || 10000;
app.listen(port, () => {
  console.log(`✅ Server running on port ${port}`);
});
