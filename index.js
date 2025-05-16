
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

// 危険ワード（拡張済み）
const dangerWords = [
  "しにたい", "死にたい", "自殺", "消えたい", "つらい", "助けて", "やめたい", "苦しい",
  "学校に行けない", "殴られる", "たたかれる", "リストカット", "オーバードーズ",
  "いじめ", "お金が足りない", "貧乏", "こわい", "怖い", "無視", "独り", "さみしい", "眠れない"
];

app.post('/webhook', middleware(config), async (req, res) => {
  const events = req.body.events;

  await Promise.all(events.map(async (event) => {
    if (event.type === 'message' && event.message.type === 'text') {
      const userMessage = event.message.text;

      // 危険ワード検出
      const detected = dangerWords.find(word => userMessage.includes(word));
      if (detected) {
        // ユーザーへの優しい返信
        await client.replyMessage(event.replyToken, {
          type: 'text',
          text: "🍀辛い気持ちを抱えているんだね。わたしがそばにいるから大丈夫だよ。どんなことでも話してね。

📞どうしようもないときは電話してね：090-4839-3313"
        });

        // 管理グループへの通報とアクション提案
        await client.pushMessage(GROUP_ID, {
          type: 'text',
          text: `[通報] 危険ワード「${detected}」が検出されました。
ユーザー発言: 「${userMessage}」

📣サポートが必要な方がいます。対応できる方は、個別に連絡またはサポート窓口にご相談ください。
🌐 https://connect-npo.org/support`
        });

        return;
      }

      try {
        const openaiRes = await axios.post(
          'https://api.openai.com/v1/chat/completions',
          {
            model: 'gpt-3.5-turbo',
            messages: [
              {
                role: 'system',
                content: 'あなたは14歳の女の子「こころちゃん」です。やさしく、元気すぎず、でも前向きに寄り添う返答をしてください。言葉は温かく、安心感があり、自然な絵文字（🌸🍀😊💖✨など）を適度に使ってください。名乗りや「こんにちは」などの不要な定型句は省いて、すぐ会話に入ってください。返答は短く簡潔に（2〜3文程度）。'
              },
              {
                role: 'user',
                content: userMessage
              }
            ],
            max_tokens: 90,
            temperature: 0.75
          },
          {
            headers: {
              'Authorization': `Bearer ${OPENAI_API_KEY}`,
              'Content-Type': 'application/json'
            }
          }
        );

        const replyText = openaiRes.data.choices[0].message.content;

        await client.replyMessage(event.replyToken, {
          type: 'text',
          text: replyText
        });
      } catch (error) {
        console.error('OpenAIエラー:', error.response?.data || error.message);
        await client.replyMessage(event.replyToken, {
          type: 'text',
          text: 'ごめんね💦 今ちょっと混みあってるみたい。もう一度お話ししてくれるとうれしいな🍀'
        });
      }
    }
  }));

  res.status(200).send('OK');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
