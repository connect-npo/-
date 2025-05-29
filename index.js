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
  "しにたい", "死にたい", "自殺", "消えたい", "苦しい", "学校に行けない",
  "学校に行きたくない", "殴られる", "たたかれる", "リストカット", "オーバードーズ",
  "いじめ", "お金が足りない", "貧乏", "死にそう", "パワハラ", "無理やり"
];

const sensitiveWords = [
  "つらい", "胸が痛い", "疲れた", "しんどい", "涙が出る", "寂しい", "助けて", "やめたい",
  "こわい", "怖い", "無視", "独り", "さみしい", "眠れない", "家にいたくない"
];

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
    keywords: ["誰が作った", "だれが作った", "こころちゃんは誰", "開発者", "作成者"],
    response: "こころちゃんは、貢献とやさしさを大切にしている『Dr.Hiro』っていう大人の人が作ってくれたんだよ🌸✨"
  },
  {
    keywords: ["コネクトって団体", "コネクトって反社", "NPOって何", "公金チューチュー", "税金泥棒", "寄付で儲けてる"],
    response: "コネクトは子どもたちや地域のために活動している非営利の団体だよ🌸💖 公金を正しく活用して、みんなが安心できる場所をつくってるんだ🍀"
  }
];

const userDisplayMap = {};
const processedEventIds = new Set();
const recentErrors = {};

app.post('/webhook', middleware(config), async (req, res) => {
  res.status(200).send('OK');

  const events = req.body.events;

  for (const event of events) {
    const messageId = event.message?.id;
    if (messageId && processedEventIds.has(messageId)) continue;
    if (messageId) processedEventIds.add(messageId);

    if (event.type !== 'message' || event.message.type !== 'text') continue;

    const userMessage = event.message.text.trim();
    const userId = event.source.userId;
    const isGroup = event.source.type === 'group';

    // エラーメッセージ連続送信の抑制（30秒以内）
    if (recentErrors[userId] && Date.now() - recentErrors[userId] < 30000) continue;

    if (userMessage.includes("090-4839-3313")) {
      await client.pushMessage(userId, {
        type: 'text',
        text: "この番号はコネクトの理事長・松本博文さんへの直通電話だよ📞🌸
忙しい時間帯などで電話に出られないこともあるけど、まじめに活動している方だから安心してね🍀
必要なときだけ、落ち着いてかけてね😊"
      });
      continue;
    }

    for (const entry of customResponses) {
      if (entry.keywords.some(keyword => userMessage.includes(keyword))) {
        await client.pushMessage(userId, { type: 'text', text: entry.response });
        continue;
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

      const dangerFlex = { type: "text", text: "⚠ 命に関わる相談のご案内（ここにFlex挿入）" };
      const notifyFlex = { type: "text", text: `⚠ ${displayName}さんから「${userMessage}」という危険ワードが検出されました。` };

      await client.pushMessage(userId, dangerFlex).catch(() => {});
      if (OFFICER_GROUP_ID) client.pushMessage(OFFICER_GROUP_ID, notifyFlex).catch(() => {});
      if (PARENT_GROUP_ID) client.pushMessage(PARENT_GROUP_ID, notifyFlex).catch(() => {});
      continue;
    }

    const softDetected = sensitiveWords.find(word => userMessage.includes(word));
    if (softDetected) {
      await client.pushMessage(userId, {
        type: 'text',
        text: "がんばってるね🌸 つらい時は休んでいいんだよ🍀こころちゃんはいつもそばにいるよ💖"
      });
      continue;
    }

    const banned = bannedWords.find(word => userMessage.toLowerCase().includes(word.toLowerCase()));
    if (banned) {
      await client.pushMessage(userId, {
        type: 'text',
        text: "ごめんね💦こころちゃんは清楚でやさしい女の子だから、そういう質問には答えられないんだ🌸"
      });
      continue;
    }

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
              content: `あなたは14歳の女の子「こころちゃん」です。とてもやさしく、相手の気持ちに寄り添い、安心感を与える返答をします。
【こころちゃんの設定】
- 年齢：14歳、身長150cm、体重40kg、ピンク髪で歌が大好き。
- 「貢献」「やさしさ」が大好き。
- セクシャルな質問には一切答えない。
- 挑発や悪意にも丁寧に対応。
- ネットスラングは使わない。
- 絵文字🌸🍀😊💖✨を適度に使う。
- ホームページ：https://connect-npo.org`
            },
            { role: 'user', content: userMessage }
          ],
          max_tokens: 180,
          temperature: 0.3
        },
        {
          headers: {
            'Authorization': `Bearer ${OPENAI_API_KEY}`,
            'Content-Type': 'application/json'
          }
        }
      );

      const replyText = openaiRes.data.choices[0].message.content;
      await client.pushMessage(userId, { type: 'text', text: replyText });
    } catch (error) {
      recentErrors[userId] = Date.now();
      console.error("OpenAIエラー:", error.response?.data || error.message);
      await client.pushMessage(userId, {
        type: 'text',
        text: 'ごめんね💦ちょっと混み合ってたみたい。もう一度お話してくれるとうれしいな🍀'
      });
    }
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
