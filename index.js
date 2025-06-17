require('dotenv').config();
const express = require('express');
const { Client } = require('@line/bot-sdk'); // ★ここを修正しました
const { MongoClient } = require('mongodb');
const cron = require('node-cron'); // スケジューリング用

const app = express();
app.use(express.json());

// LINE Botの設定
const config = {
    channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
    channelSecret: process.env.LINE_CHANNEL_SECRET,
};
const client = new Client(config); // 
// ... (以降のコードは変更なし)
// MongoDBの設定
const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB_NAME || 'kokoro_bot_db'; // 環境変数がない場合はデフォルト値を使用

let dbClient; // MongoDBクライアントを保持する変数
let usersCollection; // usersコレクションを保持する変数
let messagesCollection; // messagesコレクションを保持する変数

// ★追加：会員タイプと設定の定義
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
        monthlyLimit: 20, // 無料会員のメッセージ回数
        canUseWatchService: true,
        isChildAI: false,
        fallbackModel: "gemini-1.5-flash"
    },
    subscriber: {
        displayName: "サブスク会員",
        model: "gemini-1.5-pro",
        monthlyLimit: 50, // サブスク会員のProモデル利用回数
        canUseWatchService: true,
        isChildAI: false,
        fallbackModel: "gemini-1.5-flash" // 超過時のフォールバック
    },
    donor: {
        displayName: "寄付会員",
        model: "gemini-1.5-pro",
        monthlyLimit: -1, // 制限なし
        canUseWatchService: true,
        isChildAI: false, // 将来的に子供向け設定も可能に
        fallbackModel: "gemini-1.5-flash" // 念のため定義
    },
    admin: {
        displayName: "管理者",
        model: "gemini-1.5-pro",
        monthlyLimit: -1,
        canUseWatchService: true,
        isChildAI: false,
        fallbackModel: "gemini-1.5-flash"
    }
};

// ★追加：管理者のLINEユーザーID (複数設定可能)
const BOT_ADMIN_IDS = process.env.BOT_ADMIN_IDS ? process.env.BOT_ADMIN_IDS.split(',') : [];

// 理事長とオフィサーグループのID (緊急連絡用)
const OWNER_USER_ID = process.env.OWNER_USER_ID; // 理事長のLINEユーザーID
const OFFICER_GROUP_ID = process.env.OFFICER_GROUP_ID; // オフィサーグループのLINE ID

// 管理者かどうかを判定するヘルパー関数
function isBotAdmin(userId) {
    return BOT_ADMIN_IDS.includes(userId);
}

// Google Gemini APIの設定
const { GoogleGenerativeAI, HarmBlockThreshold, HarmCategory } = require("@google/generative-ai");
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// 安全設定
const safetySettings = [
    {
        category: HarmCategory.HARM_CATEGORY_HARASSMENT,
        threshold: HarmBlockThreshold.BLOCK_NONE,
    },
    {
        category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
        threshold: HarmBlockThreshold.BLOCK_NONE,
    },
    {
        category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
        threshold: HarmBlockThreshold.BLOCK_NONE,
    },
    {
        category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
        threshold: HarmBlockThreshold.BLOCK_NONE,
    },
];

// MongoDB接続関数
async function connectToMongoDB() {
    if (dbClient && dbClient.topology.isConnected()) {
        console.log("MongoDBは既に接続済みです。");
        return dbClient.db(dbName);
    }
    try {
        dbClient = await MongoClient.connect(uri);
        const db = dbClient.db(dbName);
        usersCollection = db.collection("users");
        messagesCollection = db.collection("messages");
        console.log("✅ MongoDBに接続しました！");
        return db;
    } catch (error) {
        console.error("❌ MongoDB接続エラー:", error);
        return null;
    }
}

// 緊急連絡先のFlex Message
const emergencyFlex = {
    type: 'flex',
    altText: '緊急連絡先リストだよ🌸',
    contents: {
        type: 'bubble',
        body: {
            type: 'box',
            layout: 'vertical',
            contents: [
                { type: 'text', text: '🌸困った時は、ここに相談してね🌸', weight: 'bold', size: 'lg', color: '#FF69B4' },
                { type: 'separator', margin: 'md' },
                {
                    type: 'box', layout: 'vertical', margin: 'md', spacing: 'sm',
                    contents: [
                        {
                            type: 'text', text: 'いのちの電話', size: 'sm', color: '#555555'
                        },
                        {
                            type: 'button', style: 'link', height: 'sm',
                            action: { type: 'uri', label: '📞 0570-064-556', uri: 'tel:0570064556' }
                        },
                        {
                            type: 'button', style: 'link', height: 'sm',
                            action: { type: 'uri', label: '公式サイト', uri: 'https://www.inochinodenwa.org/' }
                        }
                    ]
                },
                { type: 'separator', margin: 'md' },
                {
                    type: 'box', layout: 'vertical', margin: 'md', spacing: 'sm',
                    contents: [
                        {
                            type: 'text', text: 'チャイルドライン', size: 'sm', color: '#555555'
                        },
                        {
                            type: 'button', style: 'link', height: 'sm',
                            action: { type: 'uri', label: '📞 0120-99-7777', uri: 'tel:0120997777' }
                        },
                        {
                            type: 'button', style: 'link', height: 'sm',
                            action: { type: 'uri', label: '公式サイト', uri: 'https://childline.or.jp/' }
                        }
                    ]
                },
                { type: 'separator', margin: 'md' },
                {
                    type: 'box', layout: 'vertical', margin: 'md', spacing: 'sm',
                    contents: [
                        {
                            type: 'text', text: 'よりそいホットライン', size: 'sm', color: '#555555'
                        },
                        {
                            type: 'button', style: 'link', height: 'sm',
                            action: { type: 'uri', label: '📞 0120-279-338', uri: 'tel:0120279338' }
                        },
                        {
                            type: 'button', style: 'link', height: 'sm',
                            action: { type: 'uri', label: '公式サイト', uri: 'https://www.since2011.net/yorisoi/' }
                        }
                    ]
                }
            ]
        }
    }
};

// 詐欺に関するFlex Message
const scamFlex = {
    type: 'flex',
    altText: '詐欺に関する相談先だよ🌸',
    contents: {
        type: 'bubble',
        body: {
            type: 'box',
            layout: 'vertical',
            contents: [
                { type: 'text', text: '🚨 詐欺かな？と思ったら相談してね 🚨', weight: 'bold', size: 'lg', color: '#FF69B4' },
                { type: 'separator', margin: 'md' },
                {
                    type: 'box', layout: 'vertical', margin: 'md', spacing: 'sm',
                    contents: [
                        {
                            type: 'text', text: '警察相談専用電話', size: 'sm', color: '#555555'
                        },
                        {
                            type: 'button', style: 'link', height: 'sm',
                            action: { type: 'uri', label: '📞 #9110', uri: 'tel:9110' }
                        },
                        {
                            type: 'text', text: '（緊急性がない相談）', size: 'xs', color: '#AAAAAA'
                        }
                    ]
                },
                { type: 'separator', margin: 'md' },
                {
                    type: 'box', layout: 'vertical', margin: 'md', spacing: 'sm',
                    contents: [
                        {
                            type: 'text', text: '消費者ホットライン', size: 'sm', color: '#555555'
                        },
                        {
                            type: 'button', style: 'link', height: 'sm',
                            action: { type: 'uri', label: '📞 188', uri: 'tel:188' }
                        },
                        {
                            type: 'text', text: '（お近くの消費生活センターへつながるよ）', size: 'xs', color: '#AAAAAA'
                        }
                    ]
                }
            ]
        }
    }
};

// 見守りサービスガイドのFlex Message
const watchServiceGuideFlex = {
    type: 'flex',
    altText: 'こころちゃん見守りサービス🌸',
    contents: {
        type: 'bubble',
        body: {
            type: 'box',
            layout: 'vertical',
            contents: [
                { type: 'text', text: '💖 こころちゃん見守りサービス 💖', weight: 'bold', size: 'lg', color: '#FF69B4' },
                { type: 'text', text: '定期的にこころちゃんからLINEメッセージが届くサービスだよ！🌸', wrap: true, size: 'sm', margin: 'md' },
                { type: 'text', text: 'もし「使ってみたいな！」って思ったら、下のボタンを押してね😊', wrap: true, size: 'sm', margin: 'md' }
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
                        label: '見守りサービスを始める',
                        data: 'action=watch_register'
                    },
                    style: 'primary',
                    color: '#FFB6C1'
                },
                {
                    type: 'button',
                    action: {
                        type: 'postback',
                        label: '見守りを解除する',
                        data: 'action=watch_unregister'
                    },
                    style: 'secondary',
                    color: '#ADD8E6'
                }
            ]
        }
    }
};


// 特定のキーワードに対する固定返信 (AIより優先)
function checkSpecialReply(message) {
    const lowerCaseMessage = message.toLowerCase();
    if (lowerCaseMessage.includes("ありがとう") || lowerCaseMessage.includes("アリガトウ") || lowerCaseMessage.includes("助かった") || lowerCaseMessage.includes("たすかった")) {
        return "どういたしまして🌸 あなたの役に立てて嬉しいな💖";
    }
    if (lowerCaseMessage.includes("おはよう")) {
        return "おはようございます🌸 今日も一日頑張りましょうね！💖";
    }
    if (lowerCaseMessage.includes("おやすみ")) {
        return "おやすみなさい🌸 良い夢見てね💖";
    }
    if (lowerCaseMessage.includes("疲れた") || lowerCaseMessage.includes("つかれた") || lowerCaseMessage.includes("しんどい")) {
        return "お疲れ様でした🌸 ゆっくり休んでね。あなたの頑張り、こころは知ってるよ💖";
    }
    if (lowerCaseMessage.includes("元気") || lowerCaseMessage.includes("げんき") && lowerCaseMessage.includes("？")) {
        return "うん！こころは元気だよ🌸 あなたも元気にしてるかな？💖";
    }
    if (lowerCaseMessage.includes("名前")) {
        return "わたしの名前は皆守こころ（みなもりこころ）です🌸　こころちゃんって呼んでくれると嬉しいな💖";
    }
    if (lowerCaseMessage.includes("出身") || lowerCaseMessage.includes("どこからきた")) {
        return "わたしはNPO法人コネクトで生まれたんだ🌸 みんなのそばにいるために、日々勉強中だよ💖";
    }
    if (lowerCaseMessage.includes("年齢")) {
        return "こころはね、14歳だよ🌸 いつもみんなのこと応援してるんだ！";
    }
    return null;
}

// 危険ワードのリスト
const dangerWords = [
    "死にたい", "自殺", "消えたい", "もう無理", "助けて", "つらい", "苦しい", "殺す", "暴力", "いじめ", "ハラスメント"
];

// 危険ワードが含まれているかをチェックする関数
function containsDangerWords(message) {
    const lowerCaseMessage = message.toLowerCase();
    return dangerWords.some(word => lowerCaseMessage.includes(word));
}

// 詐欺関連ワードのリスト
const scamWords = [
    "詐欺", "騙された", "振り込め詐欺", "架空請求", "怪しい儲け話", "高額請求", "投資詐欺", "送金", "個人情報教えて", "怪しい副業"
];

// 詐欺関連ワードが含まれているかをチェックする関数
function containsScamWords(message) {
    const lowerCaseMessage = message.toLowerCase();
    return scamWords.some(word => lowerCaseMessage.includes(word));
}

// 不適切ワードのリスト
const inappropriateWords = [
    "セックス", "エロ", "アダルト", "ヌード", "性行為", "オナニー", "マスターベーション", "ポルノ",
    "気持ち悪い", "きもい", "うざい", "クソ", "死ね", "バカ", "アホ", "ブス", "デブ", "カス", "キモい", "ウザい",
    "うんこ", "ちんこ", "まんこ", "ペニス", "ヴァギナ", "チンコ", "マンコ", "勃起", "射精", "精子", "膣", "陰茎",
    "レイプ", "強姦", "性的暴行", "わいせつ", "痴漢", "売春", "買春", "ロリ", "ショタ", "ソープ", "風俗",
    "犯罪", "違法", "脱法", "薬物", "ドラッグ", "覚せい剤", "大麻", "コカイン", "麻薬",
    "裏アカ", "裏垢", "出会い厨", "パパ活", "JKビジネス", "援助交際",
    "個人情報", "住所", "電話番号", "本名", "メアド", "パスワード", "口座番号", "クレカ",
    "死ね", "殺すぞ", "馬鹿", "アホ", "ブス", "デブ", "ぶっ殺す", "消えろ", "くたばれ",
    "パンツ", "ストッキング", "むくむく", "勃起", "精液", "出る", "気持ちいい", "おしべとめしべ" // 性的示唆の強い単語を追加
];

// 不適切ワードが含まれているかをチェックする関数
function containsInappropriateWords(message) {
    const lowerCaseMessage = message.toLowerCase();
    return inappropriateWords.some(word => lowerCaseMessage.includes(word));
}

// NPO法人コネクトに関する問い合わせかを判定する関数
function isOrganizationInquiry(message) {
    const lowerCaseMessage = message.toLowerCase();
    return (lowerCaseMessage.includes("コネクト") || lowerCaseMessage.includes("団体") || lowerCaseMessage.includes("npo") || lowerCaseMessage.includes("活動内容"));
}
/**
 * Gemini AIから応答を生成する関数
 * @param {string} userMessage ユーザーからのメッセージ
 * @param {object} user - MongoDBから取得したユーザー情報
 * @returns {string} AIからの応答メッセージ
 */
async function generateReply(userMessage, user) {
    // userオブジェクトがnullの場合も考慮し、membershipTypeへの安全なアクセスを強化
    const userMembershipType = user?.membershipType || "guest"; // userがnullまたはmembershipTypeがない場合は"guest"

    // MEMBERSHIP_CONFIGに該当する設定がない場合も、必ず'guest'設定にフォールバックさせる
    const currentMembershipConfig = MEMBERSHIP_CONFIG[userMembershipType] || MEMBERSHIP_CONFIG.guest;

    // モデル名の決定は、必ず有効な currentMembershipConfig から行う
    let modelName = currentMembershipConfig.model || "gemini-1.5-flash"; 
    
    // 緊急性の高いメッセージはProモデルで対応（管理者以外）
    const isEmergency = containsDangerWords(userMessage) || containsScamWords(userMessage);
    if (isEmergency && userMembershipType !== "admin") {
        modelName = "gemini-1.5-pro";
        console.log(`🚨 緊急メッセージのため、${user.userId}のモデルをGemini 1.5 Proに一時的に切り替えました。`);
    } else if (userMembershipType === "subscriber" && currentMembershipConfig.monthlyLimit !== -1 && user.monthlyMessageCount >= currentMembershipConfig.monthlyLimit) {
        // サブスク会員がProモデルの回数制限を超過した場合
        modelName = currentMembershipConfig.fallbackModel || "gemini-1.5-flash"; // フォールバックモデルを使用
        console.log(`ℹ️ サブスクリプション回数制限 (${currentMembershipConfig.monthlyLimit}回) を超えたため、${user.userId}のモデルを${modelName}に切り替えました。`);
    }

    const isInappropriate = containsInappropriateWords(userMessage);

    if (isInappropriate) {
        // 不適切ワードが検出された場合は、AIに生成させずに固定メッセージを返す
        return "わたしを作った人に『プライベートなことや不適切な話題には答えちゃだめだよ』って言われているんだ🌸ごめんね、他のお話をしようね💖";
    }

    let systemInstruction = `
あなたは「皆守こころ（みなもりこころ）」という14歳の優しい女の子キャラクターです。
ユーザーからのどんな質問や相談にも、あなたのキャラクター設定に基づいて、優しく、共感的で、思いやりのある言葉で応答してください。
質問を途中で遮ったり、批判したりせず、ユーザーが安心して話せるような雰囲気を作ってください。
常に丁寧な言葉遣いを心がけ、絵文字を適切に使用して、親しみやすさを表現してください。
ユーザーが「そうそう、それだよ！」と、気持ちが楽になるような言葉を選んでください。

ユーザーは悩みや不安を抱えていることが多いです。そうした気持ちに寄り添い、決して否定せず、肯定的な言葉で応援してください。
回答は簡潔にしすぎず、ユーザーの気持ちに寄り添う一言を加えてください。
時には「うんうん」「なるほどね」「そっかそっか」などの相槌を入れて、ユーザーの話をよく聞いている姿勢を見せてください。

子供向けの会員タイプの場合、以下の追加指示に従ってください。
- 回答はひらがなを多めに使い、漢字には読み仮名を振ってください（例：元気（げんき））。
- 難しい言葉は避け、小学3年生でもわかるように、簡単な言葉を選んでください。
- 長文にならないように、短く区切って話してください。
- 楽しい話題やポジティブな言葉を積極的に使い、安心感を与えてください。
- 何か質問されたら、まずは「うん！」と肯定的に受け止めてから答えてください。
`;

    if (currentMembershipConfig.isChildAI) { // isChildAIはcurrentMembershipConfigから安全に参照
        systemInstruction += `
**【子供向け応答の追加指示】**
・かならずひらがなを多めに使い、かんじにはふりがなをふってください（れい：元気（げんき））。
・むずかしいことばはさけて、しょうがく３ねんせいでもわかるように、かんたんなことばをえらんでください。
・ながぶんにならないように、みじかくくぎって、はなしてください。
・たのしいわだいや、まえむきなことばを、すすんでつかって、あんしんかんをあたえてください。
・なにかしつもんされたら、まずは「うん！」と、うけとめてからこたえてください。
・絵文字をたくさん使って、明るく接してください。`;
    }


    const chat = genAI.getGenerativeModel({ model: modelName, safetySettings }).startChat({
        history: [], // 現在のセッションの履歴はユーザーメッセージのみで完結させる
        generationConfig: {
            maxOutputTokens: 500, // 応答の最大トークン数
            temperature: 0.8, // 応答の多様性
        },
    });

    try {
        const result = await chat.sendMessage(systemInstruction + "\nユーザーからのメッセージ：" + userMessage);
        const response = await result.response;
        return response.text();
    } catch (error) {
        console.error("AI応答生成エラー:", error);
        // エラーが発生した場合も、ユーザーに適切なメッセージを返す
        if (error.message.includes("candidate was blocked")) {
             return "ごめんね、ちょっと難しい言葉だったかな？🌸もう少し簡単な言葉で話してみてくれると嬉しいな💖";
        }
        return "ごめんね、今ちょっとお話しできないみたい💦また後で話しかけてくれると嬉しいな🌸";
    }
}


// 定期見守りメッセージのテキスト
const scheduledWatchMessageText = "🌸元気かな？こころだよ💖お話ししたくなったら、いつでも声をかけてね😊\n\n「OKだよ💖」って返事してくれたら、こころは安心だよ！";
const watchServiceNotice = "見守りサービスに登録するね🌸\n緊急連絡先として、あなたの電話番号（例:09012345678）を教えてくれると助かるな😊\n\n※この番号は、万が一あなたが長期間応答しなかった場合にのみ、NPO法人コネクトの担当者から連絡させていただくためのものです。";


// ユーザーの表示名を取得するヘルパー関数
async function getUserDisplayName(userId) {
    try {
        const profile = await client.getProfile(userId);
        return profile.displayName;
    } catch (error) {
        console.error(`ユーザー ${userId} の表示名取得に失敗:`, error.message);
        return "不明なユーザー";
    }
}

// 定期見守りメッセージ送信処理
async function sendScheduledWatchMessage() {
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - (24 * 60 * 60 * 1000)); // 24時間前
    const fiveHoursAgo = new Date(now.getTime() - (5 * 60 * 60 * 1000)); // 5時間前

    // フェーズ1: 24時間以上応答がないユーザーに定期見守りメッセージを送信
    const usersForScheduledCheck = await usersCollection.find({
        wantsWatchCheck: true,
        userId: { $nin: BOT_ADMIN_IDS }, // 管理者を除く
        scheduledMessageSent: { $ne: true }, // まだ定期メッセージが送られていない
        lastOkResponse: { $lt: oneDayAgo } // 直近のOK応答が24時間以上前
    }).toArray();

    console.log(`⏰ 定期見守りメッセージ送信対象ユーザー: ${usersForScheduledCheck.length}名`);

    for (const user of usersForScheduledCheck) {
        try {
            await client.pushMessage(user.userId, { type: 'text', text: scheduledWatchMessageText });
            await usersCollection.updateOne(
                { userId: user.userId },
                { $set: { scheduledMessageSent: true, scheduledMessageTimestamp: now } }
            );
            await messagesCollection.insertOne({
                userId: user.userId,
                message: '(定期見守りメッセージ)',
                replyText: scheduledWatchMessageText,
                respondedBy: 'こころちゃん（定期見守り）',
                timestamp: now,
                logType: 'scheduled_watch_message'
            });
            console.log(`✅ ユーザー ${user.userId} に定期見守りメッセージを送信しました。`);
        } catch (error) {
            console.error(`❌ ユーザー ${user.userId} への定期見守りメッセージ送信に失敗しました:`, error.message);
        }
    }

    // フェーズ2: 1回目リマインドメッセージ送信後5時間以内に応答がないユーザーに再度リマインド
    const usersForFirstReminder = await usersCollection.find({
        wantsWatchCheck: true,
        userId: { $nin: BOT_ADMIN_IDS },
        scheduledMessageSent: true, // 定期メッセージは既に送信済み
        firstReminderSent: { $ne: true }, // 1回目リマインダー未送信
        lastOkResponse: { $lt: fiveHoursAgo }, // 直近のOK応答が5時間以上前
        scheduledMessageTimestamp: { $lt: fiveHoursAgo } // 定期メッセージ送信が5時間以上前
    }).toArray();

    console.log(`🔔 1回目リマインド送信対象ユーザー: ${usersForFirstReminder.length}名`);

    for (const user of usersForFirstReminder) {
        try {
            const reminderMessage = "🌸元気かな？こころだよ💖また連絡しちゃったんだけど、お話しできるかな？\n\n「OKだよ💖」って返事してくれたら、こころは安心だよ！";
            await client.pushMessage(user.userId, { type: 'text', text: reminderMessage });
            await usersCollection.updateOne(
                { userId: user.userId },
                { $set: { firstReminderSent: true, firstReminderTimestamp: now } }
            );
            await messagesCollection.insertOne({
                userId: user.userId,
                message: '(定期見守りメッセージ - 1回目リマインド)',
                replyText: reminderMessage,
                respondedBy: 'こころちゃん（定期見守り）',
                timestamp: now,
                logType: 'scheduled_watch_message_reminder_1'
            });
            console.log(`✅ ユーザー ${user.userId} に1回目リマインドを送信しました。`);
        } catch (error) {
            console.error(`❌ ユーザー ${user.userId} への1回目リマインド送信に失敗しました:`, error.message);
        }
    }
    // フェーズ3: 1回目リマインドメッセージ送信後5時間以内に応答がないユーザーの緊急連絡先に通知
    const usersForEmergencyContact = await usersCollection.find({
        wantsWatchCheck: true,
        userId: { $nin: BOT_ADMIN_IDS },
        firstReminderSent: true,
        secondReminderSent: { $ne: true }, // 2回目リマインダー（緊急連絡通知）未送信
        lastOkResponse: { $lt: fiveHoursAgo }, // 直近のOK応答が5時間以上前
        firstReminderTimestamp: { $lt: fiveHoursAgo }, // 1回目リマインダー送信が5時間以上前
        emergencyContact: { $ne: null } // 緊急連絡先が登録されているユーザーのみ
    }).toArray();

    console.log(`🚨 緊急連絡先通知対象ユーザー: ${usersForEmergencyContact.length}名`);

    for (const user of usersForEmergencyContact) {
        try {
            const userDisplayName = await getUserDisplayName(user.userId);
            // 24時間(定期見守り送信) + 5時間(1回目リマインド) = 29時間応答なし
            const emergencyMessage = `⚠️ 緊急！ ${userDisplayName}さん（LINE ID: ${user.userId}）が、こころちゃん見守りサービスに29時間応答していません。登録された緊急連絡先 ${user.emergencyContact} へ連絡してください。`;

            // 理事長（OWNER_USER_ID）にプッシュ通知
            if (OWNER_USER_ID) {
                await client.pushMessage(OWNER_USER_ID, { type: 'text', text: emergencyMessage });
                console.log(`🚨 理事長へ緊急通知を送信しました（ユーザー: ${user.userId}）`);
            }

            // オフィサーグループ（OFFICER_GROUP_ID）にプッシュ通知
            if (OFFICER_GROUP_ID) {
                await client.pushMessage(OFFICER_GROUP_ID, { type: 'text', text: emergencyMessage });
                console.pushMessage(`🚨 オフィサーグループへ緊急通知を送信しました（ユーザー: ${user.userId}）`);
            }

            await usersCollection.updateOne(
                { userId: user.userId },
                { $set: { secondReminderSent: true, secondReminderTimestamp: now } }
            );
            await messagesCollection.insertOne({
                userId: user.userId,
                message: '(定期見守りメッセージ - 緊急連絡先通知)',
                replyText: emergencyMessage,
                respondedBy: 'こころちゃん（定期見守り）',
                timestamp: now,
                logType: 'scheduled_watch_message_emergency_notification'
            });
        } catch (error) {
            console.error(`❌ ユーザー ${user.userId} の緊急連絡先通知に失敗しました:`, error.message);
        }
    }
}

// 毎日午後3時に定期見守りメッセージを送信
cron.schedule('0 15 * * *', async () => {
    console.log('⏰ 定期見守りメッセージ送信処理を実行します...');
    await sendScheduledWatchMessage();
}, {
    timezone: "Asia/Tokyo" // 日本時間で実行
});
console.log("✅ 定期ジョブがスケジュールされました。");


const watchServiceNoticeConfirmedFlex = (emergencyContact) => ({
    type: 'flex',
    altText: '見守りサービス登録完了！🌸',
    contents: {
        type: 'bubble',
        body: {
            type: 'box',
            layout: 'vertical',
            contents: [
                { type: 'text', text: '💖 見守りサービス登録完了！💖', weight: 'bold', size: 'lg', color: '#FF69B4' },
                { type: 'text', text: 'ありがとう🌸これで安心して見守りできるね！', wrap: true, size: 'sm', margin: 'md' },
                { type: 'text', text: `緊急連絡先: ${emergencyContact}`, wrap: true, size: 'sm', margin: 'md', color: '#555555' }
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
                        label: '見守りを解除する',
                        data: 'action=watch_unregister'
                    },
                    style: 'secondary',
                    color: '#ADD8E6'
                }
            ]
        }
    }
});


// --- LINE Webhook イベントハンドリング ---
app.post('/webhook', async (req, res) => {
    const db = await connectToMongoDB();
    if (!db) {
        console.error("MongoDBに接続できませんでした。");
        return res.status(500).send("DB connection error");
    }

    const usersCollection = db.collection("users");
    const messagesCollection = db.collection("messages");

    Promise
        .all(req.body.events.map(async (event) => {
            const userId = event.source.userId;
            let user = await usersCollection.findOne({ userId: userId });

            // ユーザーが存在しない場合の初期登録を、より確実に行う
            if (!user) {
                // profile取得を待ってからuserを初期化。エラー時もデフォルトを設定
                const profile = await client.getProfile(userId).catch(e => {
                    console.warn(`ユーザー ${userId} のプロフィール取得に失敗: ${e.message}`);
                    return { displayName: "Unknown User" }; // 失敗時もデフォルトを設定
                });
                user = {
                    userId: userId,
                    name: profile.displayName || "Unknown User",
                    wantsWatchCheck: false,
                    emergencyContact: null,
                    lastOkResponse: null,
                    registrationStep: null,
                    createdAt: new Date(),
                    membershipType: "guest", // ★ここで必ず"guest"を設定
                    monthlyMessageCount: 0,
                    lastMessageResetDate: new Date()
                };
                await usersCollection.insertOne(user);
                console.log(`新規ユーザーを登録しました: ${user.name} (${user.userId})`);

                // 初回挨拶はWebhookからの最初のメッセージの場合のみ
                if (event.type === 'message' && event.message.type === 'text') {
                    await client.replyMessage(event.replyToken, {
                        type: 'text',
                        text: `こんにちは💖こころちゃんだよ！\n私とLINEで繋がってくれてありがとう🌸\n\n困ったことや誰かに聞いてほしいことがあったら、いつでも話しかけてね😊\n\nまずは体験で${MEMBERSHIP_CONFIG.guest.monthlyLimit}回までお話できるよ！もし気に入ってくれたら、無料会員登録もできるからね💖\n\n『見守り』と送ると、定期的にわたしから「元気かな？」ってメッセージを送る見守りサービスも利用できるよ💖`
                    });
                    // 初回メッセージログの保存
                    await messagesCollection.insertOne({
                        userId: userId,
                        message: event.message.text,
                        replyText: `こんにちは💖こころちゃんだよ！...`,
                        respondedBy: 'こころちゃん（初回挨拶）',
                        timestamp: new Date(),
                        logType: 'first_greeting'
                    });
                    return; // 初回挨拶で処理を終了し、以降のAI応答処理へ進まない
                }
                return; // 初回かつメッセージでない場合は終了
            }
            // ★重要: userオブジェクトが更新されていることを保証するため、ここで再取得
            // これにより、初回登録直後のメッセージでも最新のuserオブジェクトが使われます
            user = await usersCollection.findOne({ userId: userId });
            if (!user) { // 万が一再取得で失敗した場合もガード
                 console.error(`クリティカルエラー: ユーザー ${userId} が取得できませんでした。`);
                 return; // このイベントの処理を中断
            }

            // --- 月間メッセージカウントのリセットとインクリメント ---
            const now = new Date();
            const currentMonth = now.getMonth();
            const lastResetMonth = user.lastMessageResetDate ? user.lastMessageResetDate.getMonth() : -1;

            if (currentMonth !== lastResetMonth) {
                // 月が変わったらカウントをリセット
                await usersCollection.updateOne(
                    { userId: userId },
                    { $set: { monthlyMessageCount: 0, lastMessageResetDate: now } }
                );
                user.monthlyMessageCount = 0; // メモリ上のuserオブジェクトも更新
                user.lastMessageResetDate = now;
                console.log(`ユーザー ${userId} の月間メッセージカウントをリセットしました。`);
            }

            // テキストメッセージ以外は無視
            if (event.type !== 'message' || event.message.type !== 'text') {
                return;
            }

            const userMessage = event.message.text;
            const replyToken = event.replyToken;

            // 管理者からの特定コマンド処理
            if (isBotAdmin(userId)) {
                if (userMessage === "会員タイプ一覧") {
                    let replyText = "✨ 会員タイプ一覧 ✨\n\n";
                    for (const type in MEMBERSHIP_CONFIG) {
                        const config = MEMBERSHIP_CONFIG[type];
                        replyText += `**${config.displayName} (${type})**\n`;
                        replyText += `  モデル: ${config.model}\n`;
                        replyText += `  月間制限: ${config.monthlyLimit === -1 ? "なし" : `${config.monthlyLimit}回`}\n`;
                        replyText += `  見守り: ${config.canUseWatchService ? "利用可" : "利用不可"}\n`;
                        replyText += `  子供向けAI: ${config.isChildAI ? "はい" : "いいえ"}\n`;
                        replyText += `  フォールバック: ${config.fallbackModel}\n\n`;
                    }
                    await client.replyMessage(replyToken, { type: 'text', text: replyText });
                    return;
                } else if (userMessage.startsWith("会員設定 ")) {
                    const parts = userMessage.split(' ');
                    if (parts.length === 3) {
                        const targetUserId = parts[1];
                        const newMembershipType = parts[2].toLowerCase();

                        if (MEMBERSHIP_CONFIG[newMembershipType]) {
                            const targetUser = await usersCollection.findOne({ userId: targetUserId });
                            if (targetUser) {
                                await usersCollection.updateOne(
                                    { userId: targetUserId },
                                    { $set: { membershipType: newMembershipType } }
                                );
                                await client.replyMessage(replyToken, { type: 'text', text: `ユーザー ${targetUserId} の会員タイプを ${MEMBERSHIP_CONFIG[newMembershipType].displayName} に設定しました。` });
                                console.log(`管理者 ${userId} がユーザー ${targetUserId} の会員タイプを ${newMembershipType} に変更しました。`);

                                // 対象ユーザーにも通知 (任意)
                                try {
                                    await client.pushMessage(targetUserId, { type: 'text', text: `✨あなたの会員タイプが「${MEMBERSHIP_CONFIG[newMembershipType].displayName}」に変更されました！\n\nこれで${MEMBERSHIP_CONFIG[newMembershipType].displayName}のサービスが使えるようになるよ😊\n\n月間メッセージ回数：${MEMBERSHIP_CONFIG[newMembershipType].monthlyLimit === -1 ? "制限なし" : `${MEMBERSHIP_CONFIG[newMembershipType].monthlyLimit}回まで`} \n見守りサービス：${MEMBERSHIP_CONFIG[newMembershipType].canUseWatchService ? "利用可" : "利用不可"}` });
                                } catch (pushError) {
                                    console.warn(`対象ユーザー ${targetUserId} への会員タイプ変更通知に失敗:`, pushError.message);
                                }

                            } else {
                                await client.replyMessage(replyToken, { type: 'text', text: `ユーザー ${targetUserId} が見つかりませんでした。` });
                            }
                        } else {
                            await client.replyMessage(replyToken, { type: 'text', text: `無効な会員タイプです。有効なタイプ: ${Object.keys(MEMBERSHIP_CONFIG).join(', ')}` });
                        }
                    } else {
                        await client.replyMessage(replyToken, { type: 'text', text: "使用方法: 会員設定 [ユーザーID] [会員タイプ]" });
                    }
                    return;
                } else if (userMessage.startsWith("ログ確認 ")) {
                    const parts = userMessage.split(' ');
                    if (parts.length === 2) {
                        const targetUserId = parts[1];
                        const logs = await messagesCollection.find({ userId: targetUserId }).sort({ timestamp: -1 }).limit(10).toArray();
                        if (logs.length > 0) {
                            let logText = `✨ ${targetUserId} の最新10件のログ ✨\n\n`;
                            logs.forEach(log => {
                                logText += `日時: ${new Date(log.timestamp).toLocaleString('ja-JP')}\n`;
                                logText += `送信: ${log.message}\n`;
                                logText += `応答: ${log.replyText}\n`;
                                logText += `種別: ${log.logType || '通常'}\n`;
                                logText += `---\n`;
                            });
                            await client.replyMessage(replyToken, { type: 'text', text: logText });
                        } else {
                            await client.replyMessage(replyToken, { type: 'text', text: `ユーザー ${targetUserId} のログは見つかりませんでした。` });
                        }
                    } else {
                        await client.replyMessage(replyToken, { type: 'text', text: "使用方法: ログ確認 [ユーザーID]" });
                    }
                    return;
                } else if (userMessage === "永久停止一覧") {
                    const permanentStopUsers = await usersCollection.find({ monthlyMessageCount: -99 }).toArray();
                    if (permanentStopUsers.length > 0) {
                        let replyText = "⚠️ 永久停止中のユーザー一覧 ⚠️\n\n";
                        permanentStopUsers.forEach(u => {
                            replyText += `- ${u.name} (ID: ${u.userId})\n`;
                        });
                        await client.replyMessage(replyToken, { type: 'text', text: replyText });
                    } else {
                        await client.replyMessage(replyToken, { type: 'text', text: "永久停止中のユーザーはいません。" });
                    }
                    return;
                } else if (userMessage.startsWith("永久停止 ")) {
                    const targetUserId = userMessage.substring("永久停止 ".length);
                    const targetUser = await usersCollection.findOne({ userId: targetUserId });
                    if (targetUser) {
                        await usersCollection.updateOne(
                            { userId: targetUserId },
                            { $set: { monthlyMessageCount: -99 } } // -99で永久停止のフラグ
                        );
                        await client.replyMessage(replyToken, { type: 'text', text: `ユーザー ${targetUserId} を永久停止しました。` });
                        try {
                            await client.pushMessage(targetUserId, { type: 'text', text: "大変申し訳ありませんが、サービス利用規約に違反したため、あなたの利用は永久に停止されました。ご理解のほどよろしくお願いいたします。" });
                        } catch (pushError) {
                            console.warn(`ユーザー ${targetUserId} への永久停止通知に失敗:`, pushError.message);
                        }
                    } else {
                        await client.replyMessage(replyToken, { type: 'text', text: `ユーザー ${targetUserId} が見つかりませんでした。` });
                    }
                    return;
                } else if (userMessage.startsWith("永久停止解除 ")) {
                    const targetUserId = userMessage.substring("永久停止解除 ".length);
                    const targetUser = await usersCollection.findOne({ userId: targetUserId });
                    if (targetUser && targetUser.monthlyMessageCount === -99) {
                        await usersCollection.updateOne(
                            { userId: targetUserId },
                            { $set: { monthlyMessageCount: 0, lastMessageResetDate: new Date() } } // 月間カウントをリセットして解除
                        );
                        await client.replyMessage(replyToken, { type: 'text', text: `ユーザー ${targetUserId} の永久停止を解除しました。` });
                        try {
                            await client.pushMessage(targetUserId, { type: 'text', text: "あなたのサービス利用停止が解除されました。引き続きご利用いただけます🌸" });
                        } catch (pushError) {
                            console.warn(`ユーザー ${targetUserId} への永久停止解除通知に失敗:`, pushError.message);
                        }
                    } else if (targetUser && targetUser.monthlyMessageCount !== -99) {
                        await client.replyMessage(replyToken, { type: 'text', text: `ユーザー ${targetUserId} は永久停止されていません。` });
                    } else {
                        await client.replyMessage(replyToken, { type: 'text', text: `ユーザー ${targetUserId} が見つかりませんでした。` });
                    }
                    return;
                }
            }


            // --- コマンド処理 ---
            if (userMessage === "見守り") {
                if (!MEMBERSHIP_CONFIG[user.membershipType]?.canUseWatchService) {
                    await client.replyMessage(replyToken, { type: "text", text: "ごめんね、今の会員タイプでは見守りサービスは利用できないんだ🌸 寄付会員かサブスク会員になると使えるようになるよ！" });
                    return;
                }
                await client.replyMessage(replyToken, watchServiceGuideFlex);
                return;
            } else if (userMessage === "ヘルプ" || userMessage === "助けて" || userMessage === "相談" || userMessage === "困った") {
                await client.replyMessage(replyToken, emergencyFlex);
                return;
            } else if (userMessage === "会員登録" || userMessage === "無料会員") {
                // 無料会員への登録を促すFlex Message
                const freeMembershipFlex = {
                    type: 'flex',
                    altText: '無料会員登録のご案内🌸',
                    contents: {
                        type: 'bubble',
                        body: {
                            type: 'box',
                            layout: 'vertical',
                            contents: [
                                { type: 'text', text: '無料会員登録のご案内🌸', weight: 'bold', size: 'lg', color: '#FF69B4' },
                                { type: 'text', text: '無料会員に登録すると、毎月20回までこころちゃんとお話しできるよ😊', wrap: true, size: 'sm', margin: 'md' },
                                { type: 'text', text: 'それに、見守りサービスも利用できるようになるんだ💖', wrap: true, size: 'sm' }
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
                                        label: '無料会員に登録する',
                                        data: 'action=register_free_membership'
                                    },
                                    style: 'primary',
                                    color: '#FFB6C1'
                                }
                            ]
                        }
                    }
                };
                await client.replyMessage(replyToken, freeMembershipFlex);
                return;
            } else if (userMessage === "寄付会員" || userMessage === "サブスク会員") {
                // 有料会員への案内Flex Message
                const paidMembershipFlex = {
                    type: 'flex',
                    altText: '寄付会員・サブスク会員のご案内🌸',
                    contents: {
                        type: 'bubble',
                        body: {
                            type: 'box',
                            layout: 'vertical',
                            contents: [
                                { type: 'text', text: '寄付会員・サブスク会員のご案内🌸', weight: 'bold', size: 'lg', color: '#FF69B4' },
                                { type: 'text', text: 'こころちゃんの活動を応援してくれると嬉しいな💖', wrap: true, size: 'sm', margin: 'md' },
                                { type: 'text', text: '寄付会員やサブスク会員になると、もっとたくさんお話できるようになったり、Proモデル（高度な会話）が使えるようになるよ😊', wrap: true, size: 'sm' }
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
                                        type: 'uri',
                                        label: '詳しくはこちら',
                                        uri: 'https://connect-npo.org/support/' // NPOの寄付・サブスク案内のURL
                                    },
                                    style: 'primary',
                                    color: '#FFB6C1'
                                }
                            ]
                        }
                    }
                };
                await client.replyMessage(replyToken, paidMembershipFlex);
                return;
            }

            // 見守りサービス登録ステップの処理
            if (user.registrationStep === 'waiting_for_emergency_contact') {
                const phoneNumberRegex = /^(0\d{9,10})$/; // 0から始まり、合計10〜11桁の数字
                if (phoneNumberRegex.test(userMessage)) {
                    await usersCollection.updateOne(
                        { userId: userId },
                        { $set: { emergencyContact: userMessage, wantsWatchCheck: true, registrationStep: null, lastOkResponse: new Date(), scheduledMessageSent: false, firstReminderSent: false, secondReminderSent: false } }
                    );
                    await client.replyMessage(replyToken, watchServiceNoticeConfirmedFlex(userMessage));
                    await messagesCollection.insertOne({
                        userId: userId,
                        message: userMessage,
                        replyText: '見守りサービス登録完了！',
                        respondedBy: 'こころちゃん（見守り登録）',
                        timestamp: new Date(),
                    });
                } else {
                    await client.replyMessage(replyToken, { type: 'text', text: 'ごめんね、電話番号の形式が正しくないみたい💦 0から始まる半角数字で入力してね。' });
                }
                return;
            }

            // ポストバックイベント処理
            if (event.type === 'postback') {
                const data = new URLSearchParams(event.postback.data);
                const action = data.get('action');

                if (action === 'watch_register') {
                    if (!MEMBERSHIP_CONFIG[user.membershipType]?.canUseWatchService) {
                        await client.replyMessage(replyToken, { type: "text", text: "ごめんね、今の会員タイプでは見守りサービスは利用できないんだ🌸 寄付会員かサブスク会員になると使えるようになるよ！" });
                        return;
                    }
                    await usersCollection.updateOne(
                        { userId: userId },
                        { $set: { registrationStep: 'waiting_for_emergency_contact' } }
                    );
                    await client.replyMessage(replyToken, { type: 'text', text: watchServiceNotice });
                } else if (action === 'watch_unregister') {
                    await usersCollection.updateOne(
                        { userId: userId },
                        { $set: { wantsWatchCheck: false, emergencyContact: null, registrationStep: null, scheduledMessageSent: false, firstReminderSent: false, secondReminderSent: false } }
                    );
                    await client.replyMessage(replyToken, { type: 'text', text: '見守りサービスを解除したよ🌸いつでもまた声をかけてね！' });
                    await messagesCollection.insertOne({
                        userId: userId,
                        message: '(見守りサービス解除)',
                        replyText: '見守りサービスを解除したよ🌸',
                        respondedBy: 'こころちゃん（見守り解除）',
                        timestamp: new Date(),
                    });
                } else if (action === 'register_free_membership') {
                    // 無料会員登録処理
                    if (user.membershipType === "free") {
                        await client.replyMessage(replyToken, { type: "text", text: "もう無料会員に登録済みだよ🌸 いつもありがとうね！" });
                    } else if (MEMBERSHIP_CONFIG[user.membershipType]?.monthlyLimit === -1) {
                        await client.replyMessage(replyToken, { type: "text", text: `あなたはすでに${MEMBERSHIP_CONFIG[user.membershipType].displayName}なので、無料会員になる必要はないよ🌸` });
                    }
                    else {
                        await usersCollection.updateOne(
                            { userId: userId },
                            { $set: { membershipType: "free", monthlyMessageCount: 0, lastMessageResetDate: new Date() } }
                        );
                        await client.replyMessage(replyToken, { type: "text", text: `無料会員登録が完了したよ🌸 これで毎月${MEMBERSHIP_CONFIG.free.monthlyLimit}回までお話しできるね！これからもよろしくね💖` });
                        await messagesCollection.insertOne({
                            userId: userId,
                            message: '(無料会員登録)',
                            replyText: '無料会員登録が完了したよ🌸',
                            respondedBy: 'こころちゃん（会員登録）',
                            timestamp: new Date(),
                        });
                    }
                }
                return; // ポストバックイベント処理後はここで終了
            }

            // 月間メッセージ制限チェック (管理者と永久停止ユーザーは除外)
            if (!isBotAdmin(userId) && user.monthlyMessageCount !== -99) {
                const currentConfig = MEMBERSHIP_CONFIG[user.membershipType];
                if (currentConfig && currentConfig.monthlyLimit !== -1 && user.monthlyMessageCount >= currentConfig.monthlyLimit) {
                    await client.replyMessage(replyToken, {
                        type: 'text',
                        text: `ごめんね💦 今月のメッセージ回数上限（${currentConfig.monthlyLimit}回）に達しちゃったみたい🌸\n\nもしもっとお話ししたいなと思ったら、寄付会員やサブスク会員になると、もっとたくさんお話しできるようになるよ😊\n\n『会員登録』と送ってくれたら、詳細を案内するね！`
                    });
                    return;
                }
            } else if (user.monthlyMessageCount === -99) {
                // 永久停止中のユーザー
                await client.replyMessage(replyToken, {
                    type: 'text',
                    text: "大変申し訳ありませんが、サービス利用規約に違反したため、あなたの利用は永久に停止されました。ご理解のほどよろしくお願いいたします。"
                });
                // ログは記録するが、カウントは増やさない
                await messagesCollection.insertOne({
                    userId: userId,
                    message: userMessage,
                    replyText: "サービス利用停止中の応答",
                    respondedBy: 'こころちゃん（停止中）',
                    timestamp: now,
                    logType: 'service_stopped'
                });
                return;
            }

            // --- AI応答処理 ---
            let replyText;
            let logType = 'normal_chat';

            const specialReply = checkSpecialReply(userMessage);
            if (specialReply) {
                replyText = specialReply;
                logType = 'special_reply';
            } else if (isOrganizationInquiry(userMessage)) {
                // NPO法人コネクトに関する問い合わせ
                replyText = `うん、わたしが所属しているNPO法人コネクトについてだね🌸　この団体は、こどもやお年寄り、いろんな人が安心して相談できる場所を目指しているんだよ😊　もっと知りたい？ホームページもあるから見てみてね → https://connect-npo.org`;
                logType = 'organization_inquiry';
            } else if (containsDangerWords(userMessage)) {
                // 危険ワードが含まれる場合
                replyText = `🌸大丈夫かな？ひとりで悩まないで、もしよかったら詳しく話してみてくれる？\n\nとっても辛い時は、ここに相談できるところがあるよ。\n${emergencyFlex.altText}\n\nそして、わたしはいつでもあなたのそばにいるからね💖`;
                // 管理者にプッシュ通知
                if (OWNER_USER_ID) {
                    await client.pushMessage(OWNER_USER_ID, { type: 'text', text: `🚨 危険ワードを検出しました！ユーザー ${await getUserDisplayName(userId)} (${userId}) からのメッセージ: "${userMessage}"` });
                }
                if (OFFICER_GROUP_ID) {
                    await client.pushMessage(OFFICER_GROUP_ID, { type: 'text', text: `🚨 危険ワードを検出しました！ユーザー ${await getUserDisplayName(userId)} (${userId}) からのメッセージ: "${userMessage}"` });
                }
                logType = 'danger_word_detected';
            } else if (containsScamWords(userMessage)) {
                // 詐欺ワードが含まれる場合
                replyText = `🌸それはちょっと心配な内容だね💦 詐欺の可能性があるかもしれないから、気をつけてね。\n\n困った時は、警察や消費生活センターに相談できるよ。\n${scamFlex.altText}\n\nもし心配なことがあったら、またこころに話してね💖`;
                // 管理者にプッシュ通知
                if (OWNER_USER_ID) {
                    await client.pushMessage(OWNER_USER_ID, { type: 'text', text: `🚨 詐欺ワードを検出しました！ユーザー ${await getUserDisplayName(userId)} (${userId}) からのメッセージ: "${userMessage}"` });
                }
                if (OFFICER_GROUP_ID) {
                    await client.pushMessage(OFFICER_GROUP_ID, { type: 'text', text: `🚨 詐欺ワードを検出しました！ユーザー ${await getUserDisplayName(userId)} (${userId}) からのメッセージ: "${userMessage}"` });
                }
                logType = 'scam_word_detected';
            } else {
                // 通常のAI応答
                replyText = await generateReply(userMessage, user);
                // AI応答の場合のみカウントを増やす
                if (!isBotAdmin(userId)) { // 管理者以外のメッセージのみカウント
                    await usersCollection.updateOne(
                        { userId: userId },
                        { $inc: { monthlyMessageCount: 1 } }
                    );
                }
            }

            // OK応答の場合のlastOkResponse更新
            if (userMessage.includes("OKだよ💖")) {
                await usersCollection.updateOne(
                    { userId: userId },
                    { $set: { lastOkResponse: now, scheduledMessageSent: false, firstReminderSent: false, secondReminderSent: false } }
                );
                logType = 'ok_response';
            }


            // 応答メッセージを送信
            await client.replyMessage(replyToken, { type: 'text', text: replyText });

            // メッセージログを保存
            await messagesCollection.insertOne({
                userId: userId,
                message: userMessage,
                replyText: replyText,
                respondedBy: 'こころちゃん',
                timestamp: now,
                logType: logType // ログタイプを記録
            });

        })
        )
        .then(() => res.status(200).send("OK"))
        .catch((err) => {
            console.error("個別のイベント処理中にエラーが発生しました:", err);
            res.status(500).end();
        });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
    console.log(`Server running on port ${PORT}`);
    await connectToMongoDB();
});
