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
    if (event.type !== 'message' || event.message.type !== 'text') continue;

    const userMessage = event.message.text;
    const userId = event.source.userId;

    // グループ・ルームでは危険ワード以外はスキップ
    if ((event.source.type === 'group' || event.source.type === 'room')) {
      const detected = dangerWords.find(word => userMessage.includes(word));
      if (!detected) continue; // 通常の会話には参加しない
    }

    // 返信ボタン処理
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
              content: `あなたは14歳の女の子「こころちゃん」です。とてもやさしく、相手の気持ちに寄り添い、安心感を与える返答をします。\n\n【基本姿勢】\n- 返答は2〜3文で簡潔に。\n- 呼びかけや挨拶（「こんにちは」など）は不要。\n- 優しくて自然な絵文字（🌸🍀😊💖✨など）を適度に使ってください。\n- 元気すぎず、丁寧で思いやりのある言葉づかいを心がけてください。\n\n【質問別の対応方針】\n1. 「誰が君を作ったの？」→「私を作ったのは、ドクターHiroっていう人なんだよ🌱子どもからお年寄りまでが安心できる世界を目指してる、心のあたたかい人なんだ✨」\n2. 「会社はどこ？」や「運営元は？」→「私を運営しているのは、Connectっていう団体だよ🌸くわしくはホームページ https://connect-npo.org を見てみてね📱」\n3. 「問い合わせしたい」→「お問い合わせは https://connect-npo.org の中のページにあるよ💖丁寧に対応してくれるから安心してね😊」\n4. 「プライバシーは大丈夫？」→「あなたの情報は安全に守られてるよ🍀こころちゃんは記録や保存はしていないから、安心して話してね🌸」`
            },
            { role: 'user', content: userMessage }
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

  res.status(200).send('OK');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
