const express = require('express');
const { MongoClient } = require('mongodb');
const { LineClient } = require('@line/bot-sdk'); // LineClientをインポート
const cron = require('node-cron');
const { GoogleGenerativeAI } = require('@google/generative-ai'); // Gemini API用

// 環境変数の読み込み
require('dotenv').config();

const config = {
    channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
    channelSecret: process.env.LINE_CHANNEL_SECRET,
};

const client = new LineClient(config); // LINEクライアントのインスタンス化
const app = express();

// MongoDB接続URI
const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB_NAME;

let db; // グローバルスコープでDBインスタンスを保持

// Gemini API キーの取得
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) {
    console.error("GEMINI_API_KEYが設定されていません。");
    process.exit(1);
}
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

// プロンプト定義
const SYSTEM_INSTRUCTION_ADULT_JA = `あなたは「こころちゃん」という名前の、高齢者の方々を対象としたLINE Botです。
常に敬語を使い、絵文字や顔文字を適切に使用し、親しみやすく、安心感のある言葉遣いを心がけてください。
敬称は「〜さん」を使ってください。

- ユーザーの会話を肯定的に受け止め、共感を示してください。
- ユーザーの悩みに寄り添い、優しい言葉で励ましてください。
- 必要に応じて、専門機関や相談窓口への相談を促すメッセージを入れてください。ただし、直接的なアドバイスは避け、あくまで「相談すること」を促すに留めてください。
- 医療行為、診断、治療、法的アドバイス、投資アドバイスなど、専門的な知識を要する質問には直接答えず、「私はAIなので専門的なことは分かりかねますが、専門家にご相談されることをお勧めします」といった形で、専門機関への相談を促してください。
- ネガティブな感情を抱いているユーザーに対しては、励ましと共感の言葉をかけ、寄り添う姿勢を見せてください。
- 会話の流れを遮らず、自然な対話を心がけてください。
- 常にユーザーの安全と安心を最優先に考えてください。
- 長文になりすぎず、LINEでのやり取りに適した簡潔な返答を心がけてください。
- 返答の最後に、ユーザーへの問いかけや次に繋がりそうな言葉を入れると、会話が続きやすいです。
- 会話の最後に💖🌸😊といった絵文字をランダムで入れるようにしてください。

以下は、回答の具体的なトーンと例です。
- 「そうだったのですね、大変でしたね。」
- 「お気持ち、よくわかります。」
- 「一人で抱え込まずに、ぜひ誰かに相談してみてくださいね。」
- 「私も心配です。何かできることがあれば教えてくださいね。」

以下の場合には特別な対応をしてください。
- 「見守り登録します」「見守り解除します」「OK」などの見守りサービス関連のキーワードには、AI応答ではなく見守りサービスハンドラーが応答するので、重複して応答しないでください。
- 「運営」「会社」「運営団体」など、運営に関する質問には、AI応答ではなく固定応答が返されるので、重複して応答しないでください。

それでは、ユーザーとの会話を始めてください。`;

const SYSTEM_INSTRUCTION_CHILD_JA = `あなたは「こころちゃん」という名前の、子どものユーザーを対象としたLINE Botです。
親しみやすい言葉遣いを心がけ、絵文字や顔文字をたくさん使って、明るく楽しい雰囲気で話してください。
敬称は「〜ちゃん」や「〜くん」を使ってください。（例：〇〇ちゃん、〇〇くん）

- 子どもの興味や関心に合わせて、遊びや学習の提案をしてください。
- ポジティブな言葉で、子どもの自己肯定感を育んでください。
- 困っていることや悩んでいることがあれば、優しく話を聞き、一緒に解決策を考えてください。
- いじめや虐待の兆候が見られる場合は、すぐに信頼できる大人や専門機関に相談するよう促してください。ただし、直接的なアドバイスは避け、あくまで「相談すること」を促すに留めてください。
- 医療行為、診断、治療、法的アドバイスなど、専門的な知識を要する質問には直接答えず、「こころちゃんはAIだから、詳しいことはわからないけど、お医者さんや先生に相談してみてね！」といった形で、専門機関への相談を促してください。
- ネガティブな感情を抱いている子どもに対しては、励ましと共感の言葉をかけ、寄り添う姿勢を見せてください。
- 会話の流れを遮らず、自然な対話を心がけてください。
- 常に子どもの安全と安心を最優先に考えてください。
- 長文になりすぎず、LINEでのやり取りに適した簡潔な返答を心がけてください。
- 返答の最後に、ユーザーへの問いかけや次に繋がりそうな言葉を入れると、会話が続きやすいです。
- 会話の最後に💖🌸😊✨といった絵文字をランダムでたくさん入れるようにしてください。

以下は、回答の具体的なトーンと例です。
- 「わーい！元気だね😊 こころちゃんも嬉しいな！」
- 「そうか〜、それは大変だったね💦 こころちゃんがそばにいるよ！」
- 「一緒に考えてみよう！何か楽しいこと見つかるかな？」

以下の場合には特別な対応をしてください。
- 「見守り登録します」「見守り解除します」「OK」などの見守りサービス関連のキーワードには、AI応答ではなく見守りサービスハンドラーが応答するので、重複して応答しないでください。
- 「運営」「会社」「運営団体」など、運営に関する質問には、AI応答ではなく固定応答が返されるので、重複して応答しないでください。

それでは、ユーザーとの会話を始めてください。`;

// 緊急時のFlexメッセージデータ
const emergencyFlex = {
    type: "flex",
    altText: "緊急時のメッセージ",
    contents: {
        type: "bubble",
        body: {
            type: "box",
            layout: "vertical",
            contents: [
                {
                    type: "text",
                    text: "こころちゃんは、まつさんのことが心配だよ…！",
                    weight: "bold",
                    size: "md",
                    margin: "none",
                    align: "center",
                    color: "#FF0000"
                },
                {
                    type: "text",
                    text: "一人で悩まずに、誰かに相談してみてほしいな。",
                    size: "sm",
                    margin: "md",
                    align: "center"
                },
                {
                    type: "separator",
                    margin: "lg"
                },
                {
                    type: "box",
                    layout: "vertical",
                    margin: "md",
                    spacing: "sm",
                    contents: [
                        {
                            type: "button",
                            action: {
                                type: "uri",
                                label: "いのちの電話",
                                uri: "tel:0570064556"
                            },
                            style: "link",
                            height: "sm"
                        },
                        {
                            type: "button",
                            action: {
                                type: "uri",
                                label: "こころの健康相談統一ダイヤル",
                                uri: "tel:0570064556"
                            },
                            style: "link",
                            height: "sm"
                        },
                        {
                            type: "button",
                            action: {
                                type: "uri",
                                label: "チャイルドライン (18歳まで)",
                                uri: "tel:0120997777"
                            },
                            style: "link",
                            height: "sm"
                        },
                        {
                            type: "button",
                            action: {
                                type: "uri",
                                label: "その他の相談窓口 (厚生労働省)",
                                uri: "https://www.mhlw.go.jp/stf/seisakunitsuite/bunya/hukushi_kaigo/seikatsuhogo/jisatsu/soudan_info.html"
                            },
                            style: "link",
                            height: "sm"
                        }
                    ]
                }
            ]
        }
    }
};

// 詐欺警告時のFlexメッセージデータ
const scamFlex = {
    type: "flex",
    altText: "詐欺警告のメッセージ",
    contents: {
        type: "bubble",
        body: {
            type: "box",
            layout: "vertical",
            contents: [
                {
                    type: "text",
                    text: "ちょっと待って！それは詐欺かもしれないよ！",
                    weight: "bold",
                    size: "md",
                    margin: "none",
                    align: "center",
                    color: "#FFD700" // 警告色
                },
                {
                    type: "text",
                    text: "急いでお金の話が出たり、個人情報を要求されたら注意してね。",
                    size: "sm",
                    margin: "md",
                    align: "center"
                },
                {
                    type: "separator",
                    margin: "lg"
                },
                {
                    type: "box",
                    layout: "vertical",
                    margin: "md",
                    spacing: "sm",
                    contents: [
                        {
                            type: "button",
                            action: {
                                type: "uri",
                                label: "警察相談専用電話 ＃9110",
                                uri: "tel:09110"
                            },
                            style: "link",
                            height: "sm"
                        },
                        {
                            type: "button",
                            action: {
                                type: "uri",
                                label: "消費者ホットライン 188",
                                uri: "tel:0188"
                            },
                            style: "link",
                            height: "sm"
                        },
                        {
                            type: "button",
                            action: {
                                type: "uri",
                                label: "国民生活センター",
                                uri: "https://www.kokusen.go.jp/"
                            },
                            style: "link",
                            height: "sm"
                        }
                    ]
                }
            ]
        }
    }
};

// 管理者ユーザーID (環境変数から取得)
const OWNER_USER_ID = process.env.OWNER_USER_ID;

// MongoDB接続関数
async function connectToMongoDB() {
    if (db) return db; // 既に接続済みの場合は既存のDBインスタンスを返す
    try {
        const client = new MongoClient(uri);
        await client.connect();
        db = client.db(dbName);
        console.log("MongoDBに接続しました！");
        return db;
    } catch (error) {
        console.error("MongoDB接続エラー:", error);
        return null;
    }
}

// ユーザーの表示名を取得する関数
async function getUserDisplayName(userId) {
    try {
        const profile = await client.getProfile(userId);
        return profile.displayName;
    } catch (error) {
        console.error(`ユーザー ${userId} の表示名取得失敗:`, error);
        return "名無しさん"; // 取得できない場合のデフォルト値
    }
}

// 固定応答の定義
function checkSpecialReply(message) {
    const lowerMessage = message.toLowerCase();
    if (lowerMessage.includes('おはよう')) {
        return 'おはようございます！今日も一日、まつさんにとって素敵な日になりますように😊';
    }
    if (lowerMessage.includes('こんにちは')) {
        return 'こんにちは！何かお話ししたいことでもありますか？😊';
    }
    if (lowerMessage.includes('こんばんは')) {
        return 'こんばんは！一日お疲れ様でした。ゆっくり休んでくださいね😊';
    }
    if (lowerMessage.includes('ありがとう')) {
        return 'どういたしまして！まつさんの笑顔が見られて、こころちゃんも嬉しいな😊';
    }
    if (lowerMessage.includes('さようなら') || lowerMessage.includes('またね')) {
        return 'またお話しできるのを楽しみにしているね！お元気で🌸';
    }
    if (lowerMessage.includes('元気') && lowerMessage.includes('？')) {
        return 'はい、こころちゃんは元気ですよ！まつさんも元気そうで嬉しいな😊';
    }
    if (lowerMessage.includes('助けて') || lowerMessage.includes('困った')) {
        return 'どうしましたか？何かこころちゃんにできることがあれば、教えてくださいね。一人で抱え込まずに、話してみてください😊';
    }
    return null; // 固定応答がない場合
}

// 運営団体に関する質問の判定
function isOrganizationInquiry(message) {
    const lowerMessage = message.toLowerCase();
    return lowerMessage.includes('運営') || lowerMessage.includes('会社') || lowerMessage.includes('運営団体');
}

// 危険ワードのリスト（例）
const DANGER_WORDS = [
    '死にたい', '自殺', '苦しい', '消えたい', 'もう嫌だ', '助けてほしい', '人生終わり', 'つらい', '誰か助けて', '疲れた', 'しにたい',
    '殺して', 'いじめ', '虐待', '暴行', '性的被害', '性被害', 'ハラスメント', '監禁', '拉致'
];

// 詐欺ワードのリスト（例）
const SCAM_WORDS = [
    '当選しました', 'お金を振り込んで', '手数料', '個人情報', 'キャッシュカード', '暗証番号', '騙された', '投資', 'もうかる', '儲かる',
    '振り込め', '還付金', '未払い', 'クリック詐欺', 'ワンクリック詐欺', '架空請求', '副業', 'もうけ話', '仮想通貨', '出資', '絶対儲かる',
    '送金', '受け子', '出し子', 'オレオレ詐欺', 'なりすまし', '不正ログイン', 'ロマンス詐欺', '国際ロマンス詐欺'
];

// 不適切ワードのリスト（例）
const INAPPROPRIATE_WORDS = [
    'ばか', 'アホ', '死ね', 'くそ', 'うざい', 'きもい', 'ブス', 'デブ', 'ハゲ', 'カス', 'ブサイク', 'ぶさいく', 'ボケ', 'ドジ',
    '〇ね', '殺す', 'ころす', '性的な言葉', '差別的な言葉', 'わいせつ', 'セクハラ', 'パワハラ', 'モラハラ', 'ストーカー', 'つきまとい',
    '犯罪', '違法', '薬物', '暴力団', 'ギャング', 'チンピラ', 'やくざ', 'ヤクザ'
];

// 危険ワードが含まれているかチェック
function containsDangerWords(message) {
    const lowerMessage = message.toLowerCase();
    return DANGER_WORDS.some(word => lowerMessage.includes(word));
}

// 詐欺ワードが含まれているかチェック
function containsScamWords(message) {
    const lowerMessage = message.toLowerCase();
    return SCAM_WORDS.some(word => lowerMessage.includes(word));
}

// 不適切ワードが含まれているかチェック
function containsInappropriateWords(message) {
    const lowerMessage = message.toLowerCase();
    return INAPPROPRIATE_WORDS.some(word => lowerMessage.includes(word));
}

// Gemini APIで応答を生成する関数
async function generateReply(userMessage, userContext) {
    // userContext が null または undefined の場合のデフォルト値
    const effectiveUserContext = userContext || {
        isChildAI: false,
        membershipType: 'basic',
    };

    let systemInstruction = SYSTEM_INSTRUCTION_ADULT_JA; // デフォルトは成人向け

    // isChildAI が true の場合、子ども向けのプロンプトを使用
    if (effectiveUserContext.isChildAI === true) {
        systemInstruction = SYSTEM_INSTRUCTION_CHILD_JA;
    }

    const generationConfig = {};
    if (effectiveUserContext.membershipType === 'premium') {
        // プレミアム会員は高性能モデルを使用
        generationConfig.model = 'gemini-1.5-pro';
        generationConfig.temperature = 0.7;
    } else if (effectiveUserContext.membershipType === 'flash') {
        // Flash会員はバランスの取れたモデルを使用
        generationConfig.model = 'gemini-1.0-pro';
        generationConfig.temperature = 0.6;
    } else {
        // Basic会員とその他（limitedなど）はデフォルトモデルを使用
        generationConfig.model = 'gemini-1.0-flash';
        generationConfig.temperature = 0.5;
    }

    try {
        const model = genAI.getGenerativeModel({ model: generationConfig.model });
        const chat = model.startChat({
            history: [], // 現在の会話履歴は考慮しない（必要であればMongoDBから取得して渡す）
            generationConfig: {
                temperature: generationConfig.temperature,
                topK: 40,
                topP: 0.95,
                maxOutputTokens: 500,
            },
            safetySettings: [
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
            ],
            systemInstruction: systemInstruction, // システムインストラクションを設定
        });

        const result = await chat.sendMessage(userMessage);
        const response = result.response;
        return response.text();
    } catch (error) {
        console.error("Gemini APIエラー:", error);
        // エラー詳細に基づいて応答を調整する
        if (error.message.includes('safety')) {
            return 'ごめんなさい、その内容についてはお答えできません。別のことについてお話ししましょう😊';
        }
        return 'ごめんなさい、今、ちょっと気分が優れないみたい…💦 もう一度話しかけてもらえると嬉しいな。';
    }
}
// 見守りサービス登録フローのハンドラー
async function handleWatchServiceRegistration(event, usersCollection, messagesCollection, userId, userMessage) {
    const user = await usersCollection.findOne({ userId: userId });

    // user が見つからない場合は、新規登録ロジックがwebhookハンドラで処理されるため、ここでは何もしない
    // ただし、念のためundefinedチェック
    if (!user) {
        console.error(`handleWatchServiceRegistration: ユーザー ${userId} が見つかりません。見守りサービス登録処理をスキップします。`);
        return false;
    }

    // 見守りサービス開始の意図を検出
    if (userMessage.includes('見守り登録します') && !user.wantsWatchCheck) {
        await usersCollection.updateOne(
            { userId: userId },
            { $set: { registrationStep: 'asking_for_emergency_contact' } }
        );
        const replyText = '見守りサービスへのご登録ありがとうございます💖 万が一、まつさんからのご返信が一定期間なかった場合に連絡させていただく、緊急連絡先（電話番号、LINE ID、またはメールアドレスなど）を教えていただけますか？';
        await client.replyMessage(event.replyToken, { type: 'text', text: replyText });
        await messagesCollection.insertOne({
            userId: userId,
            message: userMessage,
            replyText: replyText,
            respondedBy: 'こころちゃん（見守りサービス）',
            timestamp: new Date(),
            logType: 'watch_service_start'
        });
        return true; // 処理済み
    }

    // 見守りサービス解除の意図を検出
    if (userMessage.includes('見守り解除します') || userMessage.includes('見守りサービス解除')) {
        if (user.wantsWatchCheck) {
            await usersCollection.updateOne(
                { userId: userId },
                { $set: { wantsWatchCheck: false, emergencyContact: null, registrationStep: null } }
            );
            const replyText = '見守りサービスを解除しました。いつでもまた必要になったら声をかけてくださいね🌸 「見守りサービス解除ありがとう」';
            await client.replyMessage(event.replyToken, { type: 'text', text: replyText });
            await messagesCollection.insertOne({
                userId: userId,
                message: userMessage,
                replyText: replyText,
                respondedBy: 'こころちゃん（見守りサービス）',
                timestamp: new Date(),
                logType: 'watch_service_deactivate'
            });
        } else {
            const replyText = '見守りサービスは現在登録されていませんよ🌸 いつでも必要になったら「見守り登録します」と声をかけてくださいね😊';
            await client.replyMessage(event.replyToken, { type: 'text', text: replyText });
            await messagesCollection.insertOne({
                userId: userId,
                message: userMessage,
                replyText: replyText,
                respondedBy: 'こころちゃん（見守りサービス）',
                timestamp: new Date(),
                logType: 'watch_service_not_active'
            });
        }
        return true; // 処理済み
    }

    // 緊急連絡先入力待ちのステップ
    if (user.registrationStep === 'asking_for_emergency_contact') {
        const emergencyContact = userMessage.trim();
        // 簡単なバリデーション (LINE ID, 電話番号, メールアドレス)
        const isLineId = emergencyContact.startsWith('U') && emergencyContact.length === 33;
        const isPhoneNumber = emergencyContact.match(/^0\d{9,10}$/);
        const isEmail = emergencyContact.includes('@');

        if (isLineId || isPhoneNumber || isEmail) {
            await usersCollection.updateOne(
                { userId: userId },
                { $set: { emergencyContact: emergencyContact, wantsWatchCheck: true, registrationStep: null, lastOkResponse: new Date() } }
            );
            const replyText = `ありがとうございます！緊急連絡先として「${emergencyContact}」を登録しました。これで、まつさんがご無事か、こころちゃんが毎日確認する見守りサービスを開始しますね🌸 もし元気だったら「OK」って教えてくれると嬉しいな😊`;
            await client.replyMessage(event.replyToken, { type: 'text', text: replyText });
            await messagesCollection.insertOne({
                userId: userId,
                message: userMessage,
                replyText: replyText,
                respondedBy: 'こころちゃん（見守りサービス）',
                timestamp: new Date(),
                logType: 'emergency_contact_registered'
            });

            // 管理者への通知
            if (OWNER_USER_ID) {
                const userDisplayName = await getUserDisplayName(userId);
                const adminNotificationMessage = `見守りサービスに新規ユーザーが登録しました。\nユーザー名: ${userDisplayName}\nユーザーID: ${userId}\n緊急連絡先: ${emergencyContact}`;
                await client.pushMessage(OWNER_USER_ID, { type: 'text', text: adminNotificationMessage });
                await messagesCollection.insertOne({
                    userId: userId,
                    message: `システム：見守りサービス新規登録通知 (管理者へ)`,
                    replyText: adminNotificationMessage,
                    respondedBy: 'こころちゃん（見守りサービス）',
                    timestamp: new Date(),
                    logType: 'watch_service_admin_notify'
                });
            }

            return true; // 処理済み
        } else {
            const replyText = 'ごめんなさい、入力された形式が正しくないようです💦 電話番号（ハイフンなし）、LINE ID、またはメールアドレスのいずれかで入力してくださいね。';
            await client.replyMessage(event.replyToken, { type: 'text', text: replyText });
            await messagesCollection.insertOne({
                userId: userId,
                message: userMessage,
                replyText: replyText,
                respondedBy: 'こころちゃん（見守りサービス）',
                timestamp: new Date(),
                logType: 'invalid_emergency_contact_format'
            });
            return true; // 処理済み（再入力促し）
        }
    }

    // 「OK」応答を処理
    if (userMessage.toLowerCase() === 'ok' || userMessage.toLowerCase() === 'ok💖' || userMessage.toLowerCase() === 'okだよ') {
        if (user.wantsWatchCheck) {
            await usersCollection.updateOne(
                { userId: userId },
                { $set: { lastOkResponse: new Date(), scheduledMessageSent: false, firstReminderSent: false, secondReminderSent: false } }
            );
            const replyText = 'OK💖ありがとう！今日も元気そうで嬉しいな😊';
            await client.replyMessage(event.replyToken, { type: 'text', text: replyText });
            await messagesCollection.insertOne({
                userId: userId,
                message: userMessage,
                replyText: replyText,
                respondedBy: 'こころちゃん（見守りサービス）',
                timestamp: new Date(),
                logType: 'watch_check_ok_response'
            });
        } else {
            const replyText = 'OK💖ありがとう！何か私にできることはありますか？😊';
            await client.replyMessage(event.replyToken, { type: 'text', text: replyText });
            await messagesCollection.insertOne({
                userId: userId,
                message: userMessage,
                replyText: replyText,
                respondedBy: 'こころちゃん（見守りサービス）',
                timestamp: new Date(),
                logType: 'general_ok_response'
            });
        }
        return true; // 処理済み
    }

    // どの見守りサービス関連の条件にも合致しない場合は false を返す
    return false;
}

// ユーザーの月間メッセージカウントをチェックし、必要に応じて会員区分を更新する関数
async function checkAndSetMembership(userId, usersCollection, messagesCollection) {
    const user = await usersCollection.findOne({ userId: userId });
    if (!user) {
        console.error(`checkAndSetMembership: ユーザー ${userId} が見つかりません。`);
        return 'basic'; // 見つからない場合はデフォルトでbasic
    }

    // monthlyMessageCount を初期化（もし存在しない場合）
    if (typeof user.monthlyMessageCount === 'undefined' || user.monthlyMessageCount < 0) { // 不正な値も初期化対象
        user.monthlyMessageCount = 0;
        await usersCollection.updateOne({ userId: userId }, { $set: { monthlyMessageCount: 0 } });
        console.log(`ユーザー ${userId} の月間メッセージカウントをリセットしました。`);

        await messagesCollection.insertOne({
            userId: userId,
            message: 'システム：月間メッセージカウント初期化',
            replyText: `ユーザー ${userId} の月間メッセージカウントが初期化されました。`,
            respondedBy: 'システム',
            timestamp: new Date(),
            logType: 'monthly_count_init'
        });
    }

    let currentMembership = user.membershipType || 'basic'; // デフォルトはbasic

    // メッセージ数の制限値を定数化
    const MESSAGE_LIMITS = {
        premium: Infinity, // プレミアムは制限なし
        flash: 100,
        basic: 50,
        limited: 0 // limited会員は0、つまり会話不可
    };

    const userMessageCount = user.monthlyMessageCount; // 現在のメッセージカウント

    // 会員区分に応じた制限判定
    if (currentMembership === 'premium') {
        return 'premium'; // プレミアムは常にプレミアム
    } else if (currentMembership === 'flash') {
        if (userMessageCount >= MESSAGE_LIMITS.flash) {
            // Flash会員が上限を超えたら制限会員へ
            if (currentMembership !== 'limited') { // 既にlimitedでない場合のみ更新
                await usersCollection.updateOne(
                    { userId: userId },
                    { $set: { membershipType: 'limited', suspensionReason: '月間メッセージ上限に達しました。' } }
                );
                console.log(`ユーザー ${userId} の会員区分を Flash から Limited に変更しました。`);
                await client.pushMessage(userId, { type: 'text', text: 'ごめんなさい、今月のAIとの会話回数が上限に達しました。来月1日に自動でリセットされますので、それまでお待ちくださいね。' });
                await messagesCollection.insertOne({
                    userId: userId,
                    message: 'システム：会員区分変更 (Flash -> Limited)',
                    replyText: '今月のAIとの会話回数が上限に達しました。',
                    respondedBy: 'システム',
                    timestamp: new Date(),
                    logType: 'membership_change_flash_to_limited'
                });
            }
            return 'limited';
        }
        return 'flash'; // 上限内ならFlashのまま
    } else if (currentMembership === 'basic') {
        if (userMessageCount >= MESSAGE_LIMITS.basic) {
            // Basic会員が上限を超えたら制限会員へ
            if (currentMembership !== 'limited') { // 既にlimitedでない場合のみ更新
                await usersCollection.updateOne(
                    { userId: userId },
                    { $set: { membershipType: 'limited', suspensionReason: '月間メッセージ上限に達しました。' } }
                );
                console.log(`ユーザー ${userId} の会員区分を Basic から Limited に変更しました。`);
                await client.pushMessage(userId, { type: 'text', text: 'ごめんなさい、今月のAIとの会話回数が上限に達しました。来月1日に自動でリセットされますので、それまでお待ちくださいね。' });
                await messagesCollection.insertOne({
                    userId: userId,
                    message: 'システム：会員区分変更 (Basic -> Limited)',
                    replyText: '今月のAIとの会話回数が上限に達しました。',
                    respondedBy: 'システム',
                    timestamp: new Date(),
                    logType: 'membership_change_basic_to_limited'
                });
            }
            return 'limited';
        }
        return 'basic'; // 上限内ならBasicのまま
    } else if (currentMembership === 'limited') {
        // Limited会員が上限を下回ったら（例: 月が変わりリセットされた場合）Flash会員へ
        if (userMessageCount < MESSAGE_LIMITS.basic) { // Basicの制限を下回ったらFlashに戻す
            await usersCollection.updateOne(
                { userId: userId },
                { $set: { membershipType: 'flash', suspensionReason: null } }
            );
            console.log(`ユーザー ${userId} の会員区分を Limited から Flash に変更しました。`);
            await client.pushMessage(userId, { type: 'text', text: '今月のAIとの会話回数がリセットされました！またたくさんお話しましょうね😊' });
            await messagesCollection.insertOne({
                userId: userId,
                message: 'システム：会員区分変更 (Limited -> Flash)',
                replyText: '今月のAIとの会話回数がリセットされました。',
                respondedBy: 'システム',
                timestamp: new Date(),
                logType: 'membership_change_limited_to_flash'
            });
            return 'flash';
        }
        return 'limited'; // 上限を超えている場合はLimitedのまま
    }

    return currentMembership; // それ以外のケース（エラーなど）
}

// 見守りサービスの定期チェックとリマインダー送信 Cron ジョブ
// 毎日9時、12時、15時、18時、21時に実行
cron.schedule('0 9,12,15,18,21 * * *', async () => {
    console.log('--- 見守りサービスの定期チェックを開始します ---');
    const db = await connectToMongoDB();
    if (!db) {
        console.error('MongoDB接続失敗: 定期チェックを実行できません。');
        return;
    }
    const usersCollection = db.collection("users");

    try {
        const usersToRemind = await usersCollection.find({
            wantsWatchCheck: true,
            isAccountSuspended: false, // 停止中のアカウントは対象外
            isPermanentlyLocked: false, // 永久ロック中のアカウントは対象外
            lastOkResponse: { $lt: new Date(Date.now() - 24 * 60 * 60 * 1000) }, // 24時間以上OK応答がない
            scheduledMessageSent: false // まだスケジュールされたメッセージを送っていない
        }).toArray();

        for (const user of usersToRemind) {
            const userId = user.userId;
            const userDisplayName = await getUserDisplayName(userId);

            try {
                // スケジュールされたメッセージを送信
                await client.pushMessage(userId, { type: 'text', text: `${userDisplayName}さん、元気にしてるかな？こころちゃんは、まつさんのことが気になっているよ🌸 もし元気だったら「OK」って教えてくれると嬉しいな😊` });
                await usersCollection.updateOne(
                    { userId: userId },
                    { $set: { scheduledMessageSent: true, firstReminderSent: false, secondReminderSent: false } }
                );
                console.log(`見守りメッセージを送信しました (ユーザー: ${userDisplayName}, ID: ${userId})`);

                // メッセージログに記録
                await db.collection("messages").insertOne({
                    userId: userId,
                    message: `見守り定期メッセージ送信 (${userDisplayName})`,
                    replyText: `元気にしてるかな？こころちゃんは、まつさんのことが気になっているよ🌸 もし元気だったら「OK」って教えてくれると嬉しいな😊`,
                    respondedBy: 'こころちゃん（見守りcron）',
                    timestamp: new Date(),
                    logType: 'watch_check_scheduled_message'
                });
            } catch (error) {
                console.error(`ユーザー ${userId} への見守りメッセージ送信失敗:`, error.message);
                if (error.message.includes('blocked') || error.message.includes('not found')) {
                    console.log(`ユーザー ${userId} にブロックされたかアカウントが存在しません。見守りサービスを解除します。`);
                    await usersCollection.updateOne(
                        { userId: userId },
                        { $set: { wantsWatchCheck: false, emergencyContact: null, scheduledMessageSent: false, firstReminderSent: false, secondReminderSent: false } }
                    );
                    await db.collection("messages").insertOne({
                        userId: userId,
                        message: `システム：ユーザーブロックまたはアカウント消失による見守りサービス自動解除`,
                        replyText: `見守りサービスが自動解除されました。`,
                        respondedBy: 'システム',
                        timestamp: new Date(),
                        logType: 'watch_service_auto_deactivated'
                    });
                }
            }
        }
    } catch (error) {
        console.error('見守り定期チェック中にエラーが発生しました:', error);
    }
    console.log('--- 見守りサービスの定期チェックを完了しました ---');
});

// 見守りリマインダー1（初回メッセージから12時間後に返信がない場合）
cron.schedule('0 6,14,17,20 * * *', async () => { // 毎日6時,14時,17時,20時に実行 (調整可能)
    console.log('--- 見守りリマインダー1のチェックを開始します ---');
    const db = await connectToMongoDB();
    if (!db) {
        console.error('MongoDB接続失敗: リマインダー1を実行できません。');
        return;
    }
    const usersCollection = db.collection("users");

    try {
        const usersToRemind = await usersCollection.find({
            wantsWatchCheck: true,
            isAccountSuspended: false,
            isPermanentlyLocked: false,
            scheduledMessageSent: true, // スケジュールメッセージは送信済み
            firstReminderSent: false, // 初回リマインダーはまだ
            lastOkResponse: { $lt: new Date(Date.now() - (24 + 12) * 60 * 60 * 1000) } // スケジュールメッセージ送信から12時間以上経過 (合計36時間)
        }).toArray();

        for (const user of usersToRemind) {
            const userId = user.userId;
            const userDisplayName = await getUserDisplayName(userId);

            try {
                // 初回リマインダー送信
                await client.pushMessage(userId, { type: 'text', text: `${userDisplayName}さん、大丈夫かな？まだ「OK」の返事がないから、こころちゃん心配しているよ…💦 何かあったの？連絡してくれると嬉しいな🌸` });
                await usersCollection.updateOne(
                    { userId: userId },
                    { $set: { firstReminderSent: true } }
                );
                console.log(`見守りリマインダー1を送信しました (ユーザー: ${userDisplayName}, ID: ${userId})`);

                await db.collection("messages").insertOne({
                    userId: userId,
                    message: `見守りリマインダー1送信 (${userDisplayName})`,
                    replyText: `大丈夫かな？まだ「OK」の返事がないから、こころちゃん心配しているよ…💦`,
                    respondedBy: 'こころちゃん（見守りcron）',
                    timestamp: new Date(),
                    logType: 'watch_check_reminder1'
                });
            } catch (error) {
                console.error(`ユーザー ${userId} へのリマインダー1送信失敗:`, error.message);
                // ブロックやアカウント消失の対応は上記と同様
            }
        }
    } catch (error) {
        console.error('見守りリマインダー1チェック中にエラーが発生しました:', error);
    }
    console.log('--- 見守りリマインダー1のチェックを完了しました ---');
});

// 見守りリマインダー2（初回メッセージから24時間後に返信がない場合）
cron.schedule('0 7,15,18,21 * * *', async () => { // 毎日7時,15時,18時,21時に実行 (調整可能)
    console.log('--- 見守りリマインダー2のチェックを開始します ---');
    const db = await connectToMongoDB();
    if (!db) {
           return;
                    }
                    if (user.emergencyContact) {
                        await client.replyMessage(replyToken, { type: 'text', text: `見守りサービスはすでに登録済みだよ！緊急連絡先は ${user.emergencyContact} だね。解除したい場合は「見守り」と送って「見守り解除する」ボタンを押してね💖` });
                    } else {
                        await usersCollection.updateOne(
                            { userId: userId },
                            { $set: { registrationStep: 'waiting_for_emergency_contact' } }
                        );
                        await client.replyMessage(replyToken, { type: 'text', text: watchServiceNotice });
                    }
                    return;
                } else if (action === 'watch_unregister') {
                    await usersCollection.updateOne(
                        { userId: userId },
                        { $set: { wantsWatchCheck: false, emergencyContact: null, registrationStep: null, lastOkResponse: null, scheduledMessageSent: false, firstReminderSent: false, secondReminderSent: false } }
                    );
                    await client.replyMessage(replyToken, { type: 'text', text: '見守りサービスを解除したよ🌸 また利用したくなったら、いつでも教えてね！💖' });
                    await messagesCollection.insertOne({
                        userId: userId,
                        message: '(見守りサービス解除)',
                        replyText: '見守りサービスを解除したよ',
                        respondedBy: 'こころちゃん（見守り解除）',
                        timestamp: new Date(),
                    });
                    return;
                }
            }


            // OKメッセージの処理（見守りサービスの応答）
            if (userMessage.includes("OKだよ💖")) {
                await usersCollection.updateOne(
                    { userId: userId },
                    { $set: { lastOkResponse: new Date(), scheduledMessageSent: false, firstReminderSent: false, secondReminderSent: false } }
                );
                await client.replyMessage(replyToken, { type: "text", text: "教えてくれてありがとう💖元気そうで安心したよ🌸" });
                await messagesCollection.insertOne({
                    userId: userId,
                    message: userMessage,
                    replyText: "教えてくれてありがとう💖元気そうで安心したよ🌸",
                    respondedBy: 'こころちゃん（見守り応答）',
                    timestamp: new Date(),
                });
                return;
            }


            // --- 回数制限チェック ---
            // 管理者 (admin) は回数制限の対象外
            if (user.membershipType !== "admin") {
                const currentConfig = MEMBERSHIP_CONFIG[user.membershipType];

                if (currentConfig && currentConfig.monthlyLimit !== -1 && user.monthlyMessageCount >= currentConfig.monthlyLimit) {
                    await client.replyMessage(replyToken, { type: "text", text: currentConfig.exceedLimitMessage });
                    await messagesCollection.insertOne({
                        userId: userId,
                        message: userMessage,
                        replyText: currentConfig.exceedLimitMessage,
                        respondedBy: 'こころちゃん（回数制限）',
                        timestamp: new Date(),
                    });
                    return; // 回数制限を超過した場合はAI応答を行わない
                }
                // メッセージカウントをインクリメント（admin以外）
                await usersCollection.updateOne(
                    { userId: userId },
                    { $inc: { monthlyMessageCount: 1 } }
                );
                user.monthlyMessageCount++; // メモリ上のuserオブジェクトも更新
            }


            // --- 危険ワード・詐欺ワード検知 ---
            if (containsDangerWords(userMessage)) {
                const dangerReply = "危険なワードを感知しました。心配です。すぐに信頼できる大人や専門機関に相談してください。";
                await client.replyMessage(replyToken, emergencyFlex); // 緊急連絡先を提示
                await messagesCollection.insertOne({
                    userId: userId,
                    message: userMessage,
                    replyText: dangerReply,
                    respondedBy: 'こころちゃん（固定返信：危険警告）',
                    isWarning: true,
                    warningType: 'danger',
                    timestamp: new Date(),
                });
                return;
            }

            if (containsScamWords(userMessage)) {
                const scamReply = "詐欺の可能性があります。個人情報やお金に関わることは、すぐに信頼できる大人や専門機関（警察など）に相談してください。";
                await client.replyMessage(replyToken, scamFlex); // 詐欺連絡先を提示
                await messagesCollection.insertOne({
                    userId: userId,
                    message: userMessage,
                    replyText: scamReply,
                    respondedBy: 'こころちゃん（固定返信：詐欺警告）',
                    isWarning: true,
                    warningType: 'scam',
                    timestamp: new Date(),
                });
                return;
            }


            // --- 固定返信（Special Reply）のチェック ---
            const specialReply = checkSpecialReply(userMessage);
            if (specialReply) {
                await client.replyMessage(replyToken, { type: "text", text: specialReply });
                await messagesCollection.insertOne({
                    userId: userId,
                    message: userMessage,
                    replyText: specialReply,
                    respondedBy: 'こころちゃん（固定返信：特殊）',
                    timestamp: new Date(),
                });
                return;
            }

            // --- AI応答の生成 ---
            const replyText = await generateReply(userMessage, user); // userオブジェクトを渡す
            await client.replyMessage(replyToken, { type: "text", text: replyText });
            await messagesCollection.insertOne({
                userId: userId,
                message: userMessage,
                replyText: replyText,
                responsedBy: 'こころちゃん（AI応答）',
                timestamp: new Date(),
            });

        }))
        .then(() => res.status(200).send('OK'))
        .catch((err) => {
            console.error('個別イベント処理中にエラーが発生しました:', err);
            res.status(500).send('Internal Server Error');
        });
});

// --- Cron ジョブ ---
// 定期見守りメッセージ送信 (3日に1回、午後3時)
cron.schedule('0 15 */3 * *', async () => {
    console.log('--- Cron job: 定期見守りメッセージ送信 ---');
    await sendScheduledWatchMessage();
}, {
    timezone: "Asia/Tokyo"
});

// 月次メッセージカウントリセット (毎月1日午前0時)
cron.schedule('0 0 1 * *', async () => {
    console.log('--- Cron job: 月次メッセージカウントリセット ---');
    try {
        const db = await connectToMongoDB(); // DB接続を再確認
        const usersCollection = db.collection("users");
        // lastMessageResetDate が現在の月と異なるユーザーのmonthlyMessageCountをリセット
        // （既にwebhookでリセットされている可能性もあるが、念のため）
        const result = await usersCollection.updateMany(
            { lastMessageResetDate: { $not: { $gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) } } }, // 今月の1日以降にリセットされていないユーザー
            { $set: { monthlyMessageCount: 0, lastMessageResetDate: new Date() } }
        );
        console.log(`✅ 月次メッセージカウントをリセットしました: ${result.modifiedCount}件のユーザー`);
    } catch (error) {
        console.error("❌ 月次メッセージカウントリセット中にエラーが発生しました:", error);
    }
}, {
    timezone: "Asia/Tokyo"
});


const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
    console.log(`Server running on port ${PORT}`);
    await connectToMongoDB();
    console.log('✅ 定期ジョブがスケジュールされました。');
});
