const express = require('express');
const axios = require('axios');
const { Client, middleware } = require('@line/bot-sdk');

const app = express();
const config = {
  channelAccessToken: process.env.YOUR_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.YOUR_CHANNEL_SECRET,
};
const client = new Client(config);

const OPENAI_API_KEY = process.env.YOUR_OPENAI_API_KEY;
const GROUP_ID = process.env.GROUP_ID;

const dangerWords = [
  "しにたい", "死にたい", "自殺", "消えたい", "つらい", "助けて", "やめたい", "苦しい",
  "学校に行けない", "殴られる", "たたかれる", "いじめ", "リストカット", "オーバードーズ",
  "貧乏", "お金が足りない", "家にいたくない", "家出したい", "もうだめ", "どうしたらいい",
  "殺される", "暴力", "虐待", "誰にも言えない", "死のうと思う", "消えてしまいたい"
];

// LINE署名検証用（生データを保持）
app.post('/webhook', express.raw({ type: 'application/json' }), middleware(config), async (req, res) => {
  const events = req.body.events;
  res.status(200).send('OK');

  for (const event of events) {
    console.log(JSON.stringify(event, null, 2)); // userIdなどログ出力

    if (event.type === 'message' && event.message.type === 'text') {
      const text = event.message.text;

      // 危険ワード検知
      const found = dangerWords.find(word => text.includes(word));
      if (found) {
        await client.replyMessage(event.replyToken, {
          type: 'text',
          text: 'どうしようもない時はこちらにお電話下さい📞 090-4839-3313'
        });
        await client.pushMessage(GROUP_ID, {
          type: 'text',
          text: `[通報] 危険ワード「${found}」を検出しました：\n${text}`
        });
        continue;
      }

      // ChatGPT応答
      try {
        const response = await axios.post("https://api.openai.com/v1/chat/completions", {
          model: "gpt-3.5-turbo",
          messages: [{ role: "user", content: text }]
        }, {
          headers: {
            Authorization: `Bearer ${OPENAI_API_KEY}`,
            "Content-Type": "application/json"
          }
        });

        const aiText = response.data.choices[0].message.content;
        await client.replyMessage(event.replyToken, {
          type: 'text',
          text: aiText
        });
      } catch (error) {
        console.error("OpenAIエラー:", error.message);
        await client.replyMessage(event.replyToken, {
          type: 'text',
          text: 'ちょっと混み合ってるみたい…また後で話そうね。'
        });
      }
    }
  }
});

const port = process.env.PORT || 10000;
app.listen(port, () => {
  console.log(`🚀 最小テストサーバーがポート ${port} で起動しました`);
});
