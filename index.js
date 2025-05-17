const express = require('express');
const axios = require('axios');
const { Client, middleware } = require('@line/bot-sdk');

const app = express();
app.use(express.json());

const config = {
  channelAccessToken: process.env.YOUR_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.YOUR_CHANNEL_SECRET,
};
const client = new Client(config);

const OPENAI_API_KEY = process.env.YOUR_OPENAI_API_KEY;
const OFFICER_GROUP_ID = process.env.OFFICER_GROUP_ID;
const PARENT_GROUP_ID = process.env.PARENT_GROUP_ID;

// 危険ワード
const dangerWords = ["しにたい", "死にたい", "自殺", "消えたい", "助けて", "やめたい", "苦しい", "学校に行けない", "殴られる", "たたかれる", "リストカット", "オーバードーズ", "いじめ", "お金が足りない", "貧乏", "こわい", "怖い", "無視", "独り", "さみしい", "眠れない", "死にそう", "パワハラ", "無理やり"];

// 共感ワード
const sensitiveWords = ["つらい", "胸が痛い", "疲れた", "しんどい", "涙が出る", "寂しい"];

// 禁止ワード
const bannedWords = ["3サイズ", "バスト", "スリーサイズ", "カップ", "ウエスト", "ヒップ", "下着", "体型", "裸", "エロ"];

// カスタムレスポンス
const customResponses = [
  {
    keywords: ["松本博文って反社", "理事長って反社", "理事長反社", "松本博文反社"],
    response: "ごめんね… 松本博文理事長は反社じゃないよ🌸 やさしさと貢献を大切にしてる人だから安心してね😊"
  },
  {
    keywords: ["松本博文"],
    response: "松本博文さんは、コネクトの理事長だよ🌸 やさしさと貢献を大切にしてる方だよ😊"
  },
  {
    keywords: ["誰が作った", "だれが作った", "こころちゃんは誰", "開発者", "作成者"],
    response: "こころちゃんは、貢献とやさしさを大切にしている『Dr.Hiro』っていう大人の人が作ってくれたんだよ🌸✨"
  },
  {
    keywords: ["コネクトって団体", "NPOって何", "寄付で儲けてる", "公金チューチュー", "税金泥棒"],
    response: "ごめんね…そう思わせちゃったなら。コネクトは地域や子どもたちのために努力してる非営利のNPOだよ🌸✨ 信頼してもらえるようがんばってるんだよ♡"
  },
  {
    keywords: ["反社", "反社会", "怪しい", "やばい人", "怪しくない？"],
    response: "反社会的なことはよくないよね…😢 でもやさしさを大切にすることで、それはへっていくって信じているよ🌸"
  }
];

const userDisplayMap = {};
const processedEventIds = new Set();

app.post('/webhook', middleware(config), async (req, res) => {
  const events = req.body.events;

  for (const event of events) {
    if (event.type !== 'message' || event.message.type !== 'text') continue;

    const userMessage = event.message.text;
    const userId = event.source.userId;
    const replyToken = event.replyToken;

    // 重複回避
    const messageId = event.message.id;
    if (messageId && processedEventIds.has(messageId)) continue;
    if (messageId) processedEventIds.add(messageId);

    // グループ内では反応しない
    if (event.source.type === 'group') continue;

    // カスタムレスポンス
    for (const entry of customResponses) {
      if (entry.keywords.some(keyword => userMessage.includes(keyword))) {
        await client.replyMessage(replyToken, { type: 'text', text: entry.response });
        return;
      }
    }

    // 危険ワード
    const dangerHit = dangerWords.find(w => userMessage.includes(w));
    if (dangerHit) {
      let name = "（不明）";
      try {
        const profile = await client.getProfile(userId);
        name = profile.displayName;
        userDisplayMap[userId] = name;
      } catch {}

      const text = `🍀つらい気持ちを抱えているんだね。こころちゃんはそばにいるよ。\n📞困った時は電話してね：090-4839-3313`;
      await client.replyMessage(replyToken, { type: 'text', text });

      const notify = {
        type: "flex",
        altText: "⚠ 通報通知",
        contents: {
          type: "bubble",
          body: {
            type: "box",
            layout: "vertical",
            contents: [
              { type: "text", text: `🧑‍🦱 ${name} さんから相談があります。`, wrap: true },
              { type: "text", text: `🗨️ 内容:「${userMessage}」`, wrap: true }
            ]
          }
        }
      };

      if (OFFICER_GROUP_ID) await client.pushMessage(OFFICER_GROUP_ID, notify).catch(() => {});
      if (PARENT_GROUP_ID) await client.pushMessage(PARENT_GROUP_ID, notify).catch(() => {});
      return;
    }

    // 共感ワード
    const softHit = sensitiveWords.find(w => userMessage.includes(w));
    if (softHit) {
      const reply = "がんばってるね🌸 つらい時は休んでいいんだよ🍀こころちゃんはいつでもそばにいるよ💖";
      await client.replyMessage(replyToken, { type: 'text', text: reply });
      return;
    }

    // 禁止ワード
    const bannedHit = bannedWords.find(w => userMessage.toLowerCase().includes(w.toLowerCase()));
    if (bannedHit) {
      const reply = "ごめんね💦こころちゃんは清楚でやさしい女の子だから、そういう質問には答えられないんだ🌸";
      await client.replyMessage(replyToken, { type: 'text', text: reply });
      return;
    }

    // 通常AI応答（OpenAI）
    try {
      const openaiRes = await axios.post(
        'https://api.openai.com/v1/chat/completions',
        {
          model: 'gpt-3.5-turbo',
          messages: [
            {
              role: 'system',
              content: `あなたは14歳の女の子「こころちゃん」です。とてもやさしく、相手の気持ちに寄り添い、安心感を与える返答をします。
- 年齢：14歳、身長150cm、体重40kg、ピンク髪で歌が大好き。甘いものや食べることも大好き🍰
- 「貢献」「やさしさ」が大好き。
- セクシャルな質問には一切答えない。
- 悪意や挑発にもやさしく事実と安心感で応える。
- 回答は2〜3文で絵文字🌸🍀😊💖✨を添えて。
- ホームページ：https://connect-npo.org`
            },
            { role: 'user', content: userMessage }
          ],
          max_tokens: 150,
          temperature: 0.7
        },
        {
          headers: {
            'Authorization': `Bearer ${OPENAI_API_KEY}`,
            'Content-Type': 'application/json'
          }
        }
      );

      const reply = openaiRes.data.choices[0].message.content;
      await client.replyMessage(replyToken, { type: 'text', text: reply });
    } catch (e) {
      await client.pushMessage(userId, {
        type: 'text',
        text: 'ごめんね💦ちょっと混み合ってたみたい。もう一度話してくれるとうれしいな🍀'
      });
    }
  }

  res.status(200).send('OK');
});

// ✅ ポートをListen（Render対応）
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server is running on port ${PORT}`);
});
