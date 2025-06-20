require('dotenv').config(); // .env ファイルから環境変数を読み込む

const express = require('express');
const { LineClient } = require('@line/bot-sdk');
const { MongoClient } = require('mongodb');
const cron = require('node-cron');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// config.json から設定を読み込む行は削除またはコメントアウト
// const config = require('./config.json');

// 環境変数から設定を読み込む
const CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN; // まつさんの環境変数名に合わせる
const CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;       // まつさんの環境変数名に合わせる
const MONGODB_URI = process.env.MONGODB_URI;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const OWNER_USER_ID = process.env.OWNER_USER_ID;
const OFFICER_GROUP_ID = process.env.OFFICER_GROUP_ID;
// BOT_ADMIN_IDS はJSON文字列として設定されるため、JSON.parse() でパースする
const BOT_ADMIN_IDS = process.env.BOT_ADMIN_IDS ? JSON.parse(process.env.BOT_ADMIN_IDS) : []; // 管理者IDのリスト

const app = express();
app.use(express.json());

const client = new LineClient({
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
const inappropriateWords = ["死ね", "殺す", "アホ", "バカ", "きもい", "うざい", "クソ", "カス", "ぶっ殺す", "くたばれ", "ふざけるな", "消えろ", "やめろ", "馬鹿", "死んで", "バカだ", "アホだ", "きしょい", "マジキモい", "ゴミ", "役立たず"];
const dangerWords = ["自殺", "死にたい", "助けて", "危ない", "辛い", "苦しい", "もう無理", "消えたい", "リスカ", "OD", "リストカット", "オーバードーズ", "死ぬ", "殺して", "病院行きたい", "カウンセリング", "助けてほしい"];
const scamWords = ["儲かる", "クリック", "当選", "無料", "投資", "情報商材", "副業", "儲け話", "高収入", "簡単", "LINE登録", "公式LINE", "仮想通貨", "FX", "バイナリー", "レバレッジ", "自動売買", "現金プレゼント", "モニター募集", "秘密の情報", "限定公開", "秘密のグループ", "成功", "稼ぐ", "絶対", "安心", "安全", "確実", "裏技"];

// 文脈依存の詐欺フレーズ
const contextualScamPhrases = [
    "クリックして個人情報を入力", "こちらから登録", "詳細はこちら", "公式LINE追加",
    "LINEに誘導", "金銭を要求", "振り込み", "口座情報", "カード情報",
    "投資しませんか", "絶対儲かる", "ワンクリック詐欺", "副業紹介",
    "このLINEに返信", "電話番号教えて", "口座番号教えて", "お金振り込んで",
    "〇〇万円稼げる", "今すぐ登録", "限定オファー", "登録で特典", "特別報酬", "秘密の稼ぎ方"
];

// ★テスト用: 不適切ワードチェックを一時的に無効化
function containsInappropriateWords(message) {
    return false; // テスト中は常にfalseを返す
    // return inappropriateWords.some(word => message.toLowerCase().includes(word));
}

// ★テスト用: 危険ワードチェックを一時的に無効化
function containsDangerWords(message) {
    return false; // テスト中は常にfalseを返す
    // return dangerWords.some(word => message.toLowerCase().includes(word));
}

// ★テスト用: 詐欺ワードチェックを一時的に無効化
function containsScamWords(message) {
    return false; // テスト中は常にfalseを返す
    // return scamWords.some(word => message.toLowerCase().includes(word));
}

// ★修正ポイント５：ログ記録の条件を厳しくする shouldLogMessage 関数の修正
function shouldLogMessage(message, isFlagged, handledByWatchService, isAdminCommand, isResetCommand) {
    // フラグ付きメッセージ (不適切、危険、詐欺ワード検出時) は常にログ
    if (isFlagged) return true;

    // 見守りサービス関連のやり取りは常にログ
    if (handledByWatchService) return true;

    // 管理者コマンドは常にログ
    if (isAdminCommand) return true;

    // 回数制限リセットコマンド（「そうだん」「相談」）は常にログ
    if (isResetCommand) return true;

    // 明示的にログしたい見守りサービス関連のキーワード（OK応答、元気確認、登録/解除など）
    const lowerMessage = message.toLowerCase();
    if (lowerMessage.includes("okだよ") || lowerMessage.includes("ok") || lowerMessage.includes("オーケー") ||
        lowerMessage.includes("元気") || lowerMessage.includes("げんき") || lowerMessage.includes("大丈夫") ||
        lowerMessage.includes("見守り") || lowerMessage.includes("みまもり") ||
        lowerMessage.includes("見守り登録します") || lowerMessage.includes("見守り解除します")) {
        return true;
    }

    // 上記以外の通常の会話はログしない
    return false;
}


// 緊急対応、詐欺対応のFlex Messageの定義 (ダミー)
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

// 見守りサービス登録案内用Flex Message
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
            respondedBy: 'こころちゃん（見守り登録開始）',
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
                respondedBy: 'こころちゃん（見守り解除）',
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
                        respondedBy: 'こころちゃん（緊急通知）',
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
                    respondedBy: respondedBy,
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
    // ★修正: isPermanentlyLocked が true のユーザーはリセット対象外
    await usersCollection.updateMany(
        { isPermanentlyLocked: { $ne: true } }, // 永久ロックされていないユーザーのみを対象
        { $set: { flaggedMessageCount: 0, isAccountSuspended: false, suspensionReason: null } }
    );
    console.log("✅ 毎日 1 回、永久ロックされていない全ユーザーの flaggedMessageCount と日次サスペンド状態をリセットしました。");
}, {
    scheduled: true,
    timezone: "Asia/Tokyo"
});

// 毎日午後3時に実行 (日本時間 JST = UTC+9)
// CronのスケジュールはUTCで解釈されるため、JSTで午後3時 (15時) に相当します。
// ただし、このcron.scheduleの記述ではtimezoneオプションが適用されるため、JST 15:00に実行されます。
// ★見守りメッセージの送信間隔は、sendScheduledWatchMessage関数内のロジックで制御されます。
// cron自体は毎日1回実行し、その中で3日ごとの送信、24時間後リマインダー、5時間後リマインダー、緊急通知の判定を行います。
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

            // ★修正: アカウントが恒久的にロックされている場合のPostback処理もブロック
            const user = await usersCollection.findOne({ userId: userId });
            if (user && user.isPermanentlyLocked) {
                // 永久ロックユーザーには、Postbackに対する返信も行わない
                await messagesCollection.insertOne({
                    userId: userId,
                    message: `（Postbackイベント - ${action}）`,
                    replyText: '（アカウント永久停止中のため返信ブロック）',
                    responsedBy: 'こころちゃん（システム - 永久停止）',
                    timestamp: new Date(),
                    logType: 'account_permanently_locked_postback_ignored'
                });
                return res.status(200).send('OK'); // ここでWebhook処理を終了
            }

            // ★修正: 日次停止ユーザーのPostback処理（見守りサービス関連は許可）
            if (user && user.isAccountSuspended && action !== 'watch_register' && action !== 'watch_unregister') {
                await client.replyMessage(event.replyToken, { type: 'text', text: 'ごめんなさい、今日はこれ以上お話しできません🌸 明日になったらまた話しかけてね💖' });
                return res.status(200).send('OK');
            }

            // ★修正：PostbackイベントもhandleWatchServiceRegistrationで処理する
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
            const sourceId = event.source.type === 'group' ? event.source.groupId : event.source.userId; // グループIDも取得可能だが、現在は使用されていない

            const db = await connectToMongoDB();
            if (!db) {
                console.error('MongoDB接続失敗: メッセージイベントを処理できません。');
                return res.status(500).send('MongoDB connection failed');
            }
            const usersCollection = db.collection("users");
            const messagesCollection = db.collection("messages");

            // ★追加: 管理者コマンドの処理
            if (isBotAdmin(userId)) {
                const unlockMatch = userMessage.match(/^\/unlock (U[0-9a-f]{32})$/); // 例: /unlock Uxxxxxxxxxxxxxxxxx
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
                    await messagesCollection.insertOne({ // 管理者コマンドのログ
                        userId: userId,
                        message: userMessage,
                        replyText: `（管理者コマンド: ${userMessage}）`,
                        responsedBy: 'こころちゃん（管理者コマンド処理）',
                        timestamp: new Date(),
                        logType: 'admin_command'
                    });
                    return res.status(200).send('OK'); // コマンド処理後はここで終了
                }
            }

            // ★追加修正ポイント：会話回数制限の解除ワードの追加
            if (userMessage === 'そうだん' || userMessage === '相談') {
                const user = await usersCollection.findOne({ userId: userId });
                if (user) {
                    await usersCollection.updateOne(
                        { userId: userId },
                        { $set: { flaggedMessageCount: 0, isAccountSuspended: false, suspensionReason: null, isPermanentlyLocked: false, lastPermanentLockNotifiedAt: null } }
                    );
                    await client.replyMessage(event.replyToken, { type: 'text', text: '🌸 会話の回数制限をリセットしました。またお話ししましょうね💖' });
                    await messagesCollection.insertOne({
                        userId: userId,
                        message: userMessage,
                        replyText: '（会話制限リセットコマンド）',
                        responsedBy: 'こころちゃん（システム）',
                        timestamp: new Date(),
                        logType: 'conversation_limit_reset'
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
                    isPermanentlyLocked: false, // ★追加: 永久ロックフラグ
                    lastPermanentLockNotifiedAt: null // ★追加: 永久ロック通知日時
                };
                await usersCollection.insertOne(user);
                console.log(`新規ユーザー登録: <span class="math-inline">\{user\.displayName\} \(</span>{userId})`);
            } else {
                // 既存ユーザーの最終メッセージ日時を更新
                await usersCollection.updateOne(
                    { userId: userId },
                    { $set: { lastMessageAt: new Date() } }
                );
                // 既存ユーザーでflaggedMessageCountやisAccountSuspended, isPermanentlyLockedが未定義の場合に初期化 (初回デプロイ時の対応)
                if (user.flaggedMessageCount === undefined) {
                    await usersCollection.updateOne({ userId: userId }, { $set: { flaggedMessageCount: 0 } });
                    user.flaggedMessageCount = 0;
                }
                if (user.isAccountSuspended === undefined) {
                    await usersCollection.updateOne({ userId: userId }, { $set: { isAccountSuspended: false, suspensionReason: null } });
                    user.isAccountSuspended = false;
                    user.suspensionReason = null;
                }
                // ★追加: isPermanentlyLocked の初期化
                if (user.isPermanentlyLocked === undefined) {
                    await usersCollection.updateOne({ userId: userId }, { $set: { isPermanentlyLocked: false } });
                    user.isPermanentlyLocked = false;
                }
                // ★追加: lastPermanentLockNotifiedAt の初期化
                if (user.lastPermanentLockNotifiedAt === undefined) {
                    await usersCollection.updateOne({ userId: userId }, { $set: { lastPermanentLockNotifiedAt: null } });
                    user.lastPermanentLockNotifiedAt = null;
                }
            }

            // ★修正: アカウントが恒久的にロックされている場合の処理を最優先
            if (user.isPermanentlyLocked) {
                const now = new Date();
                const oneDayAgo = new Date(now.getTime() - (24 * 60 * 60 * 1000)); // 24時間前

                // 最終通知から24時間以上経過しているか、まだ通知していない場合のみ返信する
                if (!user.lastPermanentLockNotifiedAt || user.lastPermanentLockNotifiedAt < oneDayAgo) {
                    const userDisplayName = await getUserDisplayName(userId);
                    const emailAddress = "support@connect-npo.org"; // 問い合わせ先のメールアドレス

                    const permanentLockMessage = `
