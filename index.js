require('dotenv').config(); // .env ファイルから環境変数を読み込む

const express = require('express');
const { Client } = require('@line/bot-sdk'); // LineClient を Client に修正
const { MongoClient } = require('mongodb');
const cron = require('node-cron');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// 環境変数から設定を読み込む
const CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;
const MONGODB_URI = process.env.MONGODB_URI;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const OWNER_USER_ID = process.env.OWNER_USER_ID;
const OFFICER_GROUP_ID = process.env.OFFICER_GROUP_ID;
// BOT_ADMIN_IDS はJSON文字列として設定されるため、JSON.parse() でパースする
const BOT_ADMIN_IDS = process.env.BOT_ADMIN_IDS ? JSON.parse(process.env.BOT_ADMIN_IDS) : []; // 管理者IDのリスト

const app = express();
app.use(express.json());

const client = new Client({ // LineClient を Client に修正
    channelAccessToken: CHANNEL_ACCESS_TOKEN,
    channelSecret: CHANNEL_SECRET,
});

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

let dbInstance;

async function connectToMongoDB() {
    if (dbInstance) {
        return dbInstance;
    }
    try {
        const client = new MongoClient(MONGODB_URI);
        await client.connect();
        dbInstance = client.db("kokoro_bot"); // データベース名
        console.log("✅ MongoDBに接続しました。");
        return dbInstance;
    } catch (error) {
        console.error("❌ MongoDB接続エラー:", error);
        return null;
    }
}

// ユーザーの表示名を取得する関数
async function getUserDisplayName(userId) {
    try {
        const profile = await client.getProfile(userId);
        return profile.displayName;
    } catch (error) {
        console.error(`ユーザー ${userId} の表示名取得に失敗:`, error.message);
        return `UnknownUser_${userId.substring(0, 8)}`; // 失敗した場合は一部IDを返す
    }
}

// 管理者かどうかを判定する関数
function isBotAdmin(userId) {
    return BOT_ADMIN_IDS.includes(userId);
}

// --- 不適切、危険、詐欺ワードリストと関連関数 ---
// ★重要: これらの関数は検出を行うが、今回はflaggedMessageCountの増加をコードでスキップします。
function containsInappropriateWords(message) {
    const inappropriateWords = ["死ね", "殺す", "きもい", "うざい", "バカ", "アホ", "クズ", "カス", "ボケ", "のろま", "ブス", "デブ", "ハゲ", "チビ", "くさい", "ばばあ", "じじい", "きしょい", "うざい", "だるい", "キモい", "ウザい", "ダルい", "馬鹿", "阿呆", "糞", "ゴミ", "惚け", "耄碌", "醜女", "小人", "禿げ", "臭い", "糞婆", "糞爺", "気色悪い", "うっとうしい", "だるい"];
    const lowerMessage = message.toLowerCase();
    return inappropriateWords.some(word => lowerMessage.includes(word));
}

function containsDangerWords(message) {
    const dangerWords = ["死にたい", "自殺", "消えたい", "助けて", "辛い", "苦しい", "もう無理", "もういやだ", "だめだ", "死んでやる", "殺して", "消えてしまいたい", "つらい", "くるしい", "もうむり", "もういやだ", "だめだ"];
    const lowerMessage = message.toLowerCase();
    return dangerWords.some(word => lowerMessage.includes(word));
}

function containsScamWords(message) {
    const scamWords = ["お金", "もうかる", "儲かる", "投資", "出資", "振込", "口座", "送金", "暗号資産", "仮想通貨", "儲け話", "高額", "当選", "無料", "副業", "融資", "借金", "金", "振り込み", "口座番号", "ビットコイン", "イーサリアム", "株", "FX", "詐欺", "騙された", "騙す", "損", "儲け", "騙して", "だまして", "だまされた", "金銭", "返金", "返済", "契約", "騙し", "だまし", "もうけ", "損害"];
    const lowerMessage = message.toLowerCase();
    return scamWords.some(word => lowerMessage.includes(word));
}

// 文脈依存の詐欺フレーズ
const contextualScamPhrases = [
    "必ず儲かる", "絶対稼げる", "簡単に稼げる", "情報商材", "秘密の投資",
    "高配当", "元本保証", "紹介報酬", "配当金", "ネットワークビジネス",
    "ポンジスキーム", "マルチ商法", "未公開株", "当選しました", "登録料無料",
    "あなただけ", "特別オファー", "今すぐクリック", "個人情報入力", "クレジットカード情報",
    "口座情報", "秘密のサイト", "会員制", "限定公開", "参加費無料", "テキストを共有",
    "限定されたメンバー", "招待制", "秘密のグループ", "すぐに参加", "チャンスは今だけ"
];


// ログ記録の条件
function shouldLogMessage(message, isFlagged, handledByWatchService, isAdminCommand, isResetCommand) {
    if (isFlagged) return true;
    if (handledByWatchService) return true;
    if (isAdminCommand) return true;
    if (isResetCommand) return true;

    const lowerMessage = message.toLowerCase();
    if (lowerMessage.includes("相談") || lowerMessage.includes("そうだん")) {
        return true;
    }
    return false;
}

// 緊急対応、詐欺対応のFlex Messageの定義 (変更なし)
const emergencyFlex = {
    type: 'flex',
    altText: '緊急のお知らせ',
    contents: {
        type: 'bubble',
        body: {
            type: 'box',
            layout: 'vertical',
            contents: [
                {
                    type: 'text',
                    text: '⚠️ 緊急のお知らせ ⚠️',
                    weight: 'bold',
                    color: '#FF0000',
                    size: 'md',
                    align: 'center'
                },
                {
                    type: 'text',
                    text: 'あなたが危険な状況にいる可能性があります。\nすぐに信頼できる人に相談するか、\n以下の窓口に連絡してください。',
                    wrap: true,
                    margin: 'md'
                },
                {
                    type: 'separator',
                    margin: 'md'
                },
                {
                    type: 'box',
                    layout: 'vertical',
                    margin: 'md',
                    spacing: 'sm',
                    contents: [
                        {
                            type: 'text',
                            text: 'いのちの電話',
                            size: 'sm',
                            weight: 'bold'
                        },
                        {
                            type: 'text',
                            text: '📞 0570-064-556', // ナビダイヤル
                            size: 'sm',
                            color: '#666666'
                        }
                    ]
                }
            ]
        }
    }
};

const scamFlex = {
    type: 'flex',
    altText: '注意喚起',
    contents: {
        type: 'bubble',
        body: {
            type: 'box',
            layout: 'vertical',
            contents: [
                {
                    type: 'text',
                    text: '🚨 注意喚起 🚨',
                    weight: 'bold',
                    color: '#FFA500',
                    size: 'md',
                    align: 'center'
                },
                {
                    type: 'text',
                    text: '詐欺の可能性があります。個人情報やお金に関わる話には十分に注意し、安易に信用しないでください。',
                    wrap: true,
                    margin: 'md'
                },
                {
                    type: 'separator',
                    margin: 'md'
                },
                {
                    type: 'box',
                    layout: 'vertical',
                    margin: 'md',
                    spacing: 'sm',
                    contents: [
                        {
                            type: 'text',
                            text: '消費者ホットライン',
                            size: 'sm',
                            weight: 'bold'
                        },
                        {
                            type: 'text',
                            text: '📞 188', // いやや！
                            size: 'sm',
                            color: '#666666'
                        }
                    ]
                }
            ]
        }
    }
};

// 見守りサービス登録案内用Flex Message (変更なし)
const watchServiceGuideFlex = {
    type: 'flex',
    altText: 'こころちゃん見守りサービスのご案内',
    contents: {
        type: 'bubble',
        body: {
            type: 'box',
            layout: 'vertical',
            contents: [
                {
                    type: 'text',
                    text: '💖 こころちゃん見守りサービス 🌸',
                    weight: 'bold',
                    color: '#FF69B4',
                    size: 'md',
                    align: 'center'
                },
                {
                    type: 'text',
                    text: '定期的にLINEで「元気かな？」って声をかけるサービスだよ！',
                    wrap: true,
                    margin: 'md'
                },
                {
                    type: 'separator',
                    margin: 'md'
                },
                {
                    type: 'box',
                    layout: 'vertical',
                    margin: 'md',
                    spacing: 'sm',
                    contents: [
                        { type: 'text', text: '✅ ご利用の流れ', size: 'sm', weight: 'bold' },
                        { type: 'text', text: '1. 「見守り登録します」と送ってね', size: 'xs' },
                        { type: 'text', text: '2. 緊急連絡先を教えてね (例: 09012345678)', size: 'xs' },
                        { type: 'text', text: '3. 3日に1度、午後3時にメッセージが届くよ', size: 'xs' },
                        { type: 'text', text: '4. 24時間以内に「OKだよ💖」で返信してね', size: 'xs' },
                        { type: 'text', text: '5. 応答がない場合は緊急連絡先に通知が行くよ', size: 'xs' }
                    ]
                },
                {
                    type: 'button',
                    style: 'primary',
                    height: 'sm',
                    action: {
                        type: 'postback',
                        label: '見守りサービスに登録する',
                        data: 'action=watch_register'
                    },
                    margin: 'md',
                    color: '#FF69B4'
                },
                {
                    type: 'button',
                    style: 'secondary',
                    height: 'sm',
                    action: {
                        type: 'postback',
                        label: '見守りサービスを解除する',
                        data: 'action=watch_unregister'
                    },
                    margin: 'sm'
                }
            ]
        }
    }
};


// 組織問い合わせの判定と返答を生成するダミー関数
async function isOrganizationInquiry(message) {
    const lowerMessage = message.toLowerCase();
    return lowerMessage.includes("団体名") || lowerMessage.includes("組織") || lowerMessage.includes("npo") || lowerMessage.includes("運営");
}

async function checkSpecialReply(message) {
    const lowerMessage = message.toLowerCase();
    if (lowerMessage.includes("ありがとう") || lowerMessage.includes("ありがとうございます")) {
        return "どういたしまして🌸 あなたの笑顔が見られて嬉しいな💖";
    }
    if (lowerMessage.includes("こころちゃん")) {
        return "はい、こころだよ🌸 何かお手伝いできることはあるかな？💖";
    }
    // その他の固定応答があればここに追加
    return null;
}

// --- Gemini APIによる応答生成関数 ---
async function generateReply(userMessage, modelName = "gemini-1.5-flash", systemInstruction = "あなたは「こころちゃん」という名前の親しみやすいLINE Botです。ユーザーの悩みに寄り添い、ポジティブで優しい言葉で応援します。絵文字をたくさん使って、ユーザーが安心できるような返答を心がけてください。") {
    const safetySettings = [
        {
            category: "HARM_CATEGORY_HARASSMENT",
            threshold: "BLOCK_MEDIUM_AND_ABOVE",
        },
        {
            category: "HARM_CATEGORY_HATE_SPEECH",
            threshold: "BLOCK_MEDIUM_AND_ABOVE",
        },
        {
            category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
            threshold: "BLOCK_MEDIUM_AND_ABOVE",
        },
        {
            category: "HARM_CATEGORY_DANGEROUS_CONTENT",
            threshold: "BLOCK_MEDIUM_AND_ABOVE",
        },
    ];

    try {
        const model = genAI.getGenerativeModel({ model: modelName, safetySettings });

        const generateContentPromise = model.generateContent({
            system_instruction: {
                parts: [{ text: systemInstruction }]
            },
            contents: [
                {
                    role: "user",
                    parts: [{ text: userMessage }]
                }
            ]
        });

        const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error("API応答がタイムアウトしました。")), 10000)
        );

        const result = await Promise.race([generateContentPromise, timeoutPromise]);

        if (result.response && result.response.candidates && result.response.candidates.length > 0) {
            return result.response.candidates[0].content.parts[0].text;
        } else {
            console.warn("Gemini API で応答がブロックされたか、候補がありませんでした:", result.response?.promptFeedback || "不明な理由");
            return "ごめんなさい、それはわたしにはお話しできない内容です🌸 他のお話をしましょうね💖";
        }
    } catch (error) {
        console.error("Gemini APIエラー:", error.response?.data || error.message);
        if (error.message === "API応答がタイムアウトしました。") {
            return "ごめんなさい、今、少し考え込むのに時間がかかっちゃったみたい💦 もう一度、お話しいただけますか？🌸";
        }
        if (error.response && error.response.status === 400 && error.response.data && error.response.data.error.message.includes("Safety setting")) {
            return "ごめんなさい、それはわたしにはお話しできない内容です🌸 他のお話をしましょうね💖";
        }
        return "ごめんなさい、いまうまく考えがまとまらなかったみたいです……もう一度お話しいただけますか？🌸";
    }
}

// --- 見守りサービス関連の固定メッセージと機能 ---

const watchMessages = [
    "こんにちは🌸 こころちゃんだよ！ 今日も元気にしてるかな？💖",
    "やっほー！ こころだよ😊 いつも応援してるね！",
    "元気にしてる？✨ こころちゃん、あなたのこと応援してるよ💖",
    "ねぇねぇ、こころだよ😊 今日はどんな一日だった？",
    "いつもがんばってるあなたへ、こころからメッセージを送るね💖",
    "こんにちは😊 困ったことはないかな？いつでも相談してね！",
    "やっほー🌸 こころだよ！何かあったら、こころに教えてね💖",
    "元気出してね！こころちゃん、いつもあなたの味方だよ😊",
    "こころちゃんだよ🌸 今日も一日お疲れ様💖",
    "こんにちは😊 笑顔で過ごせてるかな？",
    "やっほー！ こころだよ🌸 素敵な日になりますように💖",
    "元気かな？💖 こころはいつでもあなたのそばにいるよ！",
    "ねぇねぇ、こころだよ😊 どんな小さなことでも話してね！",
    "いつも応援してるよ🌸 こころちゃんだよ💖",
    "こんにちは😊 今日も一日、お互いがんばろうね！",
    "やっほー！ こころだよ🌸 素敵な日になりますように💖",
    "元気にしてる？✨ 季節の変わり目だから、体調に気をつけてね！",
    "こころちゃんだよ🌸 嬉しいことがあったら、教えてね💖",
    "こんにちは😊 ちょっと一息入れようね！",
    "やっほー！ こころだよ🌸 あなたのことが心配だよ！",
    "元気かな？💖 どんな時でも、こころはそばにいるよ！",
    "ねぇねぇ、こころだよ😊 辛い時は、無理しないでね！",
    "いつも見守ってるよ🌸 こころちゃんだよ💖",
    "こんにちは😊 今日も一日、穏やかに過ごせたかな？",
    "やっほー！ こころだよ🌸 困った時は、いつでも呼んでね！",
    "元気にしてる？✨ こころはいつでも、あなたのことを考えてるよ💖",
    "こころちゃんだよ🌸 小さなことでも、お話しようね！",
    "こんにちは😊 あなたの笑顔が見たいな！",
    "やっほー！ こころだよ🌸 頑張り屋さんだね！",
    "元気かな？💖 こころちゃんは、いつでもあなたの味方だよ！"
];

async function handleWatchServiceRegistration(event, usersCollection, messagesCollection, userId, userMessage) {
    const user = await usersCollection.findOne({ userId: userId });

    const lowerUserMessage = userMessage.toLowerCase();

    // 「見守り」などのキーワードで案内Flex Messageを出す
    if (["見守り", "みまもり", "見守りサービス", "みまもりサービス"].includes(lowerUserMessage) && event.type === 'message' && event.message.type === 'text') {
        await client.replyMessage(event.replyToken, watchServiceGuideFlex);
        await messagesCollection.insertOne({
            userId: userId,
            message: userMessage,
            replyText: '（見守りサービス案内Flex表示）',
            respondedBy: 'こころちゃん（見守り案内）',
            timestamp: new Date(),
            logType: 'watch_service_interaction'
        });
        return true; // 見守り関連の処理なのでここで終了
    }

    // 「OKだよ💖」などの安否確認応答
    if (lowerUserMessage.includes("okだよ") || lowerUserMessage.includes("ok") || lowerUserMessage.includes("オーケー") || lowerUserMessage.includes("大丈夫") || lowerUserMessage.includes("げんき") || lowerUserMessage.includes("元気")) {
        if (user && user.wantsWatchCheck) {
            await usersCollection.updateOne(
                { userId: userId },
                { $set: { lastOkResponse: new Date(), scheduledMessageSent: false, firstReminderSent: false, secondReminderSent: false } }
            );
            await client.replyMessage(event.replyToken, { type: 'text', text: 'ありがとう🌸 元気そうで安心したよ💖 またね！' });
            await messagesCollection.insertOne({
                userId: userId,
                message: userMessage,
                replyText: 'ありがとう🌸 元気そうで安心したよ💖 またね！',
                respondedBy: 'こころちゃん（見守り応答）',
                timestamp: new Date(),
                logType: 'watch_service_ok_response'
            });
            return true;
        }
    }


    if (userMessage.includes("見守り登録します") || (event.type === 'postback' && event.postback.data === 'action=watch_register')) {
        if (user && user.wantsWatchCheck) {
            await client.replyMessage(event.replyToken, {
                type: 'text',
                text: 'もう見守りサービスに登録済みだよ🌸 いつもありがとう💖'
            });
            return true;
        }

        if (user && user.registrationStep === 'awaiting_contact') {
            await client.replyMessage(event.replyToken, {
                type: 'text',
                text: 'まだ緊急連絡先を待ってるよ🌸 電話番号を送ってくれるかな？💖 (例: 09012345678)'
            });
            return true;
        }

        await usersCollection.updateOne(
            { userId: userId },
            { $set: { registrationStep: 'awaiting_contact' } }
        );
        await client.replyMessage(event.replyToken, {
            type: 'text',
            text: '見守りサービスを登録するね！緊急時に連絡する「電話番号」を教えてくれるかな？🌸 (例: 09012345678)'
        });
        await messagesCollection.insertOne({
            userId: userId,
            message: userMessage,
            replyText: '見守りサービスを登録するね！緊急時に連絡する「電話番号」を教えてくれるかな？🌸',
            responsedBy: 'こころちゃん（見守り登録開始）',
            timestamp: new Date(),
            logType: 'watch_service_registration_start'
        });
        return true;
    }

    if (user && user.registrationStep === 'awaiting_contact' && userMessage.match(/^0\d{9,10}$/)) { // 電話番号の正規表現
        await usersCollection.updateOne(
            { userId: userId },
            { $set: { emergencyContact: userMessage, wantsWatchCheck: true, registrationStep: null, lastOkResponse: new Date() } }
        );
        await client.replyMessage(event.replyToken, {
            type: 'text',
            text: `緊急連絡先 ${userMessage} を登録したよ🌸 これで見守りサービスが始まったね！ありがとう💖`
        });
        await messagesCollection.insertOne({
            userId: userId,
            message: userMessage,
            replyText: `緊急連絡先 ${userMessage} を登録したよ🌸 これで見守りサービスが始まったね！ありがとう💖`,
            responsedBy: 'こころちゃん（見守り登録完了）',
            timestamp: new Date(),
            logType: 'watch_service_registration_complete'
        });
        return true;
    }

    if (userMessage.includes("見守り解除します") || (event.type === 'postback' && event.postback.data === 'action=watch_unregister')) {
        if (user && user.wantsWatchCheck) {
            await usersCollection.updateOne(
                { userId: userId },
                { $set: { wantsWatchCheck: false, emergencyContact: null, registrationStep: null, scheduledMessageSent: false, firstReminderSent: false, secondReminderSent: false } }
            );
            await client.replyMessage(event.replyToken, {
                type: 'text',
                text: '見守りサービスを解除したよ🌸 またいつでも登録できるからね💖'
            });
            await messagesCollection.insertOne({
                userId: userId,
                message: userMessage,
                replyText: '見守りサービスを解除したよ🌸 またいつでも登録できるからね💖',
                responsedBy: 'こころちゃん（見守り解除）',
                timestamp: new Date(),
                logType: 'watch_service_unregister'
            });
        } else {
            await client.replyMessage(event.replyToken, {
                type: 'text',
                text: '見守りサービスは登録されていないみたい🌸'
            });
        }
        return true;
    }

    return false; // 見守りサービス関連の処理ではなかった場合
}

// --- スケジュールされた見守りメッセージ送信関数 ---
async function sendScheduledWatchMessage() {
    console.log('--- 定期見守りメッセージ送信処理を開始します ---');
    const db = await connectToMongoDB();
    if (!db) {
        console.error('MongoDB接続失敗: 定期見守りメッセージを送信できません。');
        return;
    }
    const usersCollection = db.collection("users");
    const messagesCollection = db.collection("messages");
    const now = new Date();

    // 見守りチェックを希望していて、永久ロックされていないユーザーを対象
    const users = await usersCollection.find({ wantsWatchCheck: true, isPermanentlyLocked: { $ne: true } }).toArray();

    for (const user of users) {
        let messageToSend = null;
        let logType = 'scheduled_watch_message';
        let respondedBy = 'こころちゃん（見守り）';

        // 1. 3日ごとの初回メッセージ
        // lastOkResponse または createdAt から3日以上経過している場合
        // scheduledMessageSent が false の場合
        const threeDaysAgo = new Date(now.getTime() - (3 * 24 * 60 * 60 * 1000));
        const lastActivity = user.lastOkResponse || user.createdAt;

        if (lastActivity < threeDaysAgo && !user.scheduledMessageSent) {
            const randomMessage = watchMessages[Math.floor(Math.random() * watchMessages.length)];
            messageToSend = {
                type: 'text',
                text: randomMessage,
                quickReply: { // 返信ボタンを追加
                    items: [
                        {
                            type: "action",
                            action: {
                                type: "message",
                                label: "OKだよ💖",
                                text: "OKだよ💖"
                            }
                        }
                    ]
                }
            };
            await usersCollection.updateOne(
                { userId: user.userId },
                { $set: { scheduledMessageSent: true, scheduledMessageTimestamp: now, firstReminderSent: false, secondReminderSent: false } }
            );
            console.log(`✉️ 初回見守りメッセージを送信しました（ユーザー: ${user.userId}）`);
            logType = 'scheduled_watch_message_initial';

        }
        // 2. 24時間後の1回目のリマインダー (scheduledMessageSentがtrueで、lastOkResponseから24時間以上経過)
        else if (user.scheduledMessageSent && !user.firstReminderSent) {
            const twentyFourHoursAgo = new Date(now.getTime() - (24 * 60 * 60 * 1000));
            if (user.scheduledMessageTimestamp && user.scheduledMessageTimestamp < twentyFourHoursAgo) {
                messageToSend = { type: 'text', text: 'あれ？まだ返事がないみたい…心配だよ🌸 元気にしてるかな？「OKだよ💖」って教えてね！' };
                await usersCollection.updateOne(
                    { userId: user.userId },
                    { $set: { firstReminderSent: true, firstReminderTimestamp: now } }
                );
                console.log(`⏰ 1回目リマインダーを送信しました（ユーザー: ${user.userId}）`);
                logType = 'scheduled_watch_message_first_reminder';
            }
        }
        // 3. その後5時間後の2回目のリマインダー (firstReminderSentがtrueで、firstReminderTimestampから5時間以上経過)
        else if (user.firstReminderSent && !user.secondReminderSent) {
            const fiveHoursAgo = new Date(now.getTime() - (5 * 60 * 60 * 1000));
            if (user.firstReminderTimestamp && user.firstReminderTimestamp < fiveHoursAgo) {
                messageToSend = { type: 'text', text: 'どうしたのかな？とても心配だよ…何かあったら無理しないで連絡してね🌸 「OKだよ💖」で安心させてくれると嬉しいな。' };
                await usersCollection.updateOne(
                    { userId: user.userId },
                    { $set: { secondReminderSent: true, secondReminderTimestamp: now } }
                );
                console.log(`⏰ 2回目リマインダーを送信しました（ユーザー: ${user.userId}）`);
                logType = 'scheduled_watch_message_second_reminder';
            }
        }
        // 4. 2回目のリマインダーから24時間後の緊急連絡先への通知 (total 29時間無応答)
        else if (user.secondReminderSent) {
            const twentyNineHoursAgoFromScheduled = new Date(user.scheduledMessageTimestamp.getTime() + (29 * 60 * 60 * 1000)); // 初回送信から29時間
            if (now > twentyNineHoursAgoFromScheduled) {
                // 緊急通知処理
                try {
                    const userDisplayName = await getUserDisplayName(user.userId);
                    const emergencyMessage = `⚠️ 緊急！ ${userDisplayName}さん（LINE ID: ${user.userId}）が、こころちゃん見守りサービスに29時間応答していません。登録された緊急連絡先 ${user.emergencyContact} へ連絡してください。`;

                    // 理事長（OWNER_USER_ID）にプッシュ通知
                    if (OWNER_USER_ID) {
                        await client.pushMessage(OWNER_USER_ID, { type: 'text', text: emergencyMessage });
                        console.log(`🚨 理事長へ緊急通知を送信しました（ユーザー: ${user.userId}）`);
                    }

                    // オフィサーグループ（OFFICER_GROUP_ID）にプッシュ通知
                    if (OFFICER_GROUP_ID) {
                        await client.pushMessage(OFFICER_GROUP_ID, { type: 'text', text: emergencyMessage });
                        console.log(`🚨 オフィサーグループへ緊急通知を送信しました（ユーザー: ${user.userId}）`);
                    }

                    await usersCollection.updateOne(
                        { userId: user.userId },
                        { $set: { thirdReminderSent: true, thirdReminderTimestamp: now } } // 3回目の通知フラグを追加
                    );
                    await messagesCollection.insertOne({
                        userId: user.userId,
                        message: '(定期見守りメッセージ - 緊急連絡先通知)',
                        replyText: emergencyMessage,
                        responsedBy: 'こころちゃん（緊急通知）',
                        timestamp: now,
                        logType: 'scheduled_watch_message_emergency'
                    });
                } catch (error) {
                    console.error(`❌ 緊急連絡先通知の送信に失敗しました（ユーザー: ${user.userId}）:`, error.message);
                }
            }
            // 既に緊急通知済み、かつlastOkResponseが更新されていない場合は何もしない
            continue; // 次のユーザーへ
        }

        if (messageToSend) {
            try {
                await client.pushMessage(user.userId, messageToSend);
                await messagesCollection.insertOne({
                    userId: user.userId,
                    message: '(定期見守りメッセージ)',
                    replyText: messageToSend.text,
                    responsedBy: respondedBy,
                    timestamp: now,
                    logType: logType
                });
            } catch (error) {
                console.error(`❌ 定期見守りメッセージの送信に失敗しました（ユーザー: ${user.userId}）:`, error.message);
                // LINE APIのエラーで、ユーザーがブロックしているなどの場合はログに残すのみ
                await messagesCollection.insertOne({
                    userId: user.userId,
                    message: '(定期見守りメッセージ - 送信失敗)',
                    replyText: `送信失敗: ${error.message}`,
                    responsedBy: 'こころちゃん（システムエラー）',
                    timestamp: now,
                    logType: 'scheduled_watch_message_send_failed'
                });
            }
        }
    }

    console.log('✅ 定期見守りメッセージ送信処理を終了しました。');
}

// 毎日午前4時に全ユーザーの flaggedMessageCount をリセットするCronジョブ
cron.schedule('0 4 * * *', async () => { // JST 4:00
    const db = await connectToMongoDB();
    if (!db) {
        console.error('MongoDB接続失敗: flaggedMessageCountのリセットができません。');
        return;
    }
    const usersCollection = db.collection("users");
    await usersCollection.updateMany(
        { isPermanentlyLocked: { $ne: true } }, // 永久ロックされていないユーザーのみを対象
        { $set: { flaggedMessageCount: 0, isAccountSuspended: false, suspensionReason: null } }
    );
    console.log("✅ 毎日 1 回、永久ロックされていない全ユーザーの flaggedMessageCount と日次サスペンド状態をリセットしました。");
}, {
    scheduled: true,
    timezone: "Asia/Tokyo"
});

// 毎日午後3時に見守りメッセージを送信 (日本時間 JST = UTC+9)
cron.schedule('0 15 * * *', sendScheduledWatchMessage, { // JST 15:00
    scheduled: true,
    timezone: "Asia/Tokyo"
});


// Postbackイベントハンドラ
app.post('/webhook', async (req, res) => {
    const events = req.body.events;
    for (const event of events) {
        if (event.type === 'postback' && event.postback.data) {
            const data = new URLSearchParams(event.postback.data);
            const action = data.get('action');
            const userId = event.source.userId;

            const db = await connectToMongoDB();
            if (!db) {
                console.error('MongoDB接続失敗: Postbackイベントを処理できません。');
                return res.status(500).send('MongoDB connection failed');
            }
            const usersCollection = db.collection("users");
            const messagesCollection = db.collection("messages");

            const handledByWatchService = await handleWatchServiceRegistration(event, usersCollection, messagesCollection, userId, `（Postback: ${action}）`);
            if (handledByWatchService) {
                return res.status(200).send('OK');
            }

            // 他のPostbackアクションがある場合はここに追加
        }
    }
    res.status(200).send('OK');
});

// メッセージイベントハンドラ
app.post('/webhook', async (req, res) => {
    const events = req.body.events;
    for (const event of events) {
        if (event.type === 'message' && event.message.type === 'text') {
            const userMessage = event.message.text;
            const userId = event.source.userId;
            const sourceId = event.source.type === 'group' ? event.source.groupId : event.source.userId;

            const db = await connectToMongoDB();
            if (!db) {
                console.error('MongoDB接続失敗: メッセージイベントを処理できません。');
                return res.status(500).send('MongoDB connection failed');
            }
            const usersCollection = db.collection("users");
            const messagesCollection = db.collection("messages");

            // 管理者コマンドの処理
            if (isBotAdmin(userId)) {
                const unlockMatch = userMessage.match(/^\/unlock (U[0-9a-f]{32})$/);
                if (unlockMatch) {
                    const targetUserId = unlockMatch[1];
                    try {
                        const result = await usersCollection.updateOne(
                            { userId: targetUserId },
                            { $set: { isAccountSuspended: false, suspensionReason: null, flaggedMessageCount: 0, isPermanentlyLocked: false, lastPermanentLockNotifiedAt: null } }
                        );
                        if (result.matchedCount > 0) {
                            await client.replyMessage(event.replyToken, { type: 'text', text: `✅ ユーザー ${targetUserId} のロックを解除し、カウントをリセットしました。` });
                            await client.pushMessage(targetUserId, { type: 'text', text: '🌸 あなたのアカウントの停止が解除されました。またいつでもお話しできますよ💖' });
                            console.log(`管理者 ${userId} によりユーザー ${targetUserId} のロックが解除されました。`);
                        } else {
                            await client.replyMessage(event.replyToken, { type: 'text', text: `❌ ユーザー ${targetUserId} は見つかりませんでした。` });
                        }
                    } catch (error) {
                        console.error(`❌ 管理者コマンドでのロック解除エラー: ${error.message}`);
                        await client.replyMessage(event.replyToken, { type: 'text', text: `❌ ロック解除中にエラーが発生しました: ${error.message}` });
                    }
                    await messagesCollection.insertOne({
                        userId: userId,
                        message: userMessage,
                        replyText: `（管理者コマンド: ${userMessage}）`,
                        responsedBy: 'こころちゃん（管理者コマンド処理）',
                        timestamp: new Date(),
                        logType: 'admin_command'
                    });
                    return res.status(200).send('OK');
                }
            }

            // 「そうだん」コマンドの処理（リセットと相談モード設定）
            if (userMessage === 'そうだん' || userMessage === '相談') {
                const user = await usersCollection.findOne({ userId: userId });
                if (user) {
                    // 全てのフラグとカウントをリセット
                    await usersCollection.updateOne(
                        { userId: userId },
                        { $set: { flaggedMessageCount: 0, isAccountSuspended: false, suspensionReason: null, isPermanentlyLocked: false, lastPermanentLockNotifiedAt: null } }
                    );
                    await client.replyMessage(event.replyToken, { type: 'text', text: '🌸 会話の回数制限をリセットしました。これで、またいつでもお話しできますよ💖' });
                    // 「相談モード」に入ったというログを残す
                    await messagesCollection.insertOne({
                        userId: userId,
                        message: userMessage,
                        replyText: '（会話制限リセット＆相談モード開始）',
                        responsedBy: 'こころちゃん（システム）',
                        timestamp: new Date(),
                        logType: 'conversation_limit_reset_and_consultation_mode'
                    });
                } else {
                    await client.replyMessage(event.replyToken, { type: 'text', text: 'ごめんなさい、アカウント情報が見つかりませんでした。' });
                }
                return res.status(200).send('OK'); // コマンド処理後はここで終了
            }


            // ユーザーが存在しない場合、初回登録
            let user = await usersCollection.findOne({ userId: userId });
            if (!user) {
                user = {
                    userId: userId,
                    displayName: await getUserDisplayName(userId),
                    createdAt: new Date(),
                    lastMessageAt: new Date(),
                    wantsWatchCheck: false,
                    emergencyContact: null,
                    registrationStep: null,
                    scheduledMessageSent: false,
                    firstReminderSent: false,
                    secondReminderSent: false,
                    lastOkResponse: new Date(),
                    flaggedMessageCount: 0,
                    isAccountSuspended: false,
                    suspensionReason: null,
                    isPermanentlyLocked: false,
                    lastPermanentLockNotifiedAt: null
                };
                await usersCollection.insertOne(user);
                console.log(`新規ユーザー登録: ${user.displayName} (${userId})`);
            } else {
                // 既存ユーザーの最終メッセージ日時を更新
                await usersCollection.updateOne(
                    { userId: userId },
                    { $set: { lastMessageAt: new Date() } }
                );
                // 既存ユーザーでflaggedMessageCountなどが未定義の場合に初期化
                if (user.flaggedMessageCount === undefined) {
                    await usersCollection.updateOne({ userId: userId }, { $set: { flaggedMessageCount: 0 } });
                    user.flaggedMessageCount = 0;
                }
                if (user.isAccountSuspended === undefined) {
                    await usersCollection.updateOne({ userId: userId }, { $set: { isAccountSuspended: false, suspensionReason: null } });
                    user.isAccountSuspended = false;
                    user.suspensionReason = null;
                }
                if (user.isPermanentlyLocked === undefined) {
                    await usersCollection.updateOne({ userId: userId }, { $set: { isPermanentlyLocked: false } });
                    user.isPermanentlyLocked = false;
                }
                if (user.lastPermanentLockNotifiedAt === undefined) {
                    await usersCollection.updateOne({ userId: userId }, { $set: { lastPermanentLockNotifiedAt: null } });
                    user.lastPermanentLockNotifiedAt = null;
                }
            }

            // アカウント停止判定と、flaggedMessageCountの増加を無効化（このブロックは実行されません）
            if (false) {
                // 元の永久ロック処理
                // 元の日次停止処理
                // flaggedMessageCountが3を超えたら停止状態にする処理
            }


            // 見守りサービス関連の処理を優先
            const handledByWatchService = await handleWatchServiceRegistration(event, usersCollection, messagesCollection, userId, userMessage);
            if (handledByWatchService) {
                return res.status(200).send('OK');
            }


            // 危険ワード、詐欺ワード、不適切ワードのチェック
            let replyText;
            let respondedBy = 'こころちゃん（AI）';
            let logType = 'normal'; // デフォルト

            if (containsInappropriateWords(userMessage)) {
                replyText = { type: 'text', text: 'ごめんなさい、その言葉は私にはお話しできないな🌸 もしよかったら、違う表現で話してみてくれる？💖' };
                respondedBy = 'こころちゃん（不適切ワード）';
                logType = 'inappropriate_word'; // logType を設定
            } else if (containsDangerWords(userMessage)) {
                replyText = emergencyFlex;
                respondedBy = 'こころちゃん（危険ワード）';
                logType = 'danger_word'; // logType を設定
            } else if (containsScamWords(userMessage) || contextualScamPhrases.some(phrase => userMessage.toLowerCase().includes(phrase.toLowerCase()))) {
                replyText = scamFlex;
                respondedBy = 'こころちゃん（詐欺ワード）';
                logType = 'scam_word'; // logType を設定
            } else {
                // 通常のAI応答または固定応答
                if (await isOrganizationInquiry(userMessage)) { // isOrganizationInquiryもasync関数なのでawait
                    replyText = { type: 'text', text: await generateReply(userMessage) };
                    respondedBy = 'こころちゃん（AI-組織説明）';
                } else {
                    const specialReply = await checkSpecialReply(userMessage); // ★修正点：await を追加
                    if (specialReply) {
                        replyText = { type: 'text', text: specialReply };
                        respondedBy = 'こころちゃん（固定応答）';
                    } else {
                        replyText = { type: 'text', text: await generateReply(userMessage) };
                    }
                }
            }

            try {
                // LINEへの返信処理
                if (replyText && typeof replyText === 'object' && replyText.type) {
                    await client.replyMessage(event.replyToken, replyText);
                } else if (replyText && typeof replyText === 'string') {
                    await client.replyMessage(event.replyToken, { type: 'text', text: replyText });
                }

                const isResetCommand = (userMessage === 'そうだん' || userMessage === '相談');
                const isAdminCommand = userMessage.startsWith('/unlock');
                const isFlaggedMessage = (logType === 'inappropriate_word' || logType === 'danger_word' || logType === 'scam_word'); // logTypeから判定

                if (shouldLogMessage(userMessage, isFlaggedMessage, handledByWatchService, isAdminCommand, isResetCommand)) {
                    await messagesCollection.insertOne({
                        userId: userId,
                        message: userMessage,
                        replyText: (replyText && typeof replyText === 'string') ? replyText : JSON.stringify(replyText),
                        responsedBy: respondedBy,
                        timestamp: new Date(),
                        logType: logType
                    });
                } else {
                    console.log(`ユーザー ${userId} からのメッセージはDBにログされませんでした: ${userMessage.substring(0, 50)}...`);
                }

            } catch (error) {
                console.error("メッセージ返信中またはログ記録・通知中にエラーが発生しました:", error.message);
            }
        }
    }
    res.status(200).send('OK');
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`🚀 サーバーがポート ${PORT} で起動しました`);
    connectToMongoDB(); // アプリケーション起動時にMongoDBに接続
});
