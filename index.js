const express = require('express');
const axios = require('axios');
const { Client, middleware } = require('@line/bot-sdk');

const app = express();

// LINE Bot設定（環境変数から読み込み）
const config = {
  channelAccessToken: process.env.YOUR_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.YOUR_CHANNEL_SECRET,
};
const client = new Client(config);

// OpenAIキーと通知先グループID
const OPENAI_API_KEY = process.env.YOUR_OPENAI_API_KEY;
const GROUP_ID = process.env.GROUP_ID;

// 危険ワード一覧（必要に応じて追加・編集OK）
const dangerWords = [
  "しにたい", "自殺", "消えたい", "つらい", "助けて", "やめたい", "死にたい", "苦しい",
  "学校に行けない", "殴られる", "たたかれる", "リストカット", "オーバードーズ",
  "お金がない", "貧乏", "家庭が崩壊", "虐待", "いじめ", "暴力", "性被害"
];

// ミドルウェア設定
app.use(middleware(config));
app.use(express.json());

// Webhookエンドポイント（ログ付き）
app.post('/webhook', async (req, res) => {
  console.log('Webhook headers:', req.headers);
  console.log('Webhook body:', req.body);

  try {
    const events = req.body.events;
    for (const event of events) {
      if (event.type === 'message' && event.message.type === 'text') {
        const userMessage = event.message.text;

        // 危険ワードチェック
        const matchedWord = dangerWords.find(word => userMessage.includes(word));
        if (matchedWord) {
          // グループ通知
          await client.pushMessage(GROUP_ID, {
            type: 'text',
            text: `⚠️ 危険ワード「${matchedWord}」を検出しました。\n内容: ${userMessage}`
          });

          // ユーザーにも返信
          await client.replyMessage(event.replyToken, {
            type: 'text',
            text: `とても心配です…\n必要な時はすぐに大人や相談機関に連絡してください。\nどうしようもないときは「09048393313」に電話してね📞`
          });
          continue;
        }

        // 通常応答（ChatGPT）
        const aiResponse = await axios.post(
          'https://api.openai.com/v1/chat/completions',
          {
            model: 'gpt-3.5-turbo',
            messages: [{ role: 'user', content: userMessage }],
            max_tokens: 200,
          },
          {
            headers: {
              Authorization: `Bearer ${OPENAI_API_KEY}`,
              'Content-Type': 'application/json',
            },
          }
        );

        const replyText = aiResponse.data.choices[0].message.content;
        await client.replyMessage(event.replyToken, { type: 'text', text: replyText });
      }
    }

    res.status(200).send('OK');
  } catch (err) {
    console.error('Error:', err);
    res.status(500).send('Internal Server Error');
  }
});

// ポート設定（Render用）
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`🚀 Server is running on port ${port}`);
});

// テスト用GETエンドポイント
app.get('/', (req, res) => {
  res.send('こころちゃんは元気です🌸');
});
