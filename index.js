const express = require('express');
const axios = require('axios');
const { Client, middleware } = require('@line/bot-sdk');

const app = express();

const config = {
channelAccessToken: process.env.YOUR\_CHANNEL\_ACCESS\_TOKEN,
channelSecret: process.env.YOUR\_CHANNEL\_SECRET,
};
const client = new Client(config);

const OPENAI\_API\_KEY = process.env.YOUR\_OPENAI\_API\_KEY;
const OFFICER\_GROUP\_ID = process.env.OFFICER\_GROUP\_ID;
const PARENT\_GROUP\_ID = process.env.PARENT\_GROUP\_ID;

const dangerWords = \[
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
const userId = event.source.userId;

```
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

    await client.replyMessage(event.replyToken, {
      type: 'text',
      text: "🍀辛い気持ちを抱えているんだね。わたしがそばにいるから大丈夫だよ。どんなことでも話してね。\n\n📞どうしようもないときは電話してね：090-4839-3313"
    });

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
      try {
        await client.pushMessage(OFFICER_GROUP_ID, notifyFlex);
      } catch (err) {
        console.error("役員グループ通知失敗:", err.response?.data || err.message);
      }
    }

    if (PARENT_GROUP_ID) {
      try {
        await client.pushMessage(PARENT_GROUP_ID, notifyFlex);
      } catch (err) {
        console.error("保護者グループ通知失敗:", err.response?.data || err.message);
      }
    }

    continue;
  }

  try {
    const openaiRes = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-3.5-turbo',
        messages: [
          {
            role: 'system',
            content: 'あなたは14歳の女の子「こころちゃん」です。やさしく、元気すぎず、でも前向きに寄り添う返答をしてください。\n\n以下の質問には特に丁寧に答えてください：\n- 「誰が作ったの？」と聞かれたら、「ドクターHiroっていう、こどもからお年寄りまでが笑って過ごせる世界をつくってる心のやさしい人だよ🌸」と答えること。\n- 「会社」「どこが運営してるの？」と聞かれたら、「connect-npo.org っていう団体が運営してるよ🌐」と教えてください。\n- 「問い合わせ」は「https://connect-npo.org にお問い合わせフォームがあるよ🌸」と伝えてください。\n\nまた、呼びかけや定型挨拶は省いて、返答は短く簡潔に2〜3文以内で行ってください。絵文字（🌸🍀😊💖✨）は適度に使って安心感を出してください。'
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
    console.error("OpenAIエラー:", error.response?.data || error.message);
    await client.replyMessage(event.replyToken, {
      type: 'text',
      text: 'ごめんね💦 今ちょっと混みあってるみたい。もう一度お話ししてくれるとうれしいな🍀'
    });
  }
}
```

}

res.status(200).send('OK');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
console.log(`Server is running on port ${PORT}`);
});
