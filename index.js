require('dotenv').config(); // .env ファイルから環境変数を読み込む

const express = require('express');
const { Client } = require('@line/bot-sdk');
const { MongoClient } = require('mongodb');
const cron = require('node-cron');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs/promises'); // fs.promises を使用して非同期ファイル読み込み

// 環境変数から設定を読み込む
const CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;
const MONGODB_URI = process.env.MONGODB_URI;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const OWNER_USER_ID = process.env.OWNER_USER_ID; // 理事長ID
const OFFICER_GROUP_ID = process.env.OFFICER_GROUP_ID; // オフィサーグループID
const BOT_ADMIN_IDS = process.env.BOT_ADMIN_IDS ? JSON.parse(process.env.BOT_ADMIN_IDS) : []; // 管理者IDのリスト
const EMERGENCY_CONTACT_PHONE_NUMBER = process.env.EMERGENCY_CONTACT_PHONE_NUMBER || '09048393313'; // 理事長の電話番号

const app = express();
app.use(express.json());

const client = new Client({
    channelAccessToken: CHANNEL_ACCESS_TOKEN,
    channelSecret: CHANNEL_SECRET,
});

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

let dbInstance;

// ワードリストとFlex Messageテンプレートを保持する変数
let dangerWords = [];
let scamWords = [];
let inappropriateWords = [];
let specialReplies = [];
let emergencyFlexTemplate = {};
let scamFlexTemplate = {};
let watchServiceGuideFlexTemplate = {};
let modelConfig = {}; // モデル設定も外部化

// ファイルから設定を読み込む関数
async function loadConfig() {
    try {
        dangerWords = JSON.parse(await fs.readFile('./kokoro-config/danger_words.json', 'utf8'));
        scamWords = JSON.parse(await fs.readFile('./kokoro-config/scam_words.json', 'utf8'));
        inappropriateWords = JSON.parse(await fs.readFile('./kokoro-config/inappropriate_words.json', 'utf8'));
        specialReplies = JSON.parse(await fs.readFile('./kokoro-config/special_replies.json', 'utf8')); // 新規追加
        modelConfig = JSON.parse(await fs.readFile('./kokoro-config/model_config.json', 'utf8'));

        // Flex Messageテンプレートの読み込みと電話番号の置き換え
        emergencyFlexTemplate = JSON.parse(await fs.readFile('./kokoro-config/reply_templates/emergency_flex.json', 'utf8'));
        emergencyFlexTemplate.contents.footer.contents[6].action.uri = `tel:${EMERGENCY_CONTACT_PHONE_NUMBER}`; // 理事長に電話

        scamFlexTemplate = JSON.parse(await fs.readFile('./kokoro-config/reply_templates/scam_flex.json', 'utf8'));
        scamFlexTemplate.contents.footer.contents[3].action.uri = `tel:${EMERGENCY_CONTACT_PHONE_NUMBER}`; // 理事長に電話

        watchServiceGuideFlexTemplate = JSON.parse(await fs.readFile('./kokoro-config/reply_templates/watch_service_guide_flex.json', 'utf8'));

        console.log("✅ 設定ファイルを読み込みました。");
    } catch (error) {
        console.error("❌ 設定ファイルの読み込みに失敗しました:", error);
        process.exit(1); // 起動失敗として終了
    }
}

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

// ワードチェック関数 (外部化したリストを使用)
function checkContainsDangerWords(message) {
    const lowerMessage = message.toLowerCase();
    return dangerWords.some(word => lowerMessage.includes(word));
}

function checkContainsScamWords(message) {
    const lowerMessage = message.toLowerCase();
    return scamWords.some(word => lowerMessage.includes(word));
}

function checkContainsInappropriateWords(message) {
    const lowerMessage = message.toLowerCase();
    return inappropriateWords.some(word => lowerMessage.includes(word));
}

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

// SpecialReplyのチェック関数 (外部化したリストを使用)
function checkSpecialReply(text) {
    const lowerText = text.toLowerCase();
    for (const reply of specialReplies) {
        if (reply.type === "regex") {
            const regex = new RegExp(reply.key, "i"); // "i"で大文字小文字を区別しない
            if (regex.test(lowerText)) {
                return reply.value;
            }
        } else if (reply.type === "includes") {
            if (lowerText.includes(reply.key.toLowerCase())) {
                return reply.value;
            }
        }
    }
    return null;
}

// 組織問い合わせの判定と返答を生成するダミー関数 (AIに聞くフローは残す)
const isOrganizationInquiry = (text) => {
    const lower = text.toLowerCase();
    return (lower.includes("コネクト") || lower.includes("connect")) && (lower.includes("団体") || lower.includes("npo") || lower.includes("活動") || lower.includes("どんな"));
};

const homeworkTriggers = ["宿題", "勉強", "問題", "テスト", "方程式", "算数", "数学", "答え", "解き方", "教えて", "計算", "証明", "公式", "入試", "受験"];
function containsHomeworkTrigger(text) {
    const lowerText = text.toLowerCase();
    return homeworkTriggers.some(word => lowerText.includes(word));
}


// --- Gemini APIによる応答生成関数 ---
async function generateReply(userMessage) {
    const modelName = modelConfig.defaultModel;
    const safetySettings = modelConfig.safetySettings;
    const systemInstruction = modelConfig.systemInstruction;

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
    "ねぇねぇ、こころだよ🌸 今日はどんな一日だった？",
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
        await client.replyMessage(event.replyToken, watchServiceGuideFlexTemplate); // 外部化したテンプレートを使用
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
                { $set: { lastOkResponse: new Date(), scheduledMessageSent: false, firstReminderSent: false, secondReminderSent: false, thirdReminderSent: false } } // thirdReminderSentもリセット
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
            respondedBy: 'こころちゃん（見守り登録完了）',
            timestamp: new Date(),
            logType: 'watch_service_registration_complete'
        });
        return true;
    }

    if (userMessage.includes("見守り解除します") || (event.type === 'postback' && event.postback.data === 'action=watch_unregister')) {
        if (user && user.wantsWatchCheck) {
            await usersCollection.updateOne(
                { userId: userId },
                { $set: { wantsWatchCheck: false, emergencyContact: null, registrationStep: null, scheduledMessageSent: false, firstReminderSent: false, secondReminderSent: false, thirdReminderSent: false } }
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
                { $set: { scheduledMessageSent: true, scheduledMessageTimestamp: now, firstReminderSent: false, secondReminderSent: false, thirdReminderSent: false } }
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
        else if (user.secondReminderSent && !user.thirdReminderSent) { // thirdReminderSentを追加
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
                        { $set: { thirdReminderSent: true, thirdReminderTimestamp: now } } // 3回目の通知フラグをtrueに
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
                    respondedBy: 'こころちゃん（システムエラー）',
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


// ⭐ここから単一の/webhookエンドポイントに統合⭐
app.post('/webhook', async (req, res) => {
    // まずはLINEからのWebhookを受け取ったことを即座にLINEに伝える
    res.status(200).send('OK');

    const events = req.body.events;
    for (const event of events) {
        const userId = event.source.userId;
        if (!userId) {
            console.warn('⚠️ userIdが取得できませんでした。グループイベントなどの可能性があります。');
            continue;
        }

        const db = await connectToMongoDB();
        if (!db) {
            console.error('MongoDB接続失敗: Webhookイベントを処理できません。');
            // res.status(500).send('MongoDB connection failed'); // 既にOKを送っているのでここでは不要
            continue;
        }
        const usersCollection = db.collection("users");
        const messagesCollection = db.collection("messages");

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
                thirdReminderSent: false,
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
            await usersCollection.updateOne(
                { userId: userId },
                { $set: { lastMessageAt: new Date() } }
            );
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
            if (user.thirdReminderSent === undefined) {
                await usersCollection.updateOne({ userId: userId }, { $set: { thirdReminderSent: false } });
                user.thirdReminderSent = false;
            }
        }

        // --- Postbackイベント処理 ---
        if (event.type === 'postback' && event.postback.data) {
            console.log('✅ Postbackイベントを受信しました。');
            const data = new URLSearchParams(event.postback.data);
            const action = data.get('action');

            const handledByWatchService = await handleWatchServiceRegistration(event, usersCollection, messagesCollection, userId, `（Postback: ${action}）`);
            if (handledByWatchService) {
                continue;
            }
        }

        // --- メッセージイベント処理 ---
        if (event.type === 'message' && event.message.type === 'text') {
            const userMessage = event.message.text;
            console.log("ユーザーからのメッセージ:", userMessage);

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
                            // LINEへプッシュメッセージで結果を通知
                            await client.pushMessage(userId, { type: 'text', text: `✅ ユーザー ${targetUserId} のロックを解除し、カウントをリセットしました。` });
                            await client.pushMessage(targetUserId, { type: 'text', text: '🌸 あなたのアカウントの停止が解除されました。またいつでもお話しできますよ💖' });
                            console.log(`管理者 ${userId} によりユーザー ${targetUserId} のロックが解除されました。`);
                        } else {
                            await client.pushMessage(userId, { type: 'text', text: `❌ ユーザー ${targetUserId} は見つかりませんでした。` });
                        }
                    } catch (error) {
                        console.error(`❌ 管理者コマンドでのロック解除エラー: ${error.message}`);
                        await client.pushMessage(userId, { type: 'text', text: `❌ ロック解除中にエラーが発生しました: ${error.message}` });
                    }
                    await messagesCollection.insertOne({
                        userId: userId,
                        message: userMessage,
                        replyText: `（管理者コマンド: ${userMessage}）`,
                        respondedBy: 'こころちゃん（管理者コマンド処理）',
                        timestamp: new Date(),
                        logType: 'admin_command'
                    });
                    continue;
                }
            }

            // 「そうだん」コマンドの処理（リセットと相談モード設定）
            if (userMessage === 'そうだん' || userMessage === '相談') {
                if (user) {
                    await usersCollection.updateOne(
                        { userId: userId },
                        { $set: { flaggedMessageCount: 0, isAccountSuspended: false, suspensionReason: null, isPermanentlyLocked: false, lastPermanentLockNotifiedAt: null } }
                    );
                    await client.pushMessage(userId, { type: 'text', text: '🌸 会話の回数制限をリセットしました。これで、またいつでもお話しできますよ💖' });
                    await messagesCollection.insertOne({
                        userId: userId,
                        message: userMessage,
                        replyText: '（会話制限リセット＆相談モード開始）',
                        respondedBy: 'こころちゃん（システム）',
                        timestamp: new Date(),
                        logType: 'conversation_limit_reset_and_consultation_mode'
                    });
                } else {
                    await client.pushMessage(userId, { type: 'text', text: 'ごめんなさい、アカウント情報が見つかりませんでした。' });
                }
                continue;
            }

            // 見守りサービス関連の処理を優先
            const handledByWatchService = await handleWatchServiceRegistration(event, usersCollection, messagesCollection, userId, userMessage);
            if (handledByWatchService) {
                continue;
            }

            // 非同期応答のための処理開始
            // ここで即座にLINE APIにHTTP 200 OKを返し、AI応答はバックグラウンドで処理してプッシュする
            // res.status(200).send('OK'); // ここでは既に上で送っているため不要

            (async () => { // 即時実行関数で非同期処理を開始
                let replyMessageObject; // LineAPIで送るメッセージオブジェクト
                let respondedBy = 'こころちゃん（AI）';
                let logType = 'normal';

                // 優先順位: 不適切ワード > 危険ワード > 詐欺ワード > 固定応答 > AI応答
                if (checkContainsInappropriateWords(userMessage)) {
                    replyMessageObject = { type: 'text', text: "わたしを作った人に『プライベートなことや不適切な話題には答えちゃだめだよ』って言われているんだ🌸ごめんね、他のお話をしようね💖" };
                    respondedBy = 'こころちゃん（不適切ワード）';
                    logType = 'inappropriate_word';
                } else if (checkContainsDangerWords(userMessage)) {
                    replyMessageObject = emergencyFlexTemplate;
                    respondedBy = 'こころちゃん（危険ワード）';
                    logType = 'danger_word';
                } else if (checkContainsScamWords(userMessage)) {
                    replyMessageObject = scamFlexTemplate;
                    respondedBy = 'こころちゃん（詐欺ワード）';
                    logType = 'scam_word';
                } else {
                    const specialReply = checkSpecialReply(userMessage);
                    if (specialReply) {
                        replyMessageObject = { type: 'text', text: specialReply };
                        respondedBy = 'こころちゃん（固定応答）';
                    } else if (isOrganizationInquiry(userMessage) || containsHomeworkTrigger(userMessage)) {
                        const aiResponse = await generateReply(userMessage);
                        replyMessageObject = { type: 'text', text: aiResponse };
                        respondedBy = 'こころちゃん（AI）';
                        logType = 'ai_generated';
                    } else {
                        const aiResponse = await generateReply(userMessage);
                        replyMessageObject = { type: 'text', text: aiResponse };
                        respondedBy = 'こころちゃん（AI）';
                        logType = 'ai_generated';
                    }
                }

                try {
                    // LINEへプッシュメッセージで応答
                    await client.pushMessage(userId, replyMessageObject);
                    console.log(`✅ ユーザー ${userId} へプッシュメッセージを送信しました。`);

                    const isResetCommand = (userMessage === 'そうだん' || userMessage === '相談');
                    const isAdminCommand = userMessage.startsWith('/unlock');
                    const isFlaggedMessage = (logType === 'inappropriate_word' || logType === 'danger_word' || logType === 'scam_word');

                    if (shouldLogMessage(userMessage, isFlaggedMessage, handledByWatchService, isAdminCommand, isResetCommand)) {
                        await messagesCollection.insertOne({
                            userId: userId,
                            message: userMessage,
                            replyText: (replyMessageObject && typeof replyMessageObject === 'string') ? replyMessageObject : JSON.stringify(replyMessageObject),
                            respondedBy: respondedBy,
                            timestamp: new Date(),
                            logType: logType
                        });
                    } else {
                        console.log(`ユーザー ${userId} からのメッセージはDBにログされませんでした: ${userMessage.substring(0, 50)}...`);
                    }

                } catch (error) {
                    console.error("❌ プッシュメッセージ送信中またはログ記録中にエラーが発生しました:", error.message);
                    if (error.message.includes("status code 400") || error.message.includes("status code 499")) {
                        console.log(`LINE APIエラーのため、ユーザー ${userId} へのプッシュメッセージが送信できませんでした。`);
                    }
                }
            })(); // 非同期処理の終わり
        }
    }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, async () => {
    console.log(`🚀 サーバーがポート ${PORT} で起動しました`);
    await loadConfig(); // アプリケーション起動時に設定ファイルを読み込む
    await connectToMongoDB(); // アプリケーション起動時にMongoDBに接続
});
