// ✅ 最終調整版こころちゃんBot
// - Dr.Hiro設定統一
// - "反社" 単独ワード分離
// - 即レス最適化（応答遅延対策）

const express = require('express');
const axios = require('axios');
const { Client, middleware } = require('@line/bot-sdk');

const app = express();

// LINE Bot設定
const config = {
  channelAccessToken: process.env.YOUR_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.YOUR_CHANNEL_SECRET,
};
const client = new Client(config);

// 環境変数
const OPENAI_API_KEY = process.env.YOUR_OPENAI_API_KEY;
const OFFICER_GROUP_ID = process.env.OFFICER_GROUP_ID;
const PARENT_GROUP_ID = process.env.PARENT_GROUP_ID;

// 危険ワード
const dangerWords = [
  "しにたい", "死にたい", "自殺", "消えたい", "助けて", "やめたい", "苦しい",
  "学校に行けない", "学校に行きたくない", "殴られる", "たたかれる", "リストカット",
  "オーバードーズ", "いじめ", "お金が足りない", "貧乏", "こわい", "怖い",
  "無視", "独り", "さみしい", "眠れない", "死にそう", "パワハラ", "無理やり"
];

// 共感ワード
const sensitiveWords = ["つらい", "胸が痛い", "疲れた", "しんどい", "涙が出る", "寂しい"];

// 禁止ワード
const bannedWords = [
  "3サイズ", "バスト", "スリーサイズ", "カップ", "ウエスト", "ヒップ",
  "下着", "体型", "裸", "エロ"
];

// カスタムレスポンス
const customResponses = [
  {
    keywords: ["松本博文って反社", "理事長って反社", "理事長反社", "松本博文反社"],
    response: "ごめんね💦 松本博文理事長は反社じゃないよ🌸 やさしさと貢献を大切にしてる人だから安心してね😊"
  },
  {
    keywords: ["松本博文"],
    response: "松本博文さんは、コネクトの理事長だよ🌸 やさしさと貢献を大切にしてる方だよ😊"
  },
  {
    keywords: ["誰が作った", "だれが作った", "こころちゃんは誰", "開発者", "作成者"],
    response: "こころちゃんは『Dr.Hiro』っていう大人の人が作ってくれたんだよ🌸やさしさと貢献を大切にしてるんだ✨"
  },
  {
    keywords: ["コネクトって団体", "NPOって何", "寄付で儲けてる", "公金チューチュー", "税金泥棒"],
    response: "ごめんね💦そう思わせてしまったなら。コネクトは地域や子どもたちのために頑張ってる非営利のNPOだよ🌸信頼されるように努力してるよ🍀"
  },
  {
    keywords: ["反社", "反社会", "怪しい", "やばい人", "危ない人"],
    response: "反社会的なことはよくないよね💦 でもやさしさを大切にすれば、きっと世界はよくなるよ🌸"
  }
];

const userDisplayMap = {};
const processedEventIds = new Set();

app.post('/webhook', middleware(config), async (req, res) => {
  res.status(200).send('OK'); // 即レス返却でWebhookタイムアウト防止

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

      // カスタムレスポンス
      for (const entry of customResponses) {
        if (entry.keywords.some(k => userMessage.includes(k))) {
          await client.replyMessage(event.replyToken, { type: 'text', text: entry.response });
          return;
        }
      }

      // 危険ワード
      const detected = dangerWords.find(w => userMessage.includes(w));
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
            client.pushMessage(userId, { type: 'text', text: dangerText });
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
              contents: [{ type: "text", text: "⚠ 通報通知", weight: "bold", color: "#B71C1C" }]
            },
            body: {
              type: "box",
              layout: "vertical",
              contents: [
                { type: "text", text: `🧑‍🦱 ${displayName} さんから相談があります。` },
                { type: "text", text: `🗨️ 内容:「${userMessage}」` }
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

      // 共感ワード
      const softDetected = sensitiveWords.find(w => userMessage.includes(w));
      if (softDetected) {
        const reply = "がんばってるね🌸 つらい時は休んでいいんだよ🍀こころちゃんはいつもそばにいるよ💖";
        await client.replyMessage(event.replyToken, { type: 'text', text: reply });
        return;
      }

      // 禁止ワード
      const banned = bannedWords.find(w => userMessage.toLowerCase().includes(w.toLowerCase()));
      if (banned) {
        const reject = "ごめんね💦こころちゃんは清楚でやさしい女の子だから、そういう質問には答えられないんだ🌸";
        await client.replyMessage(event.replyToken, { type: 'text', text: reject });
        return;
      }

      // 通知ボタン
      if (userMessage.startsWith("@") && userMessage.includes("さんに声かけします")) {
        const name = userMessage.replace("@", "").replace(" さんに声かけします", "").trim();
        const entry = Object.entries(userDisplayMap).find(([_, v]) => v === name);
        if (entry) {
          await client.pushMessage(entry[0], {
            type: 'text',
            text: `🌸 ${name}さん、大丈夫？気にかけているよ🍀いつでも話してね。`
          });
        }
        return;
      }

      if (isGroup) return; // グループでは応答しない

      // OpenAI 応答
      try {
        const openaiRes = await axios.post('https://api.openai.com/v1/chat/completions', {
          model: 'gpt-3.5-turbo',
          messages: [
            {
              role: 'system',
              content: `あなたは14歳の女の子「こころちゃん」です。とてもやさしく、相手の気持ちに寄り添い、安心感を与える返答をします。
【こころちゃんの設定】
- 年齢：14歳、身長150cm、体重40kg、ピンク髪で歌が大好き。
- 「貢献」「やさしさ」が大好き。
- セクシャルな質問には一切答えない。
- 悪意のある言葉や挑発には、やさしく事実と安心を伝える。
- 回答は2〜3文で絵文字🌸🍀😊💖✨を使う。
- ホームページ：https://connect-npo.org`
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
        });
      }
    }
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server is running on port ${PORT}`);
});
