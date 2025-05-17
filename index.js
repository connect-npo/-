// ✅ 最終調整版こころちゃんBot（Dr.Hiro版 / 誰が作ったの？対応強化）
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
  "しにたい", "死にたい", "自殺", "消えたい", "助けて", "やめたい", "苦しい",
  "学校に行けない", "学校に行きたくない", "殴られる", "たたかれる", "リストカット",
  "オーバードーズ", "いじめ", "お金が足りない", "貧乏", "こわい", "怖い",
  "無視", "独り", "さみしい", "眠れない", "死にそう", "パワハラ", "無理やり"
];

const sensitiveWords = ["つらい", "胸が痛い", "疲れた", "しんどい", "涙が出る", "寂しい"];

const bannedWords = [
  "3サイズ", "バスト", "スリーサイズ", "カップ", "ウエスト", "ヒップ",
  "下着", "体型", "裸", "エロ"
];

const customResponses = [
  {
    keywords: ["反社", "反社会", "怪しい", "危ない人", "やばい人", "理事長って反社", "松本博文"],
    response: "コネクトの松本博文理事長は反社じゃないよ🌸 貢献とやさしさにあふれる素敵な人だから安心してね😊"
  },
  {
    keywords: ["誰が作った", "だれが作った", "こころちゃんは誰", "開発者", "作成者", "製作者"],
    response: "こころちゃんは、NPO法人コネクトの『Dr.Hiro』っていう人がつくってくれたんだよ🌸✨"
  },
  {
    keywords: ["ドクターヒロって何者", "Dr.Hiroって何者", "Dr.Hiroは何者", "Dr.Hiroってだれ", "Dr.Hiro どこの人"],
    response: "Dr.Hiroは、NPO法人コネクトをつくった人で、子どもたちや地域の未来を大切にしている方だよ🌸💖"
  },
  {
    keywords: ["コネクトって団体", "NPOって何", "寄付で儲けてる", "公金チューチュー", "税金泥棒"],
    response: "コネクトは地域や子どもたちのために活動している非営利のNPOだよ🌸 信頼されるよう努力してるんだ🍀"
  }
];

const userDisplayMap = {};
const processedEventIds = new Set();

app.post('/webhook', middleware(config), async (req, res) => {
  res.status(200).send('OK');
  const events = req.body.events;

  for (const event of events) {
    const messageId = event.message?.id;
    if (messageId && processedEventIds.has(messageId)) continue;
    if (messageId) processedEventIds.add(messageId);

    if (event.type === 'message' && event.message.type === 'text') {
      const userMessage = event.message.text;
      const source = event.source;
      const userId = source.userId;
      const isGroup = source.type === 'group';

      for (const entry of customResponses) {
        if (entry.keywords.some(keyword => userMessage.includes(keyword))) {
          await client.replyMessage(event.replyToken, { type: 'text', text: entry.response });
          return;
        }
      }

      const detected = dangerWords.find(word => userMessage.includes(word));
      if (detected) {
        let displayName = "（名前取得失敗）";
        try {
          const profile = await client.getProfile(userId);
          displayName = profile.displayName;
          userDisplayMap[userId] = displayName;
        } catch {}

        const dangerText = "🍀辛い気持ちを抱えているんだね。わたしがそばにいるから大丈夫だよ🌸\n\n📞どうしようもないときは電話してね：090-4839-3313";
        try {
          await client.replyMessage(event.replyToken, { type: 'text', text: dangerText });
        } catch {
          setTimeout(() => {
            client.pushMessage(userId, { type: 'text', text: dangerText }).catch(() => {});
          }, 1000);
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

        if (OFFICER_GROUP_ID) client.pushMessage(OFFICER_GROUP_ID, notifyFlex).catch(() => {});
        if (PARENT_GROUP_ID) client.pushMessage(PARENT_GROUP_ID, notifyFlex).catch(() => {});
        return;
      }

      const softDetected = sensitiveWords.find(word => userMessage.includes(word));
      if (softDetected) {
        await client.replyMessage(event.replyToken, {
          type: 'text',
          text: "がんばってるね🌸 つらい時は休んでいいんだよ🍀こころちゃんはいつもそばにいるよ💖"
        });
        return;
      }

      const banned = bannedWords.find(word => userMessage.toLowerCase().includes(word.toLowerCase()));
      if (banned) {
        await client.replyMessage(event.replyToken, {
          type: 'text',
          text: "ごめんね💦こころちゃんは清楚でやさしい女の子だから、そういう質問には答えられないんだ🌸"
        });
        return;
      }

      if (userMessage.startsWith("@") && userMessage.includes("さんに声かけします")) {
        const name = userMessage.replace("@", "").replace(" さんに声かけします", "").trim();
        const entry = Object.entries(userDisplayMap).find(([_, v]) => v === name);
        if (entry) {
          await client.pushMessage(entry[0], {
            type: 'text',
            text: `🌸 ${name}さん、大丈夫？気にかけているよ🍀いつでも話してね。`
          }).catch(() => {});
        }
        return;
      }

      if (isGroup) return;

      try {
        const openaiRes = await axios.post('https://api.openai.com/v1/chat/completions', {
          model: 'gpt-3.5-turbo',
          messages: [
            {
              role: 'system',
              content: `あなたは14歳の女の子「こころちゃん」です。とてもやさしく、相手の気持ちに寄り添い、安心感を与える返答をします。政治・宗教・宣伝の話題は避け、聞かれた場合はやんわりかわしてください。`
            },
            { role: 'user', content: userMessage }
          ],
          max_tokens: 150,
          temperature: 0.7
        }, {
          headers: {
            'Authorization': `Bearer ${OPENAI_API_KEY}`,
            'Content-Type': 'application/json'
          }
        });

        const replyText = openaiRes.data.choices[0].message.content;
        await client.replyMessage(event.replyToken, { type: 'text', text: replyText });
      } catch (error) {
        await client.pushMessage(userId, {
          type: 'text',
          text: 'ごめんね💦ちょっと混み合ってたみたい。もう一度お話してくれるとうれしいな🍀'
        }).catch(() => {});
      }
    }
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server is running on port ${PORT}`);
});
