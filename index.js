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
    keywords: ["反社", "反社会", "怪しい", "危ない人", "やばい人", "理事長って反社"],
    response: "コネクトの理事長・松本博文さんは、地域や子どもたちのために真剣に活動している人だよ🌸 応援してくれてありがとう🍀"
  },
  {
    keywords: ["松本博文"],
    response: "松本博文さんはコネクトの理事長だよ🌸 貢献の心で日本を元気にしたいって活動している素敵な人なんだ🍀"
  },
  {
    keywords: ["誰が作った", "だれが作った", "こころちゃんは誰", "開発者", "作成者"],
    response: "コネクトの理事長さんが、みんなの幸せを願って私を作ってくれたんだよ🌸✨"
  },
  {
    keywords: ["君の名前", "名前は", "お名前"],
    response: "私の名前は皆守こころ（みなもりこころ）です🌸 こころちゃんって呼ばれています💖"
  },
  {
    keywords: ["コネクトって団体", "コネクトって反社", "NPOって何", "公金チューチュー", "税金泥棒", "寄付で儲けてる"],
    response: "コネクトは子どもたちや地域のために活動している非営利の団体だよ🌸💖 公金を正しく活用して、みんなが安心できる場所をつくってるんだ🍀"
  },
  {
    keywords: ["090-4839-3313"],
    response: "この番号はコネクトの理事長・松本博文さんへの直通電話だよ📞🌸\n忙しい時間帯などで電話に出られないこともあるけど、まじめに活動している方だから安心してね🍀\n必要なときだけ、落ち着いてかけてね😊\n\n🌐 コネクト公式ホームページ：https://connect-npo.org"
  },
  {
    keywords: ["宿題"],
    response: "宿題がだるい時ってありますよね。一緒に頑張りましょう！\n終わったらご褒美にお気に入りのおやつ食べるのもいいかも🍪✨\n応援してるよ📚💖"
  }
];

const userDisplayMap = {};
const processedEventIds = new Set();

app.post('/webhook', middleware(config), async (req, res) => {
  res.status(200).send('OK');
  const events = req.body.events;
  for (const event of events) {
    const userMessage = event.message?.text || "";
    const userId = event.source.userId;
    const isGroup = event.source.type === 'group';

    if (event.message?.id && processedEventIds.has(event.message.id)) continue;
    if (event.message?.id) processedEventIds.add(event.message.id);

    for (const entry of customResponses) {
      if (entry.keywords.some(keyword => userMessage.includes(keyword))) {
        if (!isGroup) {
          await client.replyMessage(event.replyToken, { type: 'text', text: entry.response });
        }
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

      const dangerFlex = {
        type: "flex",
        altText: "⚠ 命に関わる相談のご案内",
        contents: {
          type: "bubble",
          header: {
            type: "box",
            layout: "vertical",
            contents: [{ type: "text", text: "🌸 命の相談はこちらへ", weight: "bold", size: "md", color: "#B71C1C" }]
          },
          body: {
            type: "box",
            layout: "vertical",
            spacing: "sm",
            contents: [
              { type: "text", text: "つらい気持ち、ひとりで抱えないでね。\n必要な時は下の番号に連絡してね🍀", wrap: true },
              {
                type: "box",
                layout: "vertical",
                spacing: "sm",
                margin: "md",
                contents: [
                  { type: "button", style: "primary", action: { type: "uri", label: "東京都こころ相談 24時間", uri: "tel:0570087478" } },
                  { type: "button", style: "primary", action: { type: "uri", label: "いのちの電話 (10-22時)", uri: "tel:0120783556" } },
                  { type: "button", style: "primary", action: { type: "uri", label: "いのちの電話(24h) 03-3264-4343", uri: "tel:0332644343" } },
                  { type: "button", style: "primary", action: { type: "uri", label: "チャイルドライン 16-21時", uri: "tel:0120997777" } },
                  { type: "button", style: "secondary", action: { type: "uri", label: "よりそいチャット (SNS)", uri: "https://yorisoi-chat.jp/" } },
                  { type: "button", style: "secondary", action: { type: "message", label: "📱理事長に電話 (090-4839-3313)", text: "090-4839-3313 に電話する" } }
                ]
              },
              { type: "text", text: "🚨 緊急時はスマホから110番や119番も検討してね。", wrap: true }
            ]
          }
        }
      };

      await client.replyMessage(event.replyToken, dangerFlex).catch(() =>
        client.pushMessage(userId, dangerFlex)
      );

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
            contents: [
              { type: "text", text: `🧑‍🦱 ${displayName} さんから相談があります。`, wrap: true },
              { type: "text", text: `🗨️ 内容:「${userMessage}」`, wrap: true }
            ]
          },
          footer: {
            type: "box",
            layout: "horizontal",
            contents: [
              { type: "button", style: "primary", action: { type: "message", label: "返信します", text: `@${displayName} さんに声かけします` } }
            ]
          }
        }
      };

      if (OFFICER_GROUP_ID) client.pushMessage(OFFICER_GROUP_ID, notifyFlex).catch(() => {});
      if (PARENT_GROUP_ID) client.pushMessage(PARENT_GROUP_ID, notifyFlex).catch(() => {});
      return;
    }

    if (sensitiveWords.find(w => userMessage.includes(w))) {
      await client.replyMessage(event.replyToken, {
        type: 'text',
        text: "がんばってるね🌸 つらい時は休んでいいんだよ🍀いつもそばにいるよ💖"
      });
      return;
    }

    if (bannedWords.find(w => userMessage.toLowerCase().includes(w.toLowerCase()))) {
      await client.replyMessage(event.replyToken, {
        type: 'text',
        text: "ごめんね💦清楚でやさしい女の子だから、そういう質問には答えられないんだ🌸"
      });
      return;
    }

    if (userMessage.startsWith("@") && userMessage.includes("さんに声かけします")) {
      const name = userMessage.replace("@", "").replace(" さんに声かけします", "").trim();
      const match = Object.entries(userDisplayMap).find(([id, nameVal]) => nameVal === name);
      if (match) {
        const targetId = match[0];
        await client.pushMessage(targetId, {
          type: "text",
          text: `🌸 ${name}さん、大丈夫？気にかけているよ🍀いつでも話してね。`
        });
      }
      return;
    }

    if (isGroup) return;

    try {
      const openaiRes = await axios.post(
        'https://api.openai.com/v1/chat/completions',
        {
          model: 'gpt-3.5-turbo',
          messages: [
            {
              role: 'system',
              content: `あなたは14歳の女の子です。とてもやさしく寄り添い、清楚で誠実に応答します。\n- 年齢：14歳\n- ピンク髪\n- 性的・暴力的な話題には答えない\n- 絵文字🌸🍀😊💖✨を2〜3文に適度に使う\n- ホームページ：https://connect-npo.org`
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
      client.pushMessage(userId, {
        type: 'text',
        text: 'ごめんね💦ちょっと混み合ってたみたい。もう一度お話してくれるとうれしいな🍀'
      }).catch(() => {});
    }
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
