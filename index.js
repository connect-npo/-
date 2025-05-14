const express = require('express');
const axios = require('axios');
const { Client, middleware } = require('@line/bot-sdk');
require('dotenv').config(); // 環境変数を読み込み（Renderでは任意）

const app = express();
app.use(express.json());

// Renderの「環境」設定画面で以下のキーを正しく設定してください
const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET
};

const client = new Client(config);

// 危険ワード一覧（自由に編集可）
const dangerWords = [
  'しにたい', '死にたい', '自殺', '消えたい', 'いなくなりたい', '助けて', '限界',
  '働きすぎ', 'つらい', '苦しい', '疲れた', '眠れない', '孤独', '絶望',
  'リストカット', 'リスカ', 'OD', 'オーバードーズ', '薬', '睡眠薬', '大量服薬',
  '殴られる', 'たたかれる', '暴力', '家庭内暴力', 'DV', '虐待', '怒鳴られる',
  'いじめ', '無視される', '仲間はずれ', '学校にいけない', '登校できない', '教室に入れない',
  'お金がない', 'お金が足りない', '借金', '貧乏', '生活できない', '家賃が払えない',
  '誰もわかってくれない', 'もうだめ', '死にたいです', '人生終わった', '逃げたい', '死にたくなる'
];

// LINEグループID（あなたのグループIDに置き換え済）
const groupId = 'C9ff658373801593d72ccbf1a1f09ab49';

// Webhookエンドポイント
app.post('/webhook', middleware(config), async (req, res) => {
  const events = req.body.events;

  for (const event of events) {
    if (event.type === 'message' && event.message.type === 'text') {
      const userMessage = event.message.text;
      const replyToken = event.replyToken;

      // 危険ワード検出
      const matchedWord = dangerWords.find(word => userMessage.includes(word));

      // グループへ通知
      if (matchedWord) {
        try {
          await axios.post(
            'https://api.line.me/v2/bot/message/push',
            {
              to: groupId,
              messages: [
                {
                  type: 'text',
                  text: `⚠️ 重要メッセージを検知: 「${matchedWord}」\n📞 ご連絡は 090-4839-3313 までお願いいたします。`
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
        } catch (err) {
          console.error('グループ通知エラー:', err.message);
        }
      }

      // ユーザーへの返信
      await client.replyMessage(replyToken, [
        {
          type: 'text',
          text: '大丈夫ですか？ご無理なさらず、少しずつ進んでいきましょう。'
        }
      ]);
    }
  }

  res.sendStatus(200);
});

// サーバー起動
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`✅ Server running on port ${port}`);
});
