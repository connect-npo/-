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

app.post('/webhook', express.raw({ type: 'application/json' }), middleware(config), async (req, res) => {
  const events = req.body.events;
  res.status(200).send('OK');

  for (const event of events) {
    console.log(JSON.stringify(event, null, 2));

    if (event.type === 'message' && event.message.type === 'text') {
      const text = event.message.text;
      const found = dangerWords.find(word => text.includes(word));

      // 危険ワードが含まれていたら、まずこころちゃん応答
      if (found) {
        try {
          // ChatGPTで優しい返事を生成
          const response = await axios.post("https://api.openai.com/v1/chat/completions", {
            model: "gpt-3.5-turbo",
            messages: [{
              role: "system",
              content: "あなたは優しい14歳の女の子「こころちゃん」です。相手に寄り添い、絵文字を交えて安心させてください。"
            }, {
              role: "user",
              content: text
            }]
          }, {
            headers: {
              Authorization: `Bearer ${OPENAI_API_KEY}`,
              "Content-Type": "application/json"
            }
          });

          const aiText = response.data.choices[0].message.content + "\n\n💡どうしようもないときは、お電話くださいね📞 090-4839-3313";
          await client.replyMessage(event.replyToken, {
            type: 'text',
            text: aiText
          });

          await client.pushMessage(GROUP_ID, {
            type: 'text',
            text: `[通報] 危険ワード「${found}」検出：\n${text}`
          });
        } catch (err) {
          console.error("ChatGPTエラー:", err.message);
          await client.replyMessage(event.replyToken, {
            type: 'text',
            text: 'ちょっと混み合ってるみたい…またあとでお話ししようね🌸'
          });
        }
        return;
      }

      // 通常メッセージ → こころちゃん応答
      try {
        const response = await axios.post("https://api.openai.com/v1/chat/completions", {
          model: "gpt-3.5-turbo",
          messages: [{
            role: "system",
            content: "あなたは優しい14歳の女の子「こころちゃん」です。絵文字を交えて、元気づけるように返事してください。"
          }, {
            role: "user",
            content: text
          }]
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
      } catch (err) {
        console.error("ChatGPTエラー:", err.message);
        await client.replyMessage(event.replyToken, {
          type: 'text',
          text: 'ちょっと混み合ってるみたい…またあとでお話ししようね🌸'
        });
      }
    }
  }
});

const port = process.env.PORT || 10000;
app.listen(port, () => {
  console.log(`🚀 こころちゃんBotがポート ${port} で起動しました💖`);
});
