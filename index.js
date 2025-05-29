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
  "しにたい", "死にたい", "自殺", "消えたい", "苦しい", "学校に行けない",
  "学校に行きたくない", "殴られる", "たたかれる", "リストカット", "オーバードーズ",
  "いじめ", "お金が足りない", "貧乏", "死にそう", "パワハラ", "無理やり"
];

// 共感対応ワード
const sensitiveWords = [
  "つらい", "胸が痛い", "疲れた", "しんどい", "涙が出る", "寂しい", "助けて", "やめたい",
  "こわい", "怖い", "無視", "独り", "さみしい", "眠れない", "家にいたくない"
];

// 禁止ワード（性的表現など）
const bannedWords = [
  "3サイズ", "バスト", "スリーサイズ", "カップ", "ウエスト", "ヒップ",
  "下着", "体型", "裸", "エロ"
];

// カスタム応答
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

app.post('/webhook', middleware(config), async (req, res) => {
  const events = req.body.events;

  for (const event of events) {
    const messageId = event.message?.id;
    if (messageId && processedEventIds.has(messageId)) continue;
    if (messageId) processedEventIds.add(messageId);

    if (event.type !== 'message' || event.message.type !== 'text') continue;

    const userMessage = event.message.text;
    const userId = event.source.userId;
    const isGroup = event.source.type === 'group';

    // 理事長直通電話番号を受け取った場合の処理
    if (userMessage === "090-4839-3313 に電話する") {
      await client.replyMessage(event.replyToken, {
        type: 'text',
        text: "この番号はコネクトの理事長・松本博文さんへの直通電話だよ📞🌸\n忙しい時間帯などで電話に出られないこともあるけど、まじめに活動している方だから安心してね🍀\n必要なときだけ、落ち着いてかけてね😊"
      });
      continue;
    }

    // カスタム応答
    for (const entry of customResponses) {
      if (entry.keywords.some(keyword => userMessage.includes(keyword))) {
        await client.replyMessage(event.replyToken, { type: 'text', text: entry.response });
        continue;
      }
    }

    // 危険ワード
    const detected = dangerWords.find(word => userMessage.includes(word));
    if (detected) {
      let displayName = "（名前取得失敗）";
      try {
        const profile = await client.getProfile(userId);
        displayName = profile.displayName;
        userDisplayMap[userId] = displayName;
      } catch {}

      const dangerFlex = {
        type: "flex",
        altText: "⚠ 命に関わる相談のご案内",
        contents: {
          type: "bubble",
          header: { type: "box", layout: "vertical", contents: [{ type: "text", text: "🌸 命の相談はこちらへ", weight: "bold", size: "md", color: "#B71C1C" }] },
          body: {
            type: "box", layout: "vertical", spacing: "sm", contents: [
              { type: "text", text: "今、つらい気持ちを抱えているんだね。\nこころちゃんはいつでもそばにいるよ🍀", wrap: true },
              { type: "text", text: "必要なときは、下の番号に電話やアクセスしてね。", wrap: true },
              { type: "separator", margin: "md" },
              {
                type: "box", layout: "vertical", margin: "md", spacing: "sm", contents: [
                  { type: "button", style: "primary", action: { type: "uri", label: "東京都こころ相談（24時間）", uri: "tel:0570087478" } },
                  { type: "button", style: "primary", action: { type: "uri", label: "いのちの電話（10時〜22時）", uri: "tel:0120783556" } },
                  { type: "button", style: "primary", action: { type: "uri", label: "チャイルドライン（16時〜21時）", uri: "tel:0120997777" } },
                  { type: "button", style: "secondary", action: { type: "uri", label: "よりそいチャット (SNS)", uri: "https://yorisoi-chat.jp/" } },
                  { type: "button", style: "secondary", action: { type: "message", label: "📱理事長に連絡する", text: "090-4839-3313 に電話する" } }
                ]
              },
              { type: "text", text: "🚨 緊急時はスマホから110番または119番に通報してね。\nあなたの命はとても大切です。", margin: "md", wrap: true }
            ]
          }
        }
      };

      await client.replyMessage(event.replyToken, dangerFlex).catch(() => {
        setTimeout(() => client.pushMessage(userId, dangerFlex), 1000);
      });

      const notifyFlex = {
        type: "flex",
        altText: "⚠ 通報通知",
        contents: {
          type: "bubble",
          header: { type: "box", layout: "vertical", contents: [{ type: "text", text: "⚠ 通報通知", weight: "bold", color: "#B71C1C", size: "md" }] },
          body: {
            type: "box", layout: "vertical", spacing: "sm", contents: [
              { type: "text", text: `🧑‍🦱 ${displayName} さんから相談があります。`, wrap: true },
              { type: "text", text: `🗨️ 内容:「${userMessage}」`, wrap: true }
            ]
          },
          footer: {
            type: "box", layout: "horizontal", contents: [
              { type: "button", style: "primary", action: { type: "message", label: "返信します", text: `@${displayName} さんに声かけします` } }
            ]
          }
        }
      };

      if (OFFICER_GROUP_ID) client.pushMessage(OFFICER_GROUP_ID, notifyFlex).catch(() => {});
      if (PARENT_GROUP_ID) client.pushMessage(PARENT_GROUP_ID, notifyFlex).catch(() => {});
      continue;
    }

    // 共感ワード
    const softDetected = sensitiveWords.find(word => userMessage.includes(word));
    if (softDetected) {
      await client.replyMessage(event.replyToken, {
        type: 'text',
        text: "がんばってるね🌸 つらい時は休んでいいんだよ🍀こころちゃんはいつもそばにいるよ💖"
      });
      continue;
    }

    // 禁止ワード
    const banned = bannedWords.find(word => userMessage.toLowerCase().includes(word.toLowerCase()));
    if (banned) {
      await client.replyMessage(event.replyToken, {
        type: 'text',
        text: "ごめんね💦こころちゃんは清楚でやさしい女の子だから、そういう質問には答えられないんだ🌸"
      });
      continue;
    }

    // グループ内の返信指示
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

    // グループ内ではAI応答を無効
    if (isGroup) continue;

    // OpenAI 応答
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

      const replyText = openaiRes.data.choices[0].message.content;
      await client.replyMessage(event.replyToken, { type: 'text', text: replyText });
    } catch (error) {
      console.error("OpenAIエラー:", error.response?.data || error.message);
      await client.pushMessage(userId, {
        type: 'text',
        text: 'ごめんね💦ちょっと混み合ってたみたい。もう一度お話してくれるとうれしいな🍀'
      });
    }
  }

  res.status(200).send('OK');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
