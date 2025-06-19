// モジュールと環境変数の読み込み
const line = require('@line/bot-sdk');
const express = require('express');
const mongoose = require('mongoose');
const schedule = require('node-schedule');
require('dotenv').config();

// LINEボットSDKの設定
const config = {
    // Renderの環境変数名に合わせて変更済み
    channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
    channelSecret: process.env.LINE_CHANNEL_SECRET,
};

const client = new line.Client(config);

// Expressアプリケーションの初期化
const app = express();
const PORT = process.env.PORT || 3000; // Renderの環境変数PORTを使用

// MongoDBへの接続
mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log('MongoDB に正常に接続されました。'))
    .catch(err => console.error('MongoDB 接続エラー:', err));

// MongoDBスキーマとモデル
const messageSchema = new mongoose.Schema({
    userId: String,
    message: String,
    replyText: String,
    responsedBy: String, // 'こころちゃん', '定期見守り', 'リマインダー', 'オペレーター'
    timestamp: { type: Date, default: Date.now },
});
const Message = mongoose.model('Message', messageSchema);

const userStatusSchema = new mongoose.Schema({
    userId: String,
    status: { type: String, default: 'initial' }, // 'initial', 'watch_active', 'watch_pending_reply'
    lastWatchMessageSent: { type: Date, default: null }, // 最後の見守りメッセージ送信日時
    lastUserReply: { type: Date, default: null }, // 最後のユーザーからの返信日時
    watchMessageCount: { type: Number, default: 0 }, // 見守りメッセージ送信回数
    lastReminderSent: { type: Date, default: null }, // 最後にリマインダーを送った日時
    lastEmergencyEscalated: { type: Date, default: null }, // 最後に緊急エスカレーションした日時
    history: [{ // ユーザーの状態変化を記録
        timestamp: { type: Date, default: Date.now },
        oldStatus: String,
        newStatus: String,
        event: String, // 'message', 'cron_watch', 'cron_reminder', 'operator_manual'
    }],
});
const UserStatus = mongoose.model('UserStatus', userStatusSchema);

// Flex Message 定義
// 緊急連絡先 Flex Message (emergencyFlex)
const emergencyFlex = {
    type: "flex",
    altText: "緊急時はこちらに連絡してね", // 40文字以内であることを確認
    contents: {
        type: "bubble",
        header: {
            type: "box",
            layout: "vertical",
            contents: [
                {
                    type: "text",
                    text: "🆘 緊急連絡先 🆘",
                    weight: "bold",
                    size: "xl",
                    color: "#FF69B4",
                    align: "center",
                    wrap: true // ★追加
                }
            ]
        },
        hero: {
            type: "image",
            url: "https://example.com/emergency_image.png", // ★ダミーURL。適切な画像URLに差し替える
            size: "full",
            aspectRatio: "20:13",
            aspectMode: "cover",
            action: {
                type: "uri",
                label: "詳細を見る", // ★ラベルを追加
                uri: "https://example.com" // ★ダミーURL
            },
            backgroundColor: "#FFEBEE"
        },
        body: {
            type: "box",
            layout: "vertical",
            contents: [
                {
                    type: "text",
                    text: "困った時は、一人で抱え込まずに、信頼できる大人や専門機関に相談してください。",
                    wrap: true, // ★追加
                    margin: "md",
                    size: "md"
                },
                {
                    type: "separator",
                    margin: "lg"
                },
                {
                    type: "box",
                    layout: "vertical",
                    spacing: "sm",
                    margin: "lg",
                    contents: [
                        {
                            type: "button",
                            style: "link",
                            height: "sm",
                            action: {
                                type: "uri",
                                label: "警察相談専用電話 (#9110)",
                                uri: "tel:9110"
                            }
                        },
                        {
                            type: "button",
                            style: "link",
                            height: "sm",
                            action: {
                                type: "uri",
                                label: "こども110番 (地域)",
                                uri: "https://www.npa.go.jp/bureau/safetylife/k_110/index.html" // 各地域の情報を確認
                            }
                        },
                        {
                            type: "button",
                            style: "link",
                            height: "sm",
                            action: {
                                type: "uri",
                                label: "こどもまもるくん (LINE)",
                                uri: "https://line.me/R/ti/p/%40487mueqj"
                            }
                        },
                        {
                            type: "button",
                            style: "link",
                            height: "sm",
                            action: {
                                type: "uri",
                                label: "チャイルドライン (18歳まで)",
                                uri: "tel:0120997777"
                            }
                        },
                        {
                            type: "button",
                            style: "link",
                            height: "sm",
                            action: {
                                type: "uri",
                                label: "24時間子供SOSダイヤル",
                                uri: "tel:0120078310"
                            }
                        },
                        {
                            type: "button",
                            style: "link",
                            height: "sm",
                            action: {
                                type: "uri",
                                label: "いのちの電話",
                                uri: "tel:0570064556"
                            }
                        }
                    ]
                }
            ]
        },
        footer: {
            type: "box",
            layout: "vertical",
            spacing: "sm",
            contents: [
                {
                    type: "text",
                    text: "一人で悩まず、助けを求めてくださいね。",
                    size: "sm",
                    align: "center",
                    color: "#888888",
                    wrap: true // ★追加
                }
            ]
        }
    }
};

// 詐欺対策 Flex Message (scamFlex)
const scamFlex = {
    type: "flex",
    altText: "詐欺かも？と思ったら相談してね", // 40文字以内であることを確認
    contents: {
        type: "bubble",
        header: {
            type: "box",
            layout: "vertical",
            contents: [
                {
                    type: "text",
                    text: "🚨 詐欺かも？ 🚨",
                    weight: "bold",
                    size: "xl",
                    color: "#FFA07A",
                    align: "center",
                    wrap: true // ★追加
                }
            ]
        },
        hero: {
            type: "image",
            url: "https://example.com/scam_image.png", // ★ダミーURL。適切な画像URLに差し替える
            size: "full",
            aspectRatio: "20:13",
            aspectMode: "cover",
            action: {
                type: "uri",
                label: "詳細を見る", // ★ラベルを追加
                uri: "https://example.com" // ★ダミーURL
            },
            backgroundColor: "#FFF0F5"
        },
        body: {
            type: "box",
            layout: "vertical",
            contents: [
                {
                    type: "text",
                    text: "「おかしいな」と感じたら、それは詐欺かもしれません！\nすぐに誰かに相談しましょう。",
                    wrap: true, // ★追加
                    margin: "md",
                    size: "md"
                },
                {
                    type: "separator",
                    margin: "lg"
                },
                {
                    type: "box",
                    layout: "vertical",
                    spacing: "sm",
                    margin: "lg",
                    contents: [
                        {
                            type: "button",
                            style: "link",
                            height: "sm",
                            action: {
                                type: "uri",
                                label: "警察相談専用電話 (#9110)",
                                uri: "tel:9110"
                            }
                        },
                        {
                            type: "button",
                            style: "link",
                            height: "sm",
                            action: {
                                type: "uri",
                                label: "消費者ホットライン (188)",
                                uri: "tel:188"
                            }
                        },
                        {
                            type: "button",
                            style: "link",
                            height: "sm",
                            action: {
                                type: "uri",
                                label: "国民生活センター",
                                uri: "https://www.kokusen.go.jp/"
                            }
                        }
                    ]
                }
            ]
        },
        footer: {
            type: "box",
            layout: "vertical",
            spacing: "sm",
            contents: [
                {
                    type: "text",
                    text: "大切なあなたを守るために、少しでも不安を感じたら行動してください。",
                    size: "sm",
                    align: "center",
                    color: "#888888",
                    wrap: true // ★追加
                }
            ]
        }
    }
};

// 見守りサービス説明 Flex Message (watchServiceGuideFlex)
const watchServiceGuideFlex = {
    type: "flex",
    altText: "見守りサービスについて", // 40文字以内であることを確認
    contents: {
        type: "bubble",
        header: {
            type: "box",
            layout: "vertical",
            contents: [
                {
                    type: "text",
                    text: "🏠 見守りサービス 🏠",
                    weight: "bold",
                    size: "xl",
                    color: "#6A5ACD",
                    align: "center",
                    wrap: true // ★追加
                }
            ]
        },
        hero: {
            type: "image",
            url: "https://example.com/watch_service_image.png", // ★ダミーURL。適切な画像URLに差し替える
            size: "full",
            aspectRatio: "20:13",
            aspectMode: "cover",
            action: {
                type: "uri",
                label: "詳細を見る", // ★ラベルを追加
                uri: "https://example.com" // ★ダミーURL
            },
            backgroundColor: "#E6E6FA"
        },
        body: {
            type: "box",
            layout: "vertical",
            contents: [
                {
                    type: "text",
                    text: "こころちゃんの見守りサービスは、定期的にあなたにメッセージを送ることで、あなたの安否確認を行うサービスです。",
                    wrap: true, // ★追加
                    margin: "md",
                    size: "md"
                },
                {
                    type: "separator",
                    margin: "lg"
                },
                {
                    type: "box",
                    layout: "vertical",
                    spacing: "md",
                    margin: "lg",
                    contents: [
                        {
                            type: "text",
                            text: "【サービス内容】",
                            weight: "bold",
                            size: "md",
                            color: "#6A5ACD",
                            wrap: true // ★追加
                        },
                        {
                            type: "text",
                            text: "・毎日、あなたに「おはよう！」や「元気？」などのメッセージを送信します。",
                            wrap: true, // ★追加
                            size: "sm"
                        },
                        {
                            type: "text",
                            text: "・一定期間返信がない場合、リマインダーメッセージを送信します。",
                            wrap: true, // ★追加
                            size: "sm"
                        },
                        {
                            type: "text",
                            text: "・さらに返信がない場合、登録された緊急連絡先に自動で通知が送られます。",
                            wrap: true, // ★追加
                            size: "sm"
                        },
                        {
                            type: "text",
                            text: "【利用方法】",
                            weight: "bold",
                            size: "md",
                            color: "#6A5ACD",
                            margin: "md",
                            wrap: true // ★追加
                        },
                        {
                            type: "text",
                            text: "・「見守りサービスを開始」ボタンを押してください。",
                            wrap: true, // ★追加
                            size: "sm"
                        },
                        {
                            type: "text",
                            text: "・サービスを停止したい場合は「見守りサービスを停止」と送ってください。",
                            wrap: true, // ★追加
                            size: "sm"
                        }
                    ]
                }
            ]
        },
        footer: {
            type: "box",
            layout: "vertical",
            spacing: "sm",
            contents: [
                {
                    type: "button",
                    style: "primary",
                    height: "sm",
                    color: "#6A5ACD",
                    action: {
                        type: "message",
                        label: "見守りサービスを開始",
                        text: "見守りサービスを開始します"
                    }
                },
                {
                    type: "button",
                    style: "secondary",
                    height: "sm",
                    action: {
                        type: "message",
                        label: "見守りサービスを停止",
                        text: "見守りサービスを停止します"
                    }
                }
            ]
        }
    }
};

// --- ヘルパー関数 ---

// ユーザーの状態を更新するヘルパー関数
async function updateUserStatus(userId, newStatus, eventType = 'message') {
    let userStatus = await UserStatus.findOne({ userId: userId });
    if (!userStatus) {
        userStatus = new UserStatus({ userId: userId });
    }

    const oldStatus = userStatus.status;
    if (oldStatus !== newStatus) {
        userStatus.status = newStatus;
        userStatus.history.push({
            oldStatus: oldStatus,
            newStatus: newStatus,
            event: eventType,
            timestamp: new Date()
        });
        await userStatus.save();
        console.log(`User ${userId} status changed from ${oldStatus} to ${newStatus} due to ${eventType}.`);
    } else {
        console.log(`User ${userId} status remains ${oldStatus}. Event: ${eventType}.`);
    }
    return userStatus;
}

// 見守りサービスの開始処理
async function startWatchService(userId, replyToken) {
    const userStatus = await updateUserStatus(userId, 'watch_active', 'start_command');
    userStatus.lastWatchMessageSent = new Date(); // 開始と同時に初回メッセージ送信時間として記録
    userStatus.lastUserReply = new Date(); // 開始時は返信があったとみなす
    userStatus.watchMessageCount = 0; // 回数をリセット
    await userStatus.save();
    const replyText = '見守りサービスを開始しました😊\n毎日こころちゃんからメッセージを送るね！';
    await client.replyMessage(replyToken, [{ type: 'text', text: replyText }]);
    await Message.create({
        userId: userId,
        message: '見守りサービスを開始します',
        replyText: replyText,
        responsedBy: 'こころちゃん（見守りサービス開始）',
        timestamp: new Date(),
    });
    console.log(`見守りサービス開始: User ${userId}`);
}

// 見守りサービスの停止処理
async function stopWatchService(userId, replyToken) {
    await updateUserStatus(userId, 'initial', 'stop_command');
    const replyText = '見守りサービスを停止しました。\nまたいつでも声をかけてね😊';
    await client.replyMessage(replyToken, [{ type: 'text', text: replyText }]);
    await Message.create({
        userId: userId,
        message: '見守りサービスを停止します',
        replyText: replyText,
        responsedBy: 'こころちゃん（見守りサービス停止）',
        timestamp: new Date(),
    });
    console.log(`見守りサービス停止: User ${userId}`);
}

// --- LINE webhook イベントハンドラー ---
app.post('/webhook', line.middleware(config), (req, res) => {
    Promise
        .all(req.body.events.map(handleEvent))
        .then((result) => res.json(result))
        .catch((err) => {
            console.error(err);
            res.status(500).end();
        });
});

async function handleEvent(event) {
    if (event.type !== 'message' || event.message.type !== 'text') {
        return Promise.resolve(null);
    }

    const userMessage = event.message.text;
    const replyToken = event.replyToken;
    const userId = event.source.userId;

    console.log(`User ID: ${userId}, Message: "${userMessage}"`);

    // ユーザーの状態を取得または作成
    let userStatus = await UserStatus.findOne({ userId: userId });
    if (!userStatus) {
        userStatus = new UserStatus({ userId: userId });
        await userStatus.save();
    }

    // ユーザーからの最終返信日時を更新
    userStatus.lastUserReply = new Date();
    // ユーザーが返信した場合、状態を 'watch_active' に戻す
    if (userStatus.status === 'watch_pending_reply' || userStatus.status === 'initial') {
        await updateUserStatus(userId, 'watch_active', 'user_reply');
        userStatus.watchMessageCount = 0; // リマインダー対応なのでリセット
        console.log(`User ${userId} replied, status reset to watch_active.`);
    }
    await userStatus.save();


    // テキストメッセージに対する応答ロジック
    let replyMessages = [];
    let responsedBy = 'こころちゃん'; // デフォルトの応答者

    // Flex Messageで応答するキーワード
    const dangerKeywords = ['いじめ', '自殺', '死にたい', '助けて', '辛い', '苦しい', '暴力', '暴行'];
    const scamKeywords = ['詐欺', '騙された', '怪しい', '儲かる話'];
    const watchServiceKeywords = ['見守りサービスとは', '見守りサービスについて', '見守りについて'];

    const isDanger = dangerKeywords.some(keyword => userMessage.includes(keyword));
    const isScam = scamKeywords.some(keyword => userMessage.includes(keyword));
    const isWatchServiceQuery = watchServiceKeywords.some(keyword => userMessage.includes(keyword));

    if (isDanger) {
        console.log(`  - Danger word detected! Sending emergencyFlex.`);
        // ★Flex Messageのみを送信
        try {
            await client.replyMessage(replyToken, [emergencyFlex]); // ✅ これで正しいです (メッセージオブジェクトの配列)
            console.log("✅ Flex Message送信成功（危険ワード）");
            responsedBy = 'こころちゃん（危険ワード）';
            await Message.create({
                userId: userId,
                message: userMessage,
                replyText: emergencyFlex.altText + '（Flex Message送信）', // ログにはaltTextを記録
                responsedBy: responsedBy,
                timestamp: new Date(),
            });
            return; // 以降の処理を停止
        } catch (err) {
            console.error("❌ Flex Message送信エラー（危険ワード）:", err.originalError?.response?.data || err.message);
            // エラー時でもユーザーにテキストで通知 (短くする)
            const fallbackText = "ごめんなさい、メッセージを送信できませんでした。緊急時は110番や9110番に連絡してください。";
            await client.replyMessage(replyToken, [{ type: 'text', text: fallbackText }])
                .catch(err => console.error("❌ Fallbackテキスト送信エラー:", err.message));
            responsedBy = 'こころちゃん（危険ワード：Flex送信失敗）';
            await Message.create({
                userId: userId,
                message: userMessage,
                replyText: fallbackText,
                responsedBy: responsedBy,
                timestamp: new Date(),
            });
            return; // 以降の処理を停止
        }
    }

    if (isScam) {
        console.log(`  - Scam word detected! Sending scamFlex.`);
        // ★Flex Messageのみを送信
        try {
            await client.replyMessage(replyToken, [scamFlex]); // ✅ これで正しいです (メッセージオブジェクトの配列)
            console.log("✅ Flex Message送信成功（詐欺ワード）");
            responsedBy = 'こころちゃん（詐欺ワード）';
            await Message.create({
                userId: userId,
                message: userMessage,
                replyText: scamFlex.altText + '（Flex Message送信）', // ログにはaltTextを記録
                responsedBy: responsedBy,
                timestamp: new Date(),
            });
            return; // 以降の処理を停止
        } catch (err) {
            console.error("❌ Flex Message送信エラー（詐欺ワード）:", err.originalError?.response?.data || err.message);
            // エラー時でもユーザーにテキストで通知 (短くする)
            const fallbackText = "ごめんなさい、メッセージを送信できませんでした。詐欺かなと思ったら警察相談専用電話#9110へ連絡してください。";
            await client.replyMessage(replyToken, [{ type: 'text', text: fallbackText }])
                .catch(err => console.error("❌ Fallbackテキスト送信エラー:", err.message));
            responsedBy = 'こころちゃん（詐欺ワード：Flex送信失敗）';
            await Message.create({
                userId: userId,
                message: userMessage,
                replyText: fallbackText,
                responsedBy: responsedBy,
                timestamp: new Date(),
            });
            return; // 以降の処理を停止
        }
    }

    if (isWatchServiceQuery) {
        console.log(`  - Watch service query detected! Sending watchServiceGuideFlex.`);
        // ★Flex Messageのみを送信
        try {
            await client.replyMessage(replyToken, [watchServiceGuideFlex]); // ✅ これで正しいです (メッセージオブジェクトの配列)
            console.log("✅ Flex Message送信成功（見守りサービス案内）");
            responsedBy = 'こころちゃん（見守りサービス案内）';
            await Message.create({
                userId: userId,
                message: userMessage,
                replyText: watchServiceGuideFlex.altText + '（Flex Message送信）', // ログにはaltTextを記録
                responsedBy: responsedBy,
                timestamp: new Date(),
            });
            return; // 以降の処理を停止
        } catch (err) {
            console.error("❌ Flex Message送信エラー（見守りサービス案内）:", err.originalError?.response?.data || err.message);
            // エラー時でもユーザーにテキストで通知 (短くする)
            const fallbackText = "ごめんなさい、見守りサービスのご案内を送信できませんでした。「見守りサービスを開始」と入力すると開始できます。";
            await client.replyMessage(replyToken, [{ type: 'text', text: fallbackText }])
                .catch(err => console.error("❌ Fallbackテキスト送信エラー:", err.message));
            responsedBy = 'こころちゃん（見守りサービス案内：Flex送信失敗）';
            await Message.create({
                userId: userId,
                message: userMessage,
                replyText: fallbackText,
                responsedBy: responsedBy,
                timestamp: new Date(),
            });
            return; // 以降の処理を停止
        }
    }

    // 特定のキーワード応答
    if (userMessage.includes('見守りサービスを開始します')) {
        await startWatchService(userId, replyToken);
        return;
    }

    if (userMessage.includes('見守りサービスを停止します')) {
        await stopWatchService(userId, replyToken);
        return;
    }

    if (userMessage.includes('こんにちは')) {
        replyMessages.push({ type: 'text', text: 'こんにちは！どんなお話かな？😊' });
        responsedBy = 'こころちゃん（挨拶）';
    } else if (userMessage.includes('おはよう')) {
        replyMessages.push({ type: 'text', text: 'おはようございます！今日も一日頑張ろうね！😊' });
        responsedBy = 'こころちゃん（挨拶）';
    } else if (userMessage.includes('おやすみ')) {
        replyMessages.push({ type: 'text', text: 'おやすみなさい。ゆっくり休んでね！😴' });
        responsedBy = 'こころちゃん（挨拶）';
    } else if (userMessage.includes('元気')) {
        replyMessages.push({ type: 'text', text: 'うん、こころちゃんは元気だよ！あなたは元気かな？😊' });
        responsedBy = 'こころちゃん（安否確認応答）';
    } else {
        // デフォルト応答（雑談）
        const defaultReplies = [
            'そっか、そうなんだね。',
            'うんうん、わかるよ。',
            'なるほどね！',
            'もう少し詳しく聞かせてくれる？',
            'そういうこともあるよね。',
            '他に何かあったら教えてね。',
        ];
        const randomReply = defaultReplies[Math.floor(Math.random() * defaultReplies.length)];
        replyMessages.push({ type: 'text', text: randomReply });
        responsedBy = 'こころちゃん（雑談）';
    }

    if (replyMessages.length > 0) {
        await client.replyMessage(replyToken, replyMessages);
        await Message.create({
            userId: userId,
            message: userMessage,
            replyText: replyMessages.map(msg => msg.text).join('\n'),
            responsedBy: responsedBy,
            timestamp: new Date(),
        });
    }
}

// --- 定期実行ジョブの関数定義 ---

// 定期見守りメッセージ送信関数
async function sendScheduledWatchMessage() {
    console.log('--- Cron job: 定期見守りメッセージ送信 ---');
    const users = await UserStatus.find({ status: 'watch_active' });
    const now = new Date();

    for (const user of users) {
        // 前回の見守りメッセージ送信から24時間以上経過しているか確認
        const timeSinceLastWatch = now.getTime() - (user.lastWatchMessageSent ? user.lastWatchMessageSent.getTime() : 0);
        const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000; // 24時間（ミリ秒）

        if (timeSinceLastWatch >= TWENTY_FOUR_HOURS) {
            try {
                const messages = [
                    { type: 'text', text: 'まつさん、おはよう！今日も一日頑張ろうね！☀️' },
                    { type: 'text', text: 'まつさん、元気かな？何かあったらいつでも教えてね！😊' },
                    { type: 'text', text: 'まつさん、今日の調子はどう？こころちゃんは、まつさんのこと応援してるよ！💖' }
                ];
                const randomMessage = messages[Math.floor(Math.random() * messages.length)];

                // プッシュメッセージ送信
                await client.pushMessage(user.userId, randomMessage);
                console.log(`定期見守りメッセージ送信成功 to User ${user.userId}`);

                user.lastWatchMessageSent = now;
                user.watchMessageCount = 0; // リマインダーが未送信の状態に戻す
                await user.save();

                await Message.create({
                    userId: user.userId,
                    message: '(システム)',
                    replyText: randomMessage.text,
                    responsedBy: '定期見守り（自動）',
                    timestamp: now,
                });
                await updateUserStatus(user.userId, 'watch_active', 'cron_watch'); // 状態維持
            } catch (error) {
                console.error(`定期見守りメッセージ送信失敗 to User ${user.userId}:`, error.message);
            }
        }
    }
}

// リマインダーメッセージ送信関数
async function sendReminderMessages() {
    console.log('--- Cron job: リマインダーメッセージ送信 ---');
    const users = await UserStatus.find({ status: 'watch_active' });
    const now = new Date();
    const FORTY_EIGHT_HOURS = 48 * 60 * 60 * 1000; // 48時間（ミリ秒）

    for (const user of users) {
        const timeSinceLastReply = now.getTime() - (user.lastUserReply ? user.lastUserReply.getTime() : 0);

        // 48時間以上返信がないユーザーにリマインダーを送信
        if (timeSinceLastReply >= FORTY_EIGHT_HOURS) {
            try {
                const reminderText = 'まつさん、最近連絡がないけど元気にしてるかな？\n心配だから、簡単なスタンプでもいいから返信してくれると嬉しいな😊';
                await client.pushMessage(user.userId, { type: 'text', text: reminderText });
                console.log(`リマインダーメッセージ送信成功 to User ${user.userId}`);

                user.lastReminderSent = now;
                user.watchMessageCount = (user.watchMessageCount || 0) + 1; // リマインダー回数を加算
                await user.save();
                await Message.create({
                    userId: user.userId,
                    message: '(システム)',
                    replyText: reminderText,
                    responsedBy: 'リマインダー（自動）',
                    timestamp: now,
                });
                // 状態を 'watch_pending_reply' に変更
                await updateUserStatus(user.userId, 'watch_pending_reply', 'cron_reminder');
            } catch (error) {
                console.error(`リマインダーメッセージ送信失敗 to User ${user.userId}:`, error.message);
            }
        }
    }
}

// 緊急エスカレーション関数（必要に応じてNPO法人担当者に通知）
async function escalateEmergency() {
    console.log('--- Cron job: 緊急エスカレーション ---');
    const users = await UserStatus.find({ status: 'watch_pending_reply' });
    const now = new Date();
    const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000; // 前のリマインダーからの時間計算に必要

    for (const user of users) {
        const timeSinceLastReminder = now.getTime() - (user.lastReminderSent ? user.lastReminderSent.getTime() : 0);

        // リマインダー送信から24時間以上（合計72時間）返信がない場合
        if (timeSinceLastReminder >= TWENTY_FOUR_HOURS) { // 前のリマインダーから24時間経過
            try {
                // ここにNPO法人への通知ロジックを実装
                // 例: 管理者へのLINE通知、メール送信など
                const escalationMessage = `【緊急通知】ユーザーID: ${user.userId} から72時間以上返信がありません。確認してください。`;
                console.log(escalationMessage);

                // ★NPO法人管理者への通知例（Line Notifyや別のLINEアカウントへのプッシュなど）
                // if (process.env.NPO_ADMIN_LINE_USER_ID) {
                //     await client.pushMessage(process.env.NPO_ADMIN_LINE_USER_ID, { type: 'text', text: escalationMessage });
                // }

                user.lastEmergencyEscalated = now;
                await user.save();
                await Message.create({
                    userId: user.userId,
                    message: '(システム)',
                    replyText: escalationMessage,
                    responsedBy: '緊急エスカレーション（自動）',
                    timestamp: now,
                });
                // 状態を 'initial' に戻す（または 'escalated' などの新しい状態にする）
                await updateUserStatus(user.userId, 'initial', 'cron_escalation');
            } catch (error) {
                console.error(`緊急エスカレーション失敗 to User ${user.userId}:`, error.message);
            }
        }
    }
}


// --- 定期実行ジョブのスケジューリング ---
// ★RangeError対策のため、関数を無名関数でラップして渡します
// 毎日午後3時（日本時間）に見守りメッセージを送信
schedule.scheduleJob('0 15 * * *', async () => {
    console.log('--- Cron job: 定期見守りメッセージ送信が実行されました ---');
    await sendScheduledWatchMessage();
}, {
    timezone: "Asia/Tokyo"
});

// 毎日午前9時と午後9時（日本時間）にリマインダーメッセージを送信
schedule.scheduleJob('0 9,21 * * *', async () => {
    console.log('--- Cron job: リマインダーメッセージ送信が実行されました ---');
    await sendReminderMessages();
}, {
    timezone: "Asia/Tokyo"
});

// 毎日午前0時（日本時間）に緊急エスカレーションを確認
schedule.scheduleJob('0 0 * * *', async () => {
    console.log('--- Cron job: 緊急エスカレーション確認が実行されました ---');
    await escalateEmergency();
}, {
    timezone: "Asia/Tokyo"
});


// Expressサーバーの起動
app.listen(PORT, () => {
    console.log(`サーバーがポート ${PORT} で起動しました。`);
});
