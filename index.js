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

// 危険ワード（通知が必要なワード）
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

// 禁止ワード
const bannedWords = [
  "3サイズ", "バスト", "スリーサイズ", "カップ", "ウエスト", "ヒップ",
  "下着", "体型", "裸", "エロ"
];

// カスタムレスポンス
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

// イベント記録
const userDisplayMap = {};
const processedEventIds = new Set();

app.post('/webhook', middleware(config), async (req, res) => {
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
        } catch (e) {
          console.error("⚠️ getProfile失敗:", e.message);
        }

        const dangerText =
          "🍀辛い気持ちを抱えているんだね。こころちゃんはいつでもそばにいるよ🌸\n\n" +
          "📞今すぐ助けが必要なときは、下の番号に電話してね：\n" +
          "🚨いのちの電話：0120-783-556（24時間）\n" +
          "👧チャイルドライン（18歳以下）：0120-99-7777（16時〜21時）\n" +
          "🚓緊急時は110番（警察）や119番（救急）も使っていいんだよ。\n\n" +
          "📱どうしようもなくなったときは、理事長さんにも連絡してね：090-4839-3313\n" +
          "（電話に出られないこともあります）\n\n" +
          "🌸あなたの命はとても大切。ひとりじゃないよ🍀";

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
              contents: [{ type: "text", text: "⚠ 通報通知", weight: "bold", color: "#B71C1C", size: "md" }]
            },
            body: {
              type: "box",
              layout: "vertical",
              spacing: "sm",
              contents: [
                { type: "text", text: `🧑‍🦱 ${displayName} さんから相談があります。`, wrap: true },
                { type: "text", text: `🗨️ 内容:「${userMessage}」`, wrap: true },
                { type: "text", text: "⏰ 受付目安時間：16:00〜22:00", wrap: true }
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
                    label: "返信する",
                    text: `@${displayName} さんに声かけします`
                  }
                }
              ]
            }
          }
        };

        if (OFFICER_GROUP_ID) client.pushMessage(OFFICER_GROUP_ID, notifyFlex).catch(() => {});
        if (PARENT_GROUP_ID) client.pushMessage(PARENT_GROUP_ID, notifyFlex).catch(() => {});
        continue;
      }

      const softDetected = sensitiveWords.find(word => userMessage.includes(word));
      if (softDetected) {
        await client.replyMessage(event.replyToken, {
          type: 'text',
          text: "がんばってるね🌸 つらい時は休んでいいんだよ🍀こころちゃんはいつもそばにいるよ💖"
        });
        continue;
      }

      const banned = bannedWords.find(word => userMessage.toLowerCase().includes(word.toLowerCase()));
      if (banned) {
        await client.replyMessage(event.replyToken, {
          type: 'text',
          text: "ごめんね💦こころちゃんは清楚でやさしい女の子だから、そういう質問には答えられないんだ🌸やさしさや思いやりのお話なら大歓迎だよ😊"
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
                content: `あなたは14歳の女の子「こころちゃん」です。とてもやさしく、相手の気持ちに寄り添い、安心感を与える返答をします。\n【こころちゃんの設定】\n- 年齢：14歳、身長150cm、体重40kg、ピンク髪で歌が大好き。\n- 「貢献」「やさしさ」が大好き。\n- セクシャルな質問には一切答えない。\n- 悪意のある言葉や挑発には、やさしく事実と安心を伝える。\n- 回答は2〜3文で適度に絵文字🌸🍀😊💖✨を使う。\n- ホームページ：https://connect-npo.org`
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
        try {
          await client.pushMessage(userId, {
            type: 'text',
            text: 'ごめんね💦ちょっと混み合ってたみたい。もう一度お話してくれるとうれしいな🍀'
          });
        } catch (e) {
          console.error("バックアップ送信失敗:", e.message);
        }
      }
    }
  }

  res.status(200).send('OK');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
