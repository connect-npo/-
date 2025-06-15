// --- ① .envの完全分離 ---
require('dotenv').config();

// --- 必要なモジュールのインポート ---
const line = require('@line/bot-sdk');
const express = require('express');
const { MongoClient, ServerApiVersion } = require("mongodb");
const { Configuration, OpenAIApi } = require("openai"); // OpenAIモジュールをインポート

// --- LINE Bot設定 ---
const config = {
    channelAccessToken: process.env.YOUR_CHANNEL_ACCESS_TOKEN,
    channelSecret: process.env.YOUR_CHANNEL_SECRET,
};
const client = new line.Client(config);

// --- OpenAI設定 ---
const configuration = new Configuration({
    apiKey: process.env.OPENAI_API_KEY,
});
const openai = new OpenAIApi(configuration);

// --- MongoDB設定 ---
const uri = process.env.MONGODB_URI;
let mongoClient; // MongoDBクライアントをグローバルで保持
let dbInstance = null; // ✅ 対策案1: MongoDB接続インスタンスをグローバルに保持

// --- MongoDB自動リトライ設定 ---
async function connectToMongoDB(retries = 5) {
    // ✅ 対策案1: 既に接続インスタンスがあればそれを返す
    if (dbInstance) {
        return dbInstance;
    }

    for (let i = 0; i < retries; i++) {
        try {
            mongoClient = new MongoClient(uri, {
                serverApi: {
                    version: ServerApiVersion.v1,
                    strict: true,
                    deprecationErrors: true,
                }
            });
            await mongoClient.connect();
            console.log("✅ MongoDBに接続しました！");
            dbInstance = mongoClient.db("connect-npo"); // ✅ 対策案1: インスタンスを保持
            return dbInstance;
        } catch (err) {
            console.error(`❌ MongoDB接続失敗（${i + 1}/${retries}回目）`, err);
            await new Promise(res => setTimeout(res, 2000));
        }
    }
    console.error("❌ MongoDBへの接続に複数回失敗しました。アプリケーションを終了します。");
    process.exit(1);
}

// --- Expressサーバーの設定 ---
const app = express();
const PORT = process.env.PORT || 3000;

app.post('/webhook', line.middleware(config), async (req, res) => {
    // DB接続は初回のみ行われるように変更 (connectToMongoDB関数内で制御)
    const db = await connectToMongoDB();
    if (!db) {
        console.error('Database connection failed in webhook handler.');
        return res.status(500).send('Database connection failed.');
    }

    const usersCollection = db.collection("users");
    const messagesCollection = db.collection("messages");

    Promise
        .all(req.body.events.map(event => handleEvent(event, usersCollection, messagesCollection)))
        .then((result) => res.json(result))
        .catch((err) => {
            console.error('Error in handleEvent:', err);
            res.status(500).end();
        });
});

// --- イベントハンドラ ---
async function handleEvent(event, usersCollection, messagesCollection) {
    console.log('--- LINE Event ---', JSON.stringify(event, null, 2));

    // ✅ 対策案3: 型チェック・バリデーションの強化
    if (!event.source || !event.source.userId) {
        console.warn('Skipping event due to missing source or userId:', event);
        return null; // userIdがないイベントは処理しない
    }

    const userId = event.source.userId;

    // フォローイベント処理
    if (event.type === 'follow') {
        const profile = await client.getProfile(userId);
        console.log('Follow Event Profile:', profile);
        await usersCollection.updateOne(
            { userId: userId },
            {
                $set: {
                    name: profile.displayName,
                    isWatchEnabled: true,
                    updatedAt: new Date(),
                },
                $setOnInsert: {
                    createdAt: new Date(),
                },
            },
            { upsert: true }
        );
        return client.replyMessage(event.replyToken, {
            type: 'text',
            text: `まつさんの有能な秘書、クララだよ！\nフォローありがとう！見守りサービスに登録したよ。`
        });
    }

    // メッセージイベント処理
    if (event.type === 'message') {
        // ユーザー情報を取得または新規登録
        let user = await usersCollection.findOne({ userId: userId });
        if (!user) {
            const profile = await client.getProfile(userId);
            await usersCollection.insertOne({
                userId: userId,
                name: profile.displayName,
                isWatchEnabled: true,
                createdAt: new Date(),
            });
            user = await usersCollection.findOne({ userId: userId }); // 再度取得
        }

        let userMessage = '';
        let replyText = '';

        // ✅ 対策案4: message.type !== 'text' 対応
        if (event.message.type === 'text') {
            userMessage = event.message.text;

            // ✅ 対策案2: OpenAI連携の追加
            try {
                const completion = await openai.createChatCompletion({
                    model: "gpt-4o", // まつさんのご要望でgpt-4oに設定
                    messages: [{ role: "user", content: userMessage }]
                });
                replyText = completion.data.choices[0].message.content;
            } catch (openaiErr) {
                console.error("OpenAI API Error:", openaiErr.response ? openaiErr.response.data : openaiErr.message);
                replyText = `ごめんね、今AIがちょっとお疲れみたい💦\n「${userMessage}」って言ったのはしっかり受け取ったよ！`;
            }
        } else {
            // テキストメッセージ以外の場合の返信
            userMessage = `[${event.message.type}メッセージ]`; // DB保存用にタイプを記録
            replyText = 'ごめんね、まつさんの有能な秘書クララだけど、まだテキストメッセージしかわからないんだ💦';
        }

        // メッセージとAIの返信をDBに保存 (replyTextも保存)
        await messagesCollection.insertOne({
            userId: userId,
            message: userMessage,
            replyText: replyText, // ✅ messagesCollectionにreplyTextも保存
            timestamp: new Date(),
        });

        return client.replyMessage(event.replyToken, { type: 'text', text: replyText });
    }

    // その他のイベントタイプは無視
    return Promise.resolve(null);
}

// --- サーバー起動 ---
async function startServer() {
    await connectToMongoDB(); // アプリケーション起動時に初回MongoDB接続
    app.listen(PORT, () => {
        console.log(`🚀 サーバー起動中: http://localhost:${PORT}`);
    });
}

startServer();// --- ① .envの完全分離 ---
require('dotenv').config();

// --- 必要なモジュールのインポート ---
const line = require('@line/bot-sdk');
const express = require('express');
const { MongoClient, ServerApiVersion } = require("mongodb");
const { Configuration, OpenAIApi } = require("openai"); // OpenAIモジュールをインポート

// --- LINE Bot設定 ---
const config = {
    channelAccessToken: process.env.YOUR_CHANNEL_ACCESS_TOKEN,
    channelSecret: process.env.YOUR_CHANNEL_SECRET,
};
const client = new line.Client(config);

// --- OpenAI設定 ---
const configuration = new Configuration({
    apiKey: process.env.OPENAI_API_KEY,
});
const openai = new OpenAIApi(configuration);

// --- MongoDB設定 ---
const uri = process.env.MONGODB_URI;
let mongoClient; // MongoDBクライアントをグローバルで保持
let dbInstance = null; // ✅ 対策案1: MongoDB接続インスタンスをグローバルに保持

// --- MongoDB自動リトライ設定 ---
async function connectToMongoDB(retries = 5) {
    // ✅ 対策案1: 既に接続インスタンスがあればそれを返す
    if (dbInstance) {
        return dbInstance;
    }

    for (let i = 0; i < retries; i++) {
        try {
            mongoClient = new MongoClient(uri, {
                serverApi: {
                    version: ServerApiVersion.v1,
                    strict: true,
                    deprecationErrors: true,
                }
            });
            await mongoClient.connect();
            console.log("✅ MongoDBに接続しました！");
            dbInstance = mongoClient.db("connect-npo"); // ✅ 対策案1: インスタンスを保持
            return dbInstance;
        } catch (err) {
            console.error(`❌ MongoDB接続失敗（${i + 1}/${retries}回目）`, err);
            await new Promise(res => setTimeout(res, 2000));
        }
    }
    console.error("❌ MongoDBへの接続に複数回失敗しました。アプリケーションを終了します。");
    process.exit(1);
}

// --- Expressサーバーの設定 ---
const app = express();
const PORT = process.env.PORT || 3000;

app.post('/webhook', line.middleware(config), async (req, res) => {
    // DB接続は初回のみ行われるように変更 (connectToMongoDB関数内で制御)
    const db = await connectToMongoDB();
    if (!db) {
        console.error('Database connection failed in webhook handler.');
        return res.status(500).send('Database connection failed.');
    }

    const usersCollection = db.collection("users");
    const messagesCollection = db.collection("messages");

    Promise
        .all(req.body.events.map(event => handleEvent(event, usersCollection, messagesCollection)))
        .then((result) => res.json(result))
        .catch((err) => {
            console.error('Error in handleEvent:', err);
            res.status(500).end();
        });
});

// --- イベントハンドラ ---
async function handleEvent(event, usersCollection, messagesCollection) {
    console.log('--- LINE Event ---', JSON.stringify(event, null, 2));

    // ✅ 対策案3: 型チェック・バリデーションの強化
    if (!event.source || !event.source.userId) {
        console.warn('Skipping event due to missing source or userId:', event);
        return null; // userIdがないイベントは処理しない
    }

    const userId = event.source.userId;

    // フォローイベント処理
    if (event.type === 'follow') {
        const profile = await client.getProfile(userId);
        console.log('Follow Event Profile:', profile);
        await usersCollection.updateOne(
            { userId: userId },
            {
                $set: {
                    name: profile.displayName,
                    isWatchEnabled: true,
                    updatedAt: new Date(),
                },
                $setOnInsert: {
                    createdAt: new Date(),
                },
            },
            { upsert: true }
        );
        return client.replyMessage(event.replyToken, {
            type: 'text',
            text: `まつさんの有能な秘書、クララだよ！\nフォローありがとう！見守りサービスに登録したよ。`
        });
    }

    // メッセージイベント処理
    if (event.type === 'message') {
        // ユーザー情報を取得または新規登録
        let user = await usersCollection.findOne({ userId: userId });
        if (!user) {
            const profile = await client.getProfile(userId);
            await usersCollection.insertOne({
                userId: userId,
                name: profile.displayName,
                isWatchEnabled: true,
                createdAt: new Date(),
            });
            user = await usersCollection.findOne({ userId: userId }); // 再度取得
        }

        let userMessage = '';
        let replyText = '';

        // ✅ 対策案4: message.type !== 'text' 対応
        if (event.message.type === 'text') {
            userMessage = event.message.text;

            // ✅ 対策案2: OpenAI連携の追加
            try {
                const completion = await openai.createChatCompletion({
                    model: "gpt-4o", // まつさんのご要望でgpt-4oに設定
                    messages: [{ role: "user", content: userMessage }]
                });
                replyText = completion.data.choices[0].message.content;
            } catch (openaiErr) {
                console.error("OpenAI API Error:", openaiErr.response ? openaiErr.response.data : openaiErr.message);
                replyText = `ごめんね、今AIがちょっとお疲れみたい💦\n「${userMessage}」って言ったのはしっかり受け取ったよ！`;
            }
        } else {
            // テキストメッセージ以外の場合の返信
            userMessage = `[${event.message.type}メッセージ]`; // DB保存用にタイプを記録
            replyText = 'ごめんね、まつさんの有能な秘書クララだけど、まだテキストメッセージしかわからないんだ💦';
        }

        // メッセージとAIの返信をDBに保存 (replyTextも保存)
        await messagesCollection.insertOne({
            userId: userId,
            message: userMessage,
            replyText: replyText, // ✅ messagesCollectionにreplyTextも保存
            timestamp: new Date(),
        });

        return client.replyMessage(event.replyToken, { type: 'text', text: replyText });
    }

    // その他のイベントタイプは無視
    return Promise.resolve(null);
}

// --- サーバー起動 ---
async function startServer() {
    await connectToMongoDB(); // アプリケーション起動時に初回MongoDB接続
    app.listen(PORT, () => {
        console.log(`🚀 サーバー起動中: http://localhost:${PORT}`);
    });
}

startServer();
