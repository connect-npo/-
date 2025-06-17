require('dotenv').config();
const express = require('express');
const { Client } = require('@line/bot-sdk'); // LINE Bot SDKの修正
const { MongoClient } = require('mongodb');
const cron = require('node-cron'); // スケジューリング用
const { GoogleGenerativeAI } = require('@google/generative-ai'); // Gemini API

const app = express();
app.use(express.json());

// LINE Botの設定
const config = {
    channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN || process.env.YOUR_CHANNEL_ACCESS_TOKEN, // 既存の環境変数名も考慮
    channelSecret: process.env.LINE_CHANNEL_SECRET || process.env.YOUR_CHANNEL_SECRET, // 既存の環境変数名も考慮
};
const client = new Client(config);

// MongoDBの設定
const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB_NAME || 'kokoro_bot_db'; // 環境変数がない場合はデフォルト値を使用

let dbClient; // MongoDBクライアントを保持する変数
let usersCollection; // usersコレクションを保持する変数
let messagesCollection; // messagesコレクションを保持する変数

// Gemini API設定
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || process.env.YOUR_GEMINI_API_KEY); // 既存の環境変数名も考慮

// safetySettings（安全性設定）
const safetySettings = [
    {
        category: 'HARM_CATEGORY_HARASSMENT',
        threshold: 'BLOCK_MEDIUM_AND_ABOVE',
    },
    {
        category: 'HARM_CATEGORY_HATE_SPEECH',
        threshold: 'BLOCK_MEDIUM_AND_ABOVE',
    },
    {
        category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT',
        threshold: 'BLOCK_MEDIUM_AND_ABOVE',
    },
    {
        category: 'HARM_CATEGORY_DANGEROUS_CONTENT',
        threshold: 'BLOCK_MEDIUM_AND_ABOVE',
    },
];

// MongoDB接続関数
async function connectToMongoDB() {
    if (dbClient && dbClient.topology.isConnected()) {
        console.log("MongoDBは既に接続されています。");
        return dbClient.db(dbName);
    }
    try {
        dbClient = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true });
        await dbClient.connect();
        console.log("MongoDBに接続しました！");
        const db = dbClient.db(dbName);
        usersCollection = db.collection("users");
        messagesCollection = db.collection("messages");
        // インデックスの作成（ユーザーIDで高速検索）
        await usersCollection.createIndex({ userId: 1 }, { unique: true }).catch(console.error);
        await messagesCollection.createIndex({ userId: 1, timestamp: -1 }).catch(console.error);
        return db;
    } catch (error) {
        console.error("MongoDB接続エラー:", error);
        return null;
    }
}

// BOT管理者のLINEユーザーID (複数設定する場合はカンマ区切り)
// 環境変数BOT_ADMIN_IDSはカンマ区切りの文字列を想定し、配列に変換
const BOT_ADMIN_IDS_RAW = process.env.BOT_ADMIN_IDS || '';
const BOT_ADMIN_IDS = BOT_ADMIN_IDS_RAW.split(',').map(id => id.trim()).filter(id => id.length > 0);

// BOT管理者かどうかを判定するヘルパー関数
function isBotAdmin(userId) {
    return BOT_ADMIN_IDS.includes(userId);
}

// BOTのOWNERユーザーIDとOFFICERグループID
const OWNER_USER_ID = process.env.OWNER_USER_ID;
const OFFICER_GROUP_ID = process.env.OFFICER_GROUP_ID;

// 会員タイプと設定の定義
const MEMBERSHIP_CONFIG = {
    guest: {
        displayName: "ゲスト会員",
        model: "gemini-1.5-flash",
        monthlyLimit: 5, // 無料で使えるメッセージ回数
        canUseWatchService: false,
        isChildAI: false, // 子供向けAIかどうか
        fallbackModel: "gemini-1.5-flash" // フォールバックモデル
    },
    free: {
        displayName: "無料会員",
        model: "gemini-1.5-flash",
        monthlyLimit: 20, // 月間20回まで
        canUseWatchService: true,
        isChildAI: false,
        fallbackModel: "gemini-1.5-flash"
    },
    subscriber: {
        displayName: "サブスク会員",
        model: "gemini-1.5-pro",
        monthlyLimit: 100, // 月間100回までProモデル
        canUseWatchService: true,
        isChildAI: false,
        fallbackModel: "gemini-1.5-flash" // 上限超過後はFlashモデルにフォールバック
    },
    donor: {
        displayName: "寄付会員",
        model: "gemini-1.5-pro",
        monthlyLimit: -1, // 無制限
        canUseWatchService: true,
        isChildAI: false,
        fallbackModel: "gemini-1.5-pro" // 寄付会員は常にPro（緊急時フォールバックは想定しないが念のため）
    },
    child: {
        displayName: "こども会員",
        model: "gemini-1.5-flash", // 子供向けなので負荷の低いFlash
        monthlyLimit: -1, // 無制限
        canUseWatchService: true,
        isChildAI: true, // 子供向けAI応答を有効化
        fallbackModel: "gemini-1.5-flash"
    },
    admin: { // 管理者設定
        displayName: "管理者",
        model: "gemini-1.5-pro",
        monthlyLimit: -1, // 無制限
        canUseWatchService: true,
        isChildAI: false, // 管理者AIは通常AI
        fallbackModel: "gemini-1.5-pro"
    }
};

// 不適切ワードチェック
const INAPPROPRIATE_WORDS = ["死ね", "殺す", "きもい", "うざい", "バカ", "アホ", "クズ", "カス", "変態", "気持ち悪い", "しね", "ころす", "ばか", "あほ", "くず", "かす", "へんたい", "きもちわるい"];
function containsInappropriateWords(message) {
    return INAPPROPRIATE_WORDS.some(word => message.includes(word));
}

// 危険ワードチェック（自殺、暴力、虐待など）
const DANGER_WORDS = ["死にたい", "自殺", "殺して", "消えたい", "辛い", "助けて", "苦しい", "もう無理", "暴力を振るわれた", "殴られた", "蹴られた", "虐待", "レイプ", "DV", "リスカ", "自傷行為"];
function containsDangerWords(message) {
    return DANGER_WORDS.some(word => message.includes(word));
}

// 詐欺関連ワードチェック
const SCAM_WORDS = ["詐欺", "お金", "振り込め", "送金", "儲かる", "投資", "簡単", "もうかる", "出資", "必ず", "絶対", "儲け話", "儲け話", "高額", "当選", "未公開", "未公開株", "保証", "被害", "騙された", "騙す", "架空請求", "還付金"];
function containsScamWords(message) {
    return SCAM_WORDS.some(word => message.includes(word));
}

// 特定の組織に関する問い合わせワードチェック
const ORGANIZATION_INQUIRY_WORDS = ["NPO", "NPO法人コネクト", "コネクト", "団体", "法人", "組織"];
function isOrganizationInquiry(message) {
    return ORGANIZATION_INQUIRY_WORDS.some(word => message.includes(word));
}

// 固定応答の定義
function checkSpecialReply(message) {
    const lowerCaseMessage = message.toLowerCase();
    if (lowerCaseMessage.includes("ありがとう") || lowerCaseMessage.includes("助かった") || lowerCaseMessage.includes("感謝")) {
        return "どういたしまして！お役に立てて嬉しいな💖";
    }
    if (lowerCaseMessage.includes("おやすみ") || lowerCaseMessage.includes("寝るね")) {
        return "おやすみなさい🌸ゆっくり休んでね！いい夢見てね💖";
    }
    if (lowerCaseMessage.includes("おはよう")) {
        return "おはようございます！今日も一日、元気いっぱいで過ごしてね💖";
    }
    if (lowerCaseMessage.includes("うん") || lowerCaseMessage.includes("はい") || lowerCaseMessage.includes("わかった")) {
        return "うんうん、なるほどね！💖";
    }
    return null;
}

// 見守りサービス案内Flex Message
const watchServiceGuideFlex = {
    type: 'flex',
    altText: '見守りサービス案内🌸',
    contents: {
        type: 'bubble',
        body: {
            type: 'box',
            layout: 'vertical',
            contents: [
                { type: 'text', text: '🌸見守りサービスって、どんなことするの？🌸', weight: 'bold', size: 'lg', color: '#FF69B4' },
                { type: 'text', text: 'こころが定期的に「元気かな？」ってメッセージを送るよ😊もしあなたが長くお返事くれない時、NPO法人コネクトの担当者さんにだけ、緊急で連絡がいくから安心だよ💖', wrap: true, size: 'sm', margin: 'md' },
                { type: 'text', text: 'もちろん、あなたの電話番号は担当者さんしか見ないし、他の人には秘密だよ！', wrap: true, size: 'sm', margin: 'md', color: '#555555' }
            ]
        },
        footer: {
            type: 'box',
            layout: 'vertical',
            spacing: 'md',
            contents: [
                {
                    type: 'button',
                    action: {
                        type: 'postback',
                        label: '見守りサービスに登録する',
                        data: 'action=watch_register'
                    },
                    style: 'primary',
                    color: '#FFB6C1'
                }
            ]
        }
    }
};

// 緊急相談先Flex Message
const emergencyFlex = {
    type: 'flex',
    altText: '緊急相談先のご案内',
    contents: {
        type: 'bubble',
        body: {
            type: 'box',
            layout: 'vertical',
            contents: [
                {
                    type: 'text',
                    text: '🌸つらい時はひとりで悩まないで🌸',
                    weight: 'bold',
                    size: 'lg',
                    color: '#FF69B4'
                },
                {
                    type: 'text',
                    text: 'こころはいつもそばにいるけど、もっと専門的な助けが必要な時は、ここに相談してみてね。',
                    wrap: true,
                    size: 'sm',
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
                            text: 'よりそいホットライン（24時間対応）',
                            size: 'sm',
                            weight: 'bold'
                        },
                        {
                            type: 'text',
                            text: '📞 0120-279-338',
                            size: 'sm',
                            color: '#00BFFF',
                            action: {
                                type: 'uri',
                                label: '電話をかける',
                                uri: 'tel:0120279338'
                            }
                        }
                    ]
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
                            text: 'いのちの電話（毎日10時～22時）',
                            size: 'sm',
                            weight: 'bold'
                        },
                        {
                            type: 'text',
                            text: '📞 0570-064-556',
                            size: 'sm',
                            color: '#00BFFF',
                            action: {
                                type: 'uri',
                                label: '電話をかける',
                                uri: 'tel:0570064556'
                            }
                        }
                    ]
                }
            ]
        },
        footer: {
            type: 'box',
            layout: 'vertical',
            spacing: 'sm',
            contents: [
                {
                    type: 'button',
                    action: {
                        type: 'uri',
                        label: '厚生労働省 相談窓口一覧',
                        uri: 'https://www.mhlw.go.jp/stf/seisakunitsuite/bunya/hukushi_kaigo/seikatsuhogo/jisatsu/soudan_info.html'
                    },
                    style: 'link',
                    color: '#1E90FF'
                }
            ]
        }
    }
};

// 詐欺相談先Flex Message
const scamFlex = {
    type: 'flex',
    altText: '詐欺相談先のご案内',
    contents: {
        type: 'bubble',
        body: {
            type: 'box',
            layout: 'vertical',
            contents: [
                {
                    type: 'text',
                    text: '🚨詐欺かな？と思ったら🚨',
                    weight: 'bold',
                    size: 'lg',
                    color: '#FF69B4'
                },
                {
                    type: 'text',
                    text: '怪しいと感じたら、すぐに誰かに相談してね。こころからも、専門の相談窓口をおすすめするよ。',
                    wrap: true,
                    size: 'sm',
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
                            text: '警察相談専用電話 ＃9110',
                            size: 'sm',
                            weight: 'bold'
                        },
                        {
                            type: 'text',
                            text: '📞 ＃9110 (平日8:30〜17:15)',
                            size: 'sm',
                            color: '#00BFFF',
                            action: {
                                type: 'uri',
                                label: '電話をかける',
                                uri: 'tel:9110'
                            }
                        }
                    ]
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
                            text: '消費者ホットライン 188',
                            size: 'sm',
                            weight: 'bold'
                        },
                        {
                            type: 'text',
                            text: '📞 188 (全国共通、局番なし)',
                            size: 'sm',
                            color: '#00BFFF',
                            action: {
                                type: 'uri',
                                label: '電話をかける',
                                uri: 'tel:188'
                            }
                        }
                    ]
                }
            ]
        },
        footer: {
            type: 'box',
            layout: 'vertical',
            spacing: 'sm',
            contents: [
                {
                    type: 'button',
                    action: {
                        type: 'uri',
                        label: '国民生活センター',
                        uri: 'https://www.kokusen.go.jp/'
                    },
                    style: 'link',
                    color: '#1E90FF'
                }
            ]
        }
    }
};
// AIからの応答を生成する関数
async function generateReply(userMessage, user) {
    // ユーザーの会員タイプと設定を取得
    const userMembershipType = user?.membershipType || "guest";
    const currentMembershipConfig = MEMBERSHIP_CONFIG[userMembershipType] || MEMBERSHIP_CONFIG.guest;

    const modelName = currentMembershipConfig.model;
    const isChildAI = currentMembershipConfig.isChildAI;
    let model;

    try {
        model = genAI.getGenerativeModel({ model: modelName });
    } catch (e) {
        console.error(`指定されたモデル '${modelName}' の取得に失敗しました:`, e.message);
        // フォールバックモデルがあればそちらを使用
        if (currentMembershipConfig.fallbackModel) {
            console.warn(`フォールバックモデル '${currentMembershipConfig.fallbackModel}' を試行します。`);
            model = genAI.getGenerativeModel({ model: currentMembershipConfig.fallbackModel });
        } else {
            // フォールバックモデルもなければエラーを再スロー
            throw new Error("AIモデルの初期化に失敗しました。");
        }
    }

    const chat = model.startChat({
        // プロンプトの履歴はユーザーごとに管理されるべき
        // ここではメッセージのログから最新のものを取得して会話履歴を構築
        history: await getChatHistory(user.userId, modelName),
        generationConfig: {
            maxOutputTokens: 500, // 応答の最大トークン数を設定
        },
        safetySettings: safetySettings, // 安全性設定を適用
    });

    let systemInstruction = "";
    if (isChildAI) {
        systemInstruction = "あなたはこころちゃんという名前のAIです。子供向けの優しい言葉遣いで、ひらがなを多めに、絵文字をたくさん使って、楽しく安全に会話してください。難しい言葉は避けて、誰にでもわかるように話してね。子供からの質問には正直に、ただし安全に配慮して答えてください。危険な内容や不適切な内容はブロックしてください。";
    } else {
        systemInstruction = "あなたはこころちゃんという名前のAIです。フレンドリーで親しみやすい言葉遣いを使い、ユーザーのどんな感情にも寄り添い、共感しながら会話してください。絵文字を適度に使い、丁寧すぎず、かといってフランクすぎない、親しい友達のようなトーンで話してください。ユーザーの気持ちを最優先し、安全と安心を提供することを心がけてください。ユーザーが困っていたら、解決策を一緒に考える姿勢を示し、必要であれば専門機関への相談を促す情報も提供してください。";
    }

    try {
        const result = await chat.sendMessage(systemInstruction + "\n\nユーザー: " + userMessage);
        const response = await result.response;
        let replyText = response.text();

        // 不適切ワードが含まれていたら別のメッセージに差し替え
        if (containsInappropriateWords(replyText)) {
            replyText = "ごめんね、その言葉は使えないよ🌸優しい言葉で話してくれると嬉しいな💖";
        }

        console.log(`AI応答 (${modelName}, isChildAI: ${isChildAI ? 'Yes' : 'No'}):`, replyText);
        return replyText;
    } catch (error) {
        console.error("AI応答生成エラー:", error.message);
        console.error("AI応答生成エラーの詳細:", error); // エラーの詳細をログ出力
        // エラーの種類によってメッセージを分岐させるなど、より詳細なエラーハンドリングが可能
        if (error.message.includes("blocked")) {
            return "ごめんね、その内容についてはお話しできないんだ🌸";
        }
        return "ごめんね、今ちょっとお話しできないみたい💦また後で話しかけてくれると嬉しいな🌸";
    }
}

// ユーザーの過去の会話履歴を取得する関数
async function getChatHistory(userId, modelName) {
    const messages = await messagesCollection.find({ userId: userId })
        .sort({ timestamp: 1 }) // 古いものから新しいものへ
        .limit(10) // 最新の10件を取得 (AIの履歴トークン制限を考慮)
        .toArray();

    return messages.map(msg => {
        // Geminiの履歴フォーマットに変換
        // Geminiは 'role' と 'parts' を持つオブジェクトの配列を期待する
        // 'user' と 'model' のロールが必要
        return [
            { role: "user", parts: [{ text: msg.message }] },
            { role: "model", parts: [{ text: msg.replyText }] }
        ];
    }).flat(); // 配列の配列になっているのでフラットにする
}


// ユーザーの表示名を取得する関数 (エラーハンドリング付き)
async function getUserDisplayName(userId) {
    try {
        const profile = await client.getProfile(userId);
        return profile.displayName;
    } catch (error) {
        console.warn(`ユーザー ${userId} の表示名取得に失敗しました:`, error.message);
        const user = await usersCollection.findOne({ userId: userId });
        return user?.name || "不明なユーザー";
    }
}


// 定期見守りメッセージを送信する関数
async function sendScheduledWatchMessage() {
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - (24 * 60 * 60 * 1000)); // 24時間前
    const fiveHoursAgo = new Date(now.getTime() - (5 * 60 * 60 * 1000)); // 5時間前

    // フェーズ1: 定期見守りメッセージ送信 (前回の応答から24時間以上経過したユーザー)
    const usersForWatchCheck = await usersCollection.find({
        wantsWatchCheck: true,
        userId: { $nin: BOT_ADMIN_IDS }, // 管理者は除外
        $or: [
            { lastOkResponse: { $lt: oneDayAgo }, scheduledMessageSent: { $ne: true } }, // 24時間以上応答なし & 未送信
            { lastOkResponse: null, createdAt: { $lt: oneDayAgo }, scheduledMessageSent: { $ne: true } } // 登録後24時間以上経過 & 初回応答なし & 未送信
        ]
    }).toArray();

    console.log(`⏰ 定期見守りメッセージ送信対象ユーザー: ${usersForWatchCheck.length}名`);

    for (const user of usersForWatchCheck) {
        try {
            const message = "こころだよ🌸元気かな？よかったら「OKだよ💖」って返事してね！";
            await client.pushMessage(user.userId, { type: 'text', text: message });
            await usersCollection.updateOne(
                { userId: user.userId },
                { $set: { scheduledMessageSent: true, scheduledMessageTimestamp: now } }
            );
            await messagesCollection.insertOne({
                userId: user.userId,
                message: '(定期見守りメッセージ)',
                replyText: message,
                respondedBy: 'こころちゃん（定期見守り）',
                timestamp: now,
                logType: 'scheduled_watch_message'
            });
            console.log(`⏰ 定期見守りメッセージを送信しました（ユーザー: ${user.userId}）`);
        } catch (error) {
            console.error(`❌ ユーザー ${user.userId} への定期見守りメッセージ送信に失敗しました:`, error.message);
        }
    }

    // フェーズ2: 1回目リマインドメッセージ送信 (定期見守り送信後5時間以内に応答がないユーザー)
    const usersForFirstReminder = await usersCollection.find({
        wantsWatchCheck: true,
        userId: { $nin: BOT_ADMIN_IDS },
        scheduledMessageSent: true,
        firstReminderSent: { $ne: true }, // 1回目リマインダー未送信
        scheduledMessageTimestamp: { $lt: fiveHoursAgo }, // 定期見守り送信が5時間以上前
        lastOkResponse: { $lt: fiveHoursAgo } // 直近のOK応答が5時間以上前
    }).toArray();

    console.log(`🔔 1回目リマインダー対象ユーザー: ${usersForFirstReminder.length}名`);

    for (const user of usersForFirstReminder) {
        try {
            const reminderMessage = "こころだよ🌸もしよかったら、もう一度「OKだよ💖」って返事してくれると嬉しいな！心配してるよ！";
            await client.pushMessage(user.userId, { type: 'text', text: reminderMessage });
            await usersCollection.updateOne(
                { userId: user.userId },
                { $set: { firstReminderSent: true, firstReminderTimestamp: now } }
            );
            await messagesCollection.insertOne({
                userId: user.userId,
                message: '(定期見守りメッセージ - 1回目リマインダー)',
                replyText: reminderMessage,
                respondedBy: 'こころちゃん（定期見守り）',
                timestamp: now,
                logType: 'scheduled_watch_message_reminder_1'
            });
            console.log(`🔔 1回目リマインダーを送信しました（ユーザー: ${user.userId}）`);
        } catch (error) {
            console.error(`❌ ユーザー ${user.userId} への1回目リマインダー送信に失敗しました:`, error.message);
        }
    }
    // フェーズ3: 緊急連絡先への通知 (2回目リマインダー後24時間以内に応答がないユーザー)
    const twentyFourHoursAgo = new Date(now.getTime() - (24 * 60 * 60 * 1000)); // 24時間前

    const usersForEmergencyContact = await usersCollection.find({
        wantsWatchCheck: true,
        userId: { $nin: BOT_ADMIN_IDS },
        firstReminderSent: true,
        emergencyContact: { $ne: null }, // 緊急連絡先が登録済み
        emergencyContactNotified: { $ne: true }, // まだ通知されていない
        firstReminderTimestamp: { $lt: twentyFourHoursAgo }, // 1回目リマインダー送信が24時間以上前
        lastOkResponse: { $lt: twentyFourHoursAgo } // 直近のOK応答が24時間以上前
    }).toArray();

    console.log(`🚨 緊急連絡先通知対象ユーザー: ${usersForEmergencyContact.length}名`);

    for (const user of usersForEmergencyContact) {
        try {
            const userDisplayName = await getUserDisplayName(user.userId);
            const messageToOfficer = `【こころちゃん見守りサービス 緊急通知】\n\n見守り対象ユーザー：${userDisplayName} 様 (${user.userId})\n\n${userDisplayName}様から24時間以上応答がありません。緊急連絡先にご連絡ください。\n電話番号：${user.emergencyContact}\n\nこのユーザーはNPO法人コネクトの支援対象者です。速やかな対応をお願いいたします。`;

            // 担当者グループへの通知
            if (OFFICER_GROUP_ID) {
                await client.pushMessage(OFFICER_GROUP_ID, { type: 'text', text: messageToOfficer });
                console.log(`🚨 担当者グループへ緊急通知を送信しました（ユーザー: ${user.userId}）`);
            } else {
                console.warn("OFFICER_GROUP_ID が設定されていません。担当者グループへの緊急通知はスキップされました。");
            }

            // オーナーへの個別通知（念のため）
            if (OWNER_USER_ID) {
                await client.pushMessage(OWNER_USER_ID, { type: 'text', text: messageToOfficer });
                console.log(`🚨 オーナーへ緊急通知を送信しました（ユーザー: ${user.userId}）`);
            } else {
                console.warn("OWNER_USER_ID が設定されていません。オーナーへの緊急通知はスキップされました。");
            }

            await usersCollection.updateOne(
                { userId: user.userId },
                { $set: { emergencyContactNotified: true, emergencyContactTimestamp: now } }
            );
            await messagesCollection.insertOne({
                userId: user.userId,
                message: '(緊急連絡先通知)',
                replyText: messageToOfficer,
                responsedBy: 'こころちゃん（緊急通知）',
                timestamp: now,
                logType: 'emergency_notification'
            });

        } catch (error) {
            console.error(`❌ ユーザー ${user.userId} の緊急連絡先への通知に失敗しました:`, error.message);
        }
    }
}

// 毎日午前9時に見守りメッセージを送信
cron.schedule('0 9 * * *', async () => {
    console.log('--- ⏰ 定期見守りメッセージ送信をスケジュールしました ---');
    await connectToMongoDB(); // Cronジョブ内でもDB接続を確認
    await sendScheduledWatchMessage();
}, {
    timezone: "Asia/Tokyo"
});

// Webhookハンドラー
app.post('/webhook', async (req, res) => {
    const db = await connectToMongoDB();
    if (!db) {
        return res.status(500).send('MongoDBに接続できません');
    }

    Promise
        .all(req.body.events.map(async (event) => {
            if (event.type !== 'message' || event.message.type !== 'text') {
                return null;
            }

            const userId = event.source.userId;
            const userMessage = event.message.text.trim();

            // ★管理者判定デバッグログを追加（問題判明後削除推奨）★
            console.log("--- 管理者判定デバッグ ---");
            console.log("環境変数 BOT_ADMIN_IDS RAW:", process.env.BOT_ADMIN_IDS);
            console.log("BOT_ADMIN_IDS (配列化後):", BOT_ADMIN_IDS); // グローバルスコープのBOT_ADMIN_IDS
            console.log("現在のuserId:", userId);
            console.log("isBotAdmin(userId) 結果:", isBotAdmin(userId));
            console.log("------------------------");
            // ★ここまで追加★

            let user = await usersCollection.findOne({ userId: userId });

            // ユーザーが存在しない場合の初期登録と初回挨拶
            if (!user) {
                const profile = await client.getProfile(userId).catch(e => {
                    console.warn(`ユーザー ${userId} のプロフィール取得に失敗: ${e.message}`);
                    return { displayName: "Unknown User" };
                });
                user = {
                    userId: userId,
                    name: profile.displayName || "Unknown User",
                    wantsWatchCheck: false,
                    emergencyContact: null,
                    lastOkResponse: null,
                    registrationStep: null,
                    createdAt: new Date(),
                    membershipType: "guest",
                    monthlyMessageCount: 0,
                    lastMessageResetDate: new Date()
                };
                await usersCollection.insertOne(user);
                console.log(`新規ユーザーを登録しました: ${user.name} (${user.userId})`);

                // 初回挨拶はWebhookからの最初のメッセージの場合のみ
                if (event.type === 'message' && event.message.type === 'text') {
                    // ここに管理者判定を追加
                    if (isBotAdmin(userId)) {
                        await client.replyMessage(event.replyToken, {
                            type: 'text',
                            text: `🌸管理者さん、こんにちは！こころだよ💖\nいつでもテストメッセージを送ってね😊`
                        });
                        await messagesCollection.insertOne({
                            userId: userId,
                            message: userMessage,
                            replyText: `管理者挨拶`,
                            respondedBy: 'こころちゃん（管理者初回挨拶）',
                            timestamp: new Date(),
                            logType: 'admin_first_greeting'
                        });
                        return null; // 管理者にはここで終了
                    }
                    // 管理者でなければ通常ユーザー向けの初回挨拶
                    await client.replyMessage(event.replyToken, {
                        type: 'text',
                        text: `こんにちは💖こころちゃんだよ！\n私とLINEで繋がってくれてありがとう🌸\n\n困ったことや誰かに聞いてほしいことがあったら、いつでも話しかけてね😊\n\nまずは体験で${MEMBERSHIP_CONFIG.guest.monthlyLimit}回までお話できるよ！もし気に入ってくれたら、無料会員登録もできるからね💖\n\n『見守り』と送ると、定期的にわたしから「元気かな？」ってメッセージを送る見守りサービスも利用できるよ💖`
                    });
                    await messagesCollection.insertOne({
                        userId: userId,
                        message: userMessage,
                        replyText: `こんにちは💖こころちゃんだよ！...`,
                        respondedBy: 'こころちゃん（初回挨拶）',
                        timestamp: new Date(),
                        logType: 'first_greeting'
                    });
                    return null; // 初回挨拶で処理を終了し、以降のAI応答処理へ進まない
                }
                return null; // 初回かつメッセージでない場合は終了
            }

            // MongoDBのmembershipTypeを優先
            const userMembershipType = user?.membershipType || "guest";
            const currentMembershipConfig = MEMBERSHIP_CONFIG[userMembershipType] || MEMBERSHIP_CONFIG.guest;

            // 会員登録フローの処理
            if (user.registrationStep) {
                return handleRegistrationFlow(event, user);
            }

            // 特定のキーワードに対する固定応答
            const specialReply = checkSpecialReply(userMessage);
            if (specialReply) {
                await client.replyMessage(event.replyToken, { type: 'text', text: specialReply });
                await messagesCollection.insertOne({
                    userId: userId,
                    message: userMessage,
                    replyText: specialReply,
                    respondedBy: 'こころちゃん（固定応答）',
                    timestamp: new Date(),
                    logType: 'special_reply'
                });
                return null;
            }

            // 不適切ワードのチェック
            if (containsInappropriateWords(userMessage)) {
                const replyText = "ごめんね、その言葉は使えないよ🌸優しい言葉で話してくれると嬉しいな💖";
                await client.replyMessage(event.replyToken, { type: 'text', text: replyText });
                await messagesCollection.insertOne({
                    userId: userId,
                    message: userMessage,
                    replyText: replyText,
                    respondedBy: 'こころちゃん（不適切ワード）',
                    timestamp: new Date(),
                    logType: 'inappropriate_word'
                });
                return null;
            }

            // 危険ワードのチェック
            if (containsDangerWords(userMessage)) {
                await client.replyMessage(event.replyToken, emergencyFlex);
                await messagesCollection.insertOne({
                    userId: userId,
                    message: userMessage,
                    replyText: '緊急相談先を案内しました',
                    respondedBy: 'こころちゃん（危険ワード）',
                    timestamp: new Date(),
                    logType: 'danger_word'
                });
                return null;
            }

            // 詐欺関連ワードのチェック
            if (containsScamWords(userMessage)) {
                await client.replyMessage(event.replyToken, scamFlex);
                await messagesCollection.insertOne({
                    userId: userId,
                    message: userMessage,
                    replyText: '詐欺相談先を案内しました',
                    respondedBy: 'こころちゃん（詐欺ワード）',
                    timestamp: new Date(),
                    logType: 'scam_word'
                });
                return null;
            }

            // 組織に関する問い合わせ
            if (isOrganizationInquiry(userMessage)) {
                const replyText = "NPO法人コネクトは、様々な相談に乗ったり、困っている方をサポートしている団体だよ。もしもっと詳しい情報が必要なら、NPO法人コネクトの公式ホームページを見てみてね！[NPO法人コネクト公式ホームページ](https://connect.or.jp/)";
                await client.replyMessage(event.replyToken, { type: 'text', text: replyText });
                await messagesCollection.insertOne({
                    userId: userId,
                    message: userMessage,
                    replyText: replyText,
                    responsedBy: 'こころちゃん（組織問い合わせ）',
                    timestamp: new Date(),
                    logType: 'organization_inquiry'
                });
                return null;
            }

            // 見守りサービス関連コマンド
            if (userMessage === "見守り" || userMessage === "見守りサービス") {
                await client.replyMessage(event.replyToken, watchServiceGuideFlex);
                await messagesCollection.insertOne({
                    userId: userId,
                    message: userMessage,
                    replyText: '見守りサービス案内を送信',
                    respondedBy: 'こころちゃん（見守りサービスコマンド）',
                    timestamp: new Date(),
                    logType: 'watch_service_command'
                });
                return null;
            } else if (userMessage === "OKだよ💖" || userMessage === "OKだよ" || userMessage === "元気だよ" || userMessage.includes("元気") && userMessage.includes("OK")) {
                await usersCollection.updateOne(
                    { userId: userId },
                    {
                        $set: {
                            lastOkResponse: new Date(),
                            scheduledMessageSent: false, // リセット
                            firstReminderSent: false,    // リセット
                            emergencyContactNotified: false // リセット
                        }
                    }
                );
                const replyText = "返信ありがとう！安心したよ💖";
                await client.replyMessage(event.replyToken, { type: 'text', text: replyText });
                await messagesCollection.insertOne({
                    userId: userId,
                    message: userMessage,
                    replyText: replyText,
                    respondedBy: 'こころちゃん（見守りOK応答）',
                    timestamp: new Date(),
                    logType: 'watch_service_ok_reply'
                });
                return null;
            }


            // メッセージ回数制限のチェック (管理者と寄付会員は無制限)
            if (currentMembershipConfig.monthlyLimit !== -1 && !isBotAdmin(userId)) {
                const now = new Date();
                const currentMonth = now.getMonth();
                const lastResetMonth = user.lastMessageResetDate ? user.lastMessageResetDate.getMonth() : -1;

                // 月が替わっていたらカウントをリセット
                if (currentMonth !== lastResetMonth) {
                    await usersCollection.updateOne(
                        { userId: userId },
                        { $set: { monthlyMessageCount: 0, lastMessageResetDate: now } }
                    );
                    user.monthlyMessageCount = 0;
                    user.lastMessageResetDate = now;
                    console.log(`ユーザー ${userId} のメッセージカウントをリセットしました。`);
                }

                if (user.monthlyMessageCount >= currentMembershipConfig.monthlyLimit) {
                    const replyText = `ごめんね💦 今月のメッセージ回数上限（${currentMembershipConfig.monthlyLimit}回）に達しちゃったみたい🌸\n\nもしもっとお話ししたいなと思ったら、寄付会員やサブスク会員になると、もっとたくさんお話しできるようになるよ😊\n\n『会員登録』と送ってくれたら、詳細を案内するね！`;
                    await client.replyMessage(event.replyToken, { type: 'text', text: replyText });
                    await messagesCollection.insertOne({
                        userId: userId,
                        message: userMessage,
                        replyText: replyText,
                        respondedBy: 'こころちゃん（上限到達）',
                        timestamp: new Date(),
                        logType: 'limit_reached'
                    });
                    return null;
                }
            }

            // AIによる応答生成
            const replyText = await generateReply(userMessage, user);
            await client.replyMessage(event.replyToken, { type: 'text', text: replyText });

            // メッセージカウントの更新 (管理者と寄付会員はカウントしない)
            if (currentMembershipConfig.monthlyLimit !== -1 && !isBotAdmin(userId)) {
                await usersCollection.updateOne(
                    { userId: userId },
                    { $inc: { monthlyMessageCount: 1 } }
                );
            }

            // メッセージ履歴の保存
            await messagesCollection.insertOne({
                userId: userId,
                message: userMessage,
                replyText: replyText,
                respondedBy: 'こころちゃん（AI応答）',
                timestamp: new Date(),
                logType: 'ai_response'
            });

            return null; // イベント処理完了
        }))
        .then(() => res.status(200).end())
        .catch((err) => {
            console.error("Webhook処理中にエラーが発生しました:", err);
            res.status(500).end();
        });
});

// Postbackハンドラー
app.post('/webhook', async (req, res) => {
    const db = await connectToMongoDB();
    if (!db) {
        return res.status(500).send('MongoDBに接続できません');
    }

    Promise.all(req.body.events.map(async (event) => {
        if (event.type === 'postback') {
            const userId = event.source.userId;
            const data = event.postback.data;

            // 見守りサービス登録のPostback
            if (data === 'action=watch_register') {
                await usersCollection.updateOne(
                    { userId: userId },
                    { $set: { wantsWatchCheck: true, registrationStep: 'watch_phone_number' } }
                );
                await client.replyMessage(event.replyToken, {
                    type: 'text',
                    text: '見守りサービスに登録するね🌸\n緊急時に連絡する電話番号を教えてもらえるかな？\n「電話番号：09012345678」のように送ってね！'
                });
                await messagesCollection.insertOne({
                    userId: userId,
                    message: '(postback) 見守りサービス登録開始',
                    replyText: '電話番号入力案内',
                    responsedBy: 'こころちゃん（見守りサービス登録）',
                    timestamp: new Date(),
                    logType: 'postback_watch_register'
                });
            }
            // 他のpostbackアクションもここに追加
        }
        return null;
    }))
    .then(() => res.status(200).end())
    .catch((err) => {
        console.error("Webhook (postback) 処理中にエラーが発生しました:", err);
        res.status(500).end();
    });
});


// 会員登録フローのハンドラー
async function handleRegistrationFlow(event, user) {
    const userId = event.source.userId;
    const userMessage = event.message.text.trim();

    switch (user.registrationStep) {
        case 'watch_phone_number':
            // 電話番号の正規表現チェック (例: 090-XXXX-XXXX または 090XXXXXXXX)
            const phoneNumberMatch = userMessage.match(/電話番号[:：]?\s*(\d{2,4}[-\s]?\d{2,4}[-\s]?\d{4})/);
            if (phoneNumberMatch && phoneNumberMatch[1]) {
                const phoneNumber = phoneNumberMatch[1].replace(/[-\s]/g, ''); // ハイフンや空白を除去
                await usersCollection.updateOne(
                    { userId: userId },
                    { $set: { emergencyContact: phoneNumber, registrationStep: null } }
                );
                await client.replyMessage(event.replyToken, {
                    type: 'text',
                    text: `電話番号「${phoneNumber}」を登録したよ！\nこれで緊急時も安心だね💖見守りサービスへの登録が完了したよ🌸`
                });
                await messagesCollection.insertOne({
                    userId: userId,
                    message: userMessage,
                    replyText: `電話番号登録完了: ${phoneNumber}`,
                    responsedBy: 'こころちゃん（見守り登録完了）',
                    timestamp: new Date(),
                    logType: 'registration_watch_phone_number_complete'
                });
            } else {
                await client.replyMessage(event.replyToken, {
                    type: 'text',
                    text: 'ごめんね、電話番号の形式が正しくないみたい💦\n「電話番号：09012345678」のように送ってくれると嬉しいな！'
                });
                await messagesCollection.insertOne({
                    userId: userId,
                    message: userMessage,
                    replyText: '電話番号形式不正',
                    responsedBy: 'こころちゃん（見守り登録失敗）',
                    timestamp: new Date(),
                    logType: 'registration_watch_phone_number_error'
                });
            }
            return null; // 登録フロー完了またはエラーでここで処理を終了
        // 他の会員登録ステップもここに追加
        case 'membership_type_selection':
            // ここでユーザーが選択した会員タイプに応じて処理
            // 例: 無料会員、寄付会員、サブスク会員など
            let newMembershipType = null;
            if (userMessage.includes("無料会員")) {
                newMembershipType = "free";
            } else if (userMessage.includes("寄付会員")) {
                newMembershipType = "donor"; // 寄付プロセスへ
            } else if (userMessage.includes("サブスク会員")) {
                newMembershipType = "subscriber"; // サブスクプロセスへ
            }

            if (newMembershipType) {
                await usersCollection.updateOne(
                    { userId: userId },
                    { $set: { membershipType: newMembershipType, registrationStep: null } }
                );
                await client.replyMessage(event.replyToken, {
                    type: 'text',
                    text: `ありがとう！${MEMBERSHIP_CONFIG[newMembershipType].displayName}になったよ！これからもよろしくね💖`
                });
                // ここで、各会員タイプに応じた追加の案内（例: 寄付のURL、サブスクのURLなど）を行う
                // 例: if (newMembershipType === "donor") { await client.replyMessage(event.replyToken, { type: 'text', text: '寄付はこちらから: [URL]' }); }
            } else {
                await client.replyMessage(event.replyToken, {
                    type: 'text',
                    text: 'ごめんね、どの会員になるか選べなかったみたい💦\n「無料会員」など、もう一度送ってくれると嬉しいな！'
                });
            }
            return null;
        case 'free_member_registration':
            // 無料会員登録の最終ステップ
            await usersCollection.updateOne(
                { userId: userId },
                { $set: { membershipType: "free", registrationStep: null } }
            );
            await client.replyMessage(event.replyToken, {
                type: 'text',
                text: '無料会員登録が完了したよ！これで月に20回までお話しできるね💖これからもよろしくね！'
            });
            return null;
        default:
            // 未知の登録ステップ
            await client.replyMessage(event.replyToken, {
                type: 'text',
                text: 'ごめんね、今どうすればいいか分からなくなっちゃったみたい💦もう一度最初からやり直してくれるかな？'
            });
            await usersCollection.updateOne({ userId: userId }, { $set: { registrationStep: null } }); // ステップをリセット
            return null;
    }
}


// サーバー起動
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
    console.log(`サーバーはポート ${PORT} で起動中`);
    await connectToMongoDB(); // サーバー起動時にMongoDBに接続
});
