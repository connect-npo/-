// モジュールと環境変数の読み込み
const line = require('@line/bot-sdk');
const express = require('express');
const mongoose = require('mongoose');
const schedule = require('node-schedule'); // Cronジョブを一時的に停止するため、requireは残す
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

// ★テスト用Flex Message (全てのFlexを一時的にこれに置き換えます)
const testFlex = {
  type: "flex",
  altText: "テスト", // 40文字以内
  contents: {
    type: "bubble",
    body: {
      type: "box",
      layout: "vertical",
      contents: [
        {
          type: "text",
          text: "これはテストです。ボタンが表示されますか？",
          wrap: true, // 必ずtrue
          size: "md"
        },
        {
          type: "button",
          style: "primary",
          height: "sm",
          action: {
            type: "uri",
            label: "テストボタン",
            uri: "https://www.google.com/" // 実際にアクセス可能なURL
          }
        }
      ]
    }
  }
};


// --- ヘルパー関数 --- (変更なし、Cronジョブを一時停止するため使用されません)
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

async function startWatchService(userId, replyToken) {
    const userStatus = await updateUserStatus(userId, 'watch_active', 'start_command');
    userStatus.lastWatchMessageSent = new Date();
    userStatus.lastUserReply = new Date();
    userStatus.watchMessageCount = 0;
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

// Cronジョブ関数も一時的にコメントアウト (RangeErrorを完全に回避するため)
/*
async function sendScheduledWatchMessage() {
    console.log('--- Cron job: 定期見守りメッセージ送信 ---');
    // ... 処理
}
async function sendReminderMessages() {
    console.log('--- Cron job: リマインダーメッセージ送信 ---');
    // ... 処理
}
async function escalateEmergency() {
    console.log('--- Cron job: 緊急エスカレーション ---');
    // ... 処理
}
*/

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
    if (userStatus.status === 'watch_pending_reply' || userStatus.status === 'initial') {
        await updateUserStatus(userId, 'watch_active', 'user_reply');
        userStatus.watchMessageCount = 0;
        console.log(`User ${userId} replied, status reset to watch_active.`);
    }
    await userStatus.save();


    // テキストメッセージに対する応答ロジック
    let replyMessages = [];
    let responsedBy = 'こころちゃん';

    const dangerKeywords = ['いじめ', '自殺', '死にたい', '助けて', '辛い', '苦しい', '暴力', '暴行'];
    const scamKeywords = ['詐欺', '騙された', '怪しい', '儲かる話'];
    const watchServiceKeywords = ['見守りサービスとは', '見守りサービスについて', '見守りについて'];

    const isDanger = dangerKeywords.some(keyword => userMessage.includes(keyword));
    const isScam = scamKeywords.some(keyword => userMessage.includes(keyword));
    const isWatchServiceQuery = watchServiceKeywords.some(keyword => userMessage.includes(keyword));

    if (isDanger || isScam || isWatchServiceQuery) { // いずれかのキーワードでtestFlexを送信
        console.log(`  - Keyword detected! Sending testFlex.`);
        try {
            await client.replyMessage(replyToken, [testFlex]); // ★ testFlexを送信
            console.log("✅ testFlex Message送信成功");
            responsedBy = 'こころちゃん（キーワード応答：テストFlex）';
            await Message.create({
                userId: userId,
                message: userMessage,
                replyText: testFlex.altText + '（testFlex送信）',
                responsedBy: responsedBy,
                timestamp: new Date(),
            });
            return; // 以降の処理を停止
        } catch (err) {
            console.error("❌ testFlex Message送信エラー:", err.originalError?.response?.data || err.message);
            // エラー時でもユーザーにテキストで通知 (短くする)
            const fallbackText = "ごめんなさい、メッセージを送信できませんでした。";
            await client.replyMessage(replyToken, [{ type: 'text', text: fallbackText }])
                .catch(err => console.error("❌ Fallbackテキスト送信エラー:", err.message));
            responsedBy = 'こころちゃん（キーワード応答：テストFlex失敗）';
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

    // 特定のキーワード応答 (見守りサービス開始/停止はそのまま残す)
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

// --- 定期実行ジョブのスケジューリング (一時的に全てコメントアウト) ---
// schedule.scheduleJob('0 15 * * *', async () => {
//     console.log('--- Cron job: 定期見守りメッセージ送信が実行されました ---');
//     await sendScheduledWatchMessage();
// }, {
//     timezone: "Asia/Tokyo"
// });

// schedule.scheduleJob('0 9,21 * * *', async () => {
//     console.log('--- Cron job: リマインダーメッセージ送信が実行されました ---');
//     await sendReminderMessages();
// }, {
//     timezone: "Asia/Tokyo"
// });

// schedule.scheduleJob('0 0 * * *', async () => {
//     console.log('--- Cron job: 緊急エスカレーション確認が実行されました ---');
//     await escalateEmergency();
// }, {
//     timezone: "Asia/Tokyo"
// });


// Expressサーバーの起動
app.listen(PORT, () => {
    console.log(`サーバーがポート ${PORT} で起動しました。`);
});
