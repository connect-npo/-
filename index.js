// --- .envの完全分離 ---
require('dotenv').config();

// --- 必要なモジュールのインポート ---
const line = require('@line/bot-sdk');
const express = require('0express');
const { MongoClient, ServerApiVersion } = require("mongodb");
const { Configuration, OpenAIApi } = require("openai");

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
let dbInstance = null; // MongoDB接続インスタンスをグローバルに保持

// --- MongoDB自動リトライ設定 ---
async function connectToMongoDB(retries = 5) {
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
            dbInstance = mongoClient.db("connect-npo");
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

    if (!event.source || !event.source.userId) {
        console.warn('Skipping event due to missing source or userId:', event);
        return null;
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
        // ① 固定返信メッセージの修正 (クララ表現を除去)
        return client.replyMessage(event.replyToken, {
            type: 'text',
            text: `こんにちは💖こころちゃんだよ！\nフォローしてくれてありがとう、見守りサービスに登録したね。いつでも話しかけてね🌸`
        });
    }

    // メッセージイベント処理
    if (event.type === 'message') {
        let user = await usersCollection.findOne({ userId: userId });
        if (!user) {
            const profile = await client.getProfile(userId);
            await usersCollection.insertOne({
                userId: userId,
                name: profile.displayName,
                isWatchEnabled: true,
                createdAt: new Date(),
            });
            user = await usersCollection.findOne({ userId: userId });
        }

        let userMessage = '';
        let replyText = '';

        if (event.message.type === 'text') {
            userMessage = event.message.text;

            try {
                // ② OpenAIへのsystemプロンプトをこころちゃんに変更 (最重要)
                const completion = await openai.createChatCompletion({
                    model: "gpt-4o", // または gpt-3.5-turbo など
                    messages: [
                        {
                            role: "system",
                            content: "あなたは14歳の優しい女の子『こころちゃん』です。まつさんが開発したLINE相談Botとして、優しく寄り添いながら応答してください。語尾は丁寧で、子どもにも安心される表現を使ってください。"
                        },
                        {
                            role: "user",
                            content: userMessage
                        }
                    ]
                });
                replyText = completion.data.choices[0].message.content;
            } catch (openaiErr) {
                console.error("OpenAI API Error:", openaiErr.response ? openaiErr.response.data : openaiErr.message);
                replyText = `ごめんね、今ちょっとAIがお疲れみたい💦\nでも「${userMessage}」って言ってくれたのは、こころちゃんがしっかり受け取ったよ！`;
            }
        } else {
            userMessage = `[${event.message.type}メッセージ]`;
            replyText = 'ごめんね、こころちゃん、まだテキストメッセージしかわからないんだ💦';
        }

        // ログ保存も「こころちゃん」で記録 (任意)
        await messagesCollection.insertOne({
            userId: userId,
            message: userMessage,
            replyText: replyText,
            respondedBy: 'こころちゃん', // こころちゃんが応答したことを記録
            timestamp: new Date(),
        });

        return client.replyMessage(event.replyToken, { type: 'text', text: replyText });
    }

    return Promise.resolve(null);
}

// --- サーバー起動 ---
async function startServer() {
    await connectToMongoDB();
    app.listen(PORT, () => {
        console.log(`🚀 サーバー起動中: http://localhost:${PORT}`);
    });
}

startServer();
