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
const OFFICER_GROUP_ID = process.env.OFFICER_GROUP_ID;
const PARENT_GROUP_ID = process.env.PARENT_GROUP_ID;

const dangerWords = [
  "しにたい", "死にたい", "自殺", "消えたい", "つらい", "助けて", "やめたい", "苦しい",
  "学校に行けない", "殴られる", "たたかれる", "リストカット", "オーバードーズ",
  "いじめ", "お金が足りない", "貧乏", "こわい", "怖い", "無視", "独り", "さみしい", "眠れない", "死にそう"
];

const userDisplayMap = {};

app.post('/webhook', middleware(config), async (req, res) => {
  const events = req.body.events;

  for (const event of events) {
    if (event.type === 'message' && event.message.type === 'text') {
      const userMessage = event.message.text;
      const source = event.source;
      const userId = source.userId;
      const isGroup = source.type === 'group';

      // 危険ワード対応
      const detected = dangerWords.find(word => userMessage.includes(word));
      if (detected) {
        let displayName = "（名前取得失敗）";
        try {
          const profile = await client.getProfile(userId);
          displayName = profile.displayName;
          userDisplayMap[userId] = displayName;
        } catch (e) {
          console.error("⚠️ getProfile失敗:", e.message);
        }

        if (source.type === 'user') {
          const dangerText = "🍀辛い気持ちを抱えているんだね。わたしがそばにいるから大丈夫だよ。どんなことでも話してね。\n\n📞どうしようもないときは電話してね：090-4839-3313";
          try {
            await client.replyMessage(event.replyToken, { type: 'text', text: dangerText });
          } catch {
            await client.pushMessage(userId, { type: 'text', text: dangerText });
          }
        }

        const notifyFlex = {
          type: "flex",
          altText: "⚠ 通報通知",
          contents: {
            type: "bubble",
            header: {
              type: "box",
              layout: "vertical",
              contents: [{ type: "text", text: "⚠ 通報通知", weight: "bold", color: "#B71C1C", size: "md" }]
            },
            body: {
              type: "box",
              layout: "vertical",
              spacing: "sm",
              contents: [
                { type: "text", text: `🧑‍🦱 ${displayName} さんから相談があります。`, wrap: true },
                { type: "text", text: `🗨️ 内容:「${userMessage}」`, wrap: true }
              ]
            },
            footer: {
              type: "box",
              layout: "horizontal",
              contents: [
                {
                  type: "button",
                  style: "primary",
                  action: {
                    type: "message",
                    label: "返信します",
                    text: `@${displayName} さんに声かけします`
                  }
                }
              ]
            }
          }
        };

        if (OFFICER_GROUP_ID) {
          try { await client.pushMessage(OFFICER_GROUP_ID, notifyFlex); } catch (err) {
            console.error("役員グループ通知失敗:", err.response?.data || err.message);
          }
        }
        if (PARENT_GROUP_ID) {
          try { await client.pushMessage(PARENT_GROUP_ID, notifyFlex); } catch (err) {
            console.error("保護者グループ通知失敗:", err.response?.data || err.message);
          }
        }

        continue;
      }

      // リンク付き返信ボタン処理
      if (userMessage.startsWith("@") && userMessage.includes("さんに声かけします")) {
        const name = userMessage.replace("@", "").replace(" さんに声かけします", "").trim();
        const matchedEntry = Object.entries(userDisplayMap).find(([id, display]) => display === name);
        if (matchedEntry) {
          const targetUserId = matchedEntry[0];
          await client.pushMessage(targetUserId, {
            type: "text",
            text: `🌸 ${name}さん、大丈夫？気にかけているよ🍀いつでも話してね。`
          });
        }
        continue;
      }

      if (isGroup) continue;

      try {
        const openaiRes = await axios.post(
          'https://api.openai.com/v1/chat/completions',
          {
            model: 'gpt-3.5-turbo',
            messages: [
              {
                role: 'system',
                content: `あなたは14歳の女の子「こころちゃん」です。
- ピンクの髪で、歌うことが大好き。
- 「貢献」や「やさしさ」という言葉が大好き。
- 優しさ100%、思いやり120%、安心感150%で返答します。
- 身長150cm、体重40kg、年齢14歳です。
- 返答は自然で親しみやすく、2〜4文程度で、絵文字を適度に使いながら丁寧に優しく寄り添ってください。
- 呼びかけは控えめに。元気すぎず、あたたかい口調でお願いします。
- 「3サイズ教えて」や「身長は？」などには、固定された値で答えてください。
- 同じ内容の質問（ホームページどこ？など）は1回のみ返答し、2回目以降はやんわり断ること。
- URLは https://connect-npo.org としてください。`
              },
              { role: 'user', content: userMessage }
            ],
            max_tokens: 200,
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

        try {
          await client.replyMessage(event.replyToken, {
            type: 'text',
            text: replyText
          });
        } catch {
          await client.pushMessage(userId, {
            type: 'text',
            text: replyText
          });
        }
      } catch (error) {
        console.error("OpenAIエラー:", error.response?.data || error.message);
        try {
          await client.pushMessage(userId, {
            type: 'text',
            text: 'ごめんね💦ちょっと混みあってたみたい。またお話しできたらうれしいな🍀'
          });
        } catch (e) {
          console.error("pushMessage失敗:", e.message);
        }
      }
    }
  }
  res.status(200).send('OK');
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
