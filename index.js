// --- ① .envの完全分離 ---
// dotenvを読み込んで環境変数を安全に管理
require('dotenv').config();

// --- 必要なモジュールのインポート ---
const line = require('@line/bot-sdk');
const express = require('express');
const { MongoClient, ServerApiVersion } = require("mongodb");
const { Configuration, OpenAIApi } = require("openai");

// --- LINE Bot設定 ---
// 環境変数からLINE Botのチャネルアクセストークンとチャネルシークレットを取得
const config = {
    channelAccessToken: process.env.YOUR_CHANNEL_ACCESS_TOKEN,
    channelSecret: process.env.YOUR_CHANNEL_SECRET,
};
const client = new line.Client(config);

// --- OpenAI設定 ---
// 環境変数からOpenAIのAPIキーを取得
const configuration = new Configuration({
    apiKey: process.env.OPENAI_API_KEY,
});
const openai = new OpenAIApi(configuration);

// --- MongoDB設定 ---
// 環境変数からMongoDBのURIを取得
const uri = process.env.MONGODB_URI;
let mongoClient; // MongoDBクライアントをグローバルで保持

// --- ② MongoDB自動リトライ設定 ---
// MongoDBに接続し、接続が確立されるまでリトライする関数
async function connectToMongoDB(retries = 5) {
    for (let i = 0; i < retries; i++) {
        try {
            // MongoDBクライアントの新しいインスタンスを作成
            mongoClient = new MongoClient(uri, {
                serverApi: {
                    version: ServerApiVersion.v1,
                    strict: true,
                    deprecationErrors: true,
                }
            });
            await mongoClient.connect(); // 接続を試行
            console.log("✅ MongoDBに接続しました！");
            return mongoClient.db("connect-npo"); // 接続成功時にDBインスタンスを返す
        } catch (err) {
            console.error(`❌ MongoDB接続失敗（${i + 1}/${retries}回目）`, err);
            // 2秒待機してからリトライ
            await new Promise(res => setTimeout(res, 2000));
        }
    }
    // 全てのリトライが失敗したらプロセスを終了
    console.error("❌ MongoDBへの接続に複数回失敗しました。アプリケーションを終了します。");
    process.exit(1);
}

// --- Expressサーバーの設定 ---
const app = express();
const PORT = process.env.PORT || 3000; // 環境変数からポートを取得、なければ3000

// ミドルウェア: LINEからのWebhookリクエストを処理
app.post('/webhook', line.middleware(config), async (req, res) => {
    const db = await connectToMongoDB(); // リクエストごとにDB接続を試行（必要であれば）
    if (!db) {
        return res.status(500).send('Database connection failed.');
    }
    const usersCollection = db.collection("users"); // usersコレクションを取得
    const messagesCollection = db.collection("messages"); // messagesコレクションを取得

    Promise
        .all(req.body.events.map(event => handleEvent(event, usersCollection, messagesCollection)))
        .then((result) => res.json(result))
        .catch((err) => {
            console.error(err);
            res.status(500).end();
        });
});

// --- イベントハンドラ ---
async function handleEvent(event, usersCollection, messagesCollection) {
    console.log('--- LINE Event ---', JSON.stringify(event, null, 2));

    const userId = event.source.userId; // ユーザーIDを取得

    // フォローイベント処理
    if (event.type === 'follow') {
        const profile = await client.getProfile(userId);
        console.log('Follow Event Profile:', profile);
        await usersCollection.updateOne(
            { userId: userId },
            {
                $set: {
                    name: profile.displayName,
                    // --- ③ isWatchEnabled（見守り設定）をusersに追加 ---
                    isWatchEnabled: true, // 新規フォロー時に見守り設定を有効にする
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
    if (event.type === 'message' && event.message.type === 'text') {
        const userMessage = event.message.text;

        // ユーザー情報を取得または新規登録
        let user = await usersCollection.findOne({ userId: userId });
        if (!user) {
            const profile = await client.getProfile(userId);
            await usersCollection.insertOne({
                userId: userId,
                name: profile.displayName,
                // --- ③ isWatchEnabled（見守り設定）をusersに追加 ---
                isWatchEnabled: true, // 新規ユーザーの場合もデフォルトで有効
                createdAt: new Date(),
            });
            user = await usersCollection.findOne({ userId: userId }); // 再度取得
        }

        // メッセージをDBに保存
        await messagesCollection.insertOne({
            userId: userId,
            message: userMessage,
            timestamp: new Date(),
        });

        // AI応答生成（例として、ユーザーのメッセージをオウム返し）
        // ここにChatGPT連携などのロジックを追加
        const replyText = `まつさんの有能な秘書、クララだよ！\n「${userMessage}」って言ったんだね！\n（まだ開発中だけど、見守りサービスとして、みんなのメッセージはちゃんと記録してるよ！）`;

        return client.replyMessage(event.replyToken, { type: 'text', text: replyText });
    }

    // その他のイベントやメッセージタイプには対応しない
    return Promise.resolve(null);
}

// --- サーバー起動 ---
async function startServer() {
    // アプリケーション起動時にMongoDBに接続
    await connectToMongoDB();
    app.listen(PORT, () => {
        console.log(`🚀 サーバー起動中: http://localhost:${PORT}`);
    });
}

startServer(); // サーバーを起動
