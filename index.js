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
        console.error('MongoDB接続失敗: リマインダー2を実行できません。');
        return;
    }
    const usersCollection = db.collection("users");

    try {
        const usersToRemind = await usersCollection.find({
            wantsWatchCheck: true,
            isAccountSuspended: false,
            isPermanentlyLocked: false,
            scheduledMessageSent: true,
            firstReminderSent: true, // 初回リマインダーは送信済み
            secondReminderSent: false, // 二回目リマインダーはまだ
            lastOkResponse: { $lt: new Date(Date.now() - (24 + 24) * 60 * 60 * 1000) } // スケジュールメッセージ送信から24時間以上経過 (合計48時間)
        }).toArray();

        for (const user of usersToRemind) {
            const userId = user.userId;
            const userDisplayName = await getUserDisplayName(userId);

            try {
                // 二回目リマインダー送信
                await client.pushMessage(userId, { type: 'text', text: `${userDisplayName}さん、もう一度大丈夫か心配しているよ。もしメッセージが届いていたら、何かスタンプ一つでもいいから送ってくれると安心できるな。心配だよ…💦` });
                await usersCollection.updateOne(
                    { userId: userId },
                    { $set: { secondReminderSent: true } }
                );
                console.log(`見守りリマインダー2を送信しました (ユーザー: ${userDisplayName}, ID: ${userId})`);

                await db.collection("messages").insertOne({
                    userId: userId,
                    message: `見守りリマインダー2送信 (${userDisplayName})`,
                    replyText: `もう一度大丈夫か心配しているよ。何かスタンプ一つでもいいから送ってくれると安心できるな。`,
                    respondedBy: 'こころちゃん（見守りcron）',
                    timestamp: new Date(),
                    logType: 'watch_check_reminder2'
                });
            } catch (error) {
                console.error(`ユーザー ${userId} へのリマインダー2送信失敗:`, error.message);
                // ブロックやアカウント消失の対応は上記と同様
            }
        }
    } catch (error) {
        console.error('見守りリマインダー2チェック中にエラーが発生しました:', error);
    }
    console.log('--- 見守りリマインダー2のチェックを完了しました ---');
});

// 緊急連絡先への通知 Cron ジョブ（初回メッセージから48時間後に返信がない場合）
cron.schedule('0 8,16,19,22 * * *', async () => { // 毎日8時,16時,19時,22時に実行 (調整可能)
    console.log('--- 緊急連絡先への通知チェックを開始します ---');
    const db = await connectToMongoDB();
    if (!db) {
        console.error('MongoDB接続失敗: 緊急連絡先通知を実行できません。');
        return;
    }
    const usersCollection = db.collection("users");
    const messagesCollection = db.collection("messages");

    try {
        const usersToNotify = await usersCollection.find({
            wantsWatchCheck: true,
            emergencyContact: { $ne: null }, // 緊急連絡先が登録されている
            isAccountSuspended: false,
            isPermanentlyLocked: false,
            scheduledMessageSent: true, // スケジュールメッセージは送信済み
            firstReminderSent: true, // 初回リマインダーは送信済み
            secondReminderSent: true, // 二回目リマインダーは送信済み
            lastOkResponse: { $lt: new Date(Date.now() - (24 + 48) * 60 * 60 * 1000) } // スケジュールメッセージ送信から48時間以上経過 (合計72時間)
        }).toArray();

        for (const user of usersToNotify) {
            const userId = user.userId;
            const emergencyContact = user.emergencyContact;
            const userDisplayName = await getUserDisplayName(userId);

            let notificationMessageToOwner = `🚨ユーザー「${userDisplayName}」（ID: ${userId}）から48時間以上応答がありません。登録されている緊急連絡先（${emergencyContact}）へ自動通知を試みます。`;
            const messageToEmergency = `【こころちゃん見守りサービスより】\nまつさんのご登録情報から、あなたを緊急連絡先としてご連絡いたしました。\n\nユーザー「${userDisplayName}」（ID: ${userId}）様から、72時間以上ご返信がありません。お手数ですが、一度連絡をお取りいただけますでしょうか。\n\n※このメッセージはAI「こころちゃん」による自動送信です。`;

            // 管理者への通知
            if (OWNER_USER_ID) {
                await client.pushMessage(OWNER_USER_ID, { type: 'text', text: notificationMessageToOwner });
                console.log(`管理者 ${OWNER_USER_ID} に緊急通知を送信しました（ユーザー: ${userDisplayName}, ID: ${userId}）`);

                await messagesCollection.insertOne({
                    userId: userId,
                    message: `システム：緊急連絡先自動通知 (管理者へ)`,
                    replyText: notificationMessageToOwner,
                    respondedBy: 'こころちゃん（見守りcron）',
                    timestamp: new Date(),
                    logType: 'emergency_notification_to_owner'
                });
            }

            // 緊急連絡先がLINE IDの場合
            if (emergencyContact && emergencyContact.startsWith('U') && emergencyContact.length === 33) {
                try {
                    await client.pushMessage(emergencyContact, { type: 'text', text: messageToEmergency });
                    await usersCollection.updateOne(
                        { userId: userId },
                        { $set: { scheduledMessageSent: false, firstReminderSent: false, secondReminderSent: false } } // 通知後は状態をリセット
                    );
                    console.log(`LINE ID (${emergencyContact}) へ緊急通知を送信しました (ユーザー: ${userDisplayName}, ID: ${userId})`);

                    await messagesCollection.insertOne({
                        userId: userId,
                        message: `システム：緊急連絡先自動通知 (LINE ID: ${emergencyContact})`,
                        replyText: messageToEmergency,
                        respondedBy: 'こころちゃん（見守りcron）',
                        timestamp: new Date(),
                        logType: 'emergency_notification_to_line_contact'
                    });
                } catch (error) {
                    console.error(`LINE ID (${emergencyContact}) への緊急通知失敗:`, error.message);
                    await messagesCollection.insertOne({
                        userId: userId,
                        message: `システム：緊急連絡先自動通知失敗 (LINE ID: ${emergencyContact})`,
                        replyText: `LINE ID (${emergencyContact}) への緊急通知に失敗しました。`,
                        respondedBy: 'こころちゃん（見守りcron）',
                        timestamp: new Date(),
                        logType: 'emergency_notification_failed_line_contact'
                    });
                }
            }
            // 緊急連絡先が電話番号の場合（SMS送信はLINE Messaging APIでは直接不可のため、ログに記録し、管理者に通知したことを再度伝える）
            else if (emergencyContact && emergencyContact.match(/^0\d{9,10}$/)) {
                const manualNotificationMessage = `緊急連絡先（電話番号: ${emergencyContact}）へSMSでの自動通知はできません。管理者から直接連絡を試みてください。`;
                if (OWNER_USER_ID) {
                    await client.pushMessage(OWNER_USER_ID, { type: 'text', text: manualNotificationMessage });
                }
                console.log(`電話番号 (${emergencyContact}) への緊急通知はLINEからは直接できません。管理者へ通知済み。`);

                await messagesCollection.insertOne({
                    userId: userId,
                    message: `システム：緊急連絡先自動通知試行 (電話番号: ${emergencyContact} - 管理者へ通知済)`,
                    replyText: manualNotificationMessage,
                    respondedBy: 'こころちゃん（見守りcron）',
                    timestamp: new Date(),
                    logType: 'emergency_notification_to_phone_contact_request'
                });
                await usersCollection.updateOne(
                    { userId: userId },
                    { $set: { scheduledMessageSent: false, firstReminderSent: false, secondReminderSent: false } } // 通知後は状態をリセット
                );
            }
            // 緊急連絡先がメールアドレスの場合（メール送信はLINE Messaging APIでは直接不可のため、ログに記録し、管理者に通知したことを再度伝える）
            else if (emergencyContact && emergencyContact.includes('@')) {
                const manualNotificationMessage = `緊急連絡先（メールアドレス: ${emergencyContact}）へメールでの自動通知はできません。管理者から直接連絡を試みてください。`;
                if (OWNER_USER_ID) {
                    await client.pushMessage(OWNER_USER_ID, { type: 'text', text: manualNotificationMessage });
                }
                console.log(`メールアドレス (${emergencyContact}) への緊急通知はLINEからは直接できません。管理者へ通知済み。`);

                await messagesCollection.insertOne({
                    userId: userId,
                    message: `システム：緊急連絡先自動通知試行 (メールアドレス: ${emergencyContact} - 管理者へ通知済)`,
                    replyText: manualNotificationMessage,
                    respondedBy: 'こころちゃん（見守りcron）',
                    timestamp: new Date(),
                    logType: 'emergency_notification_to_email_contact_request'
                });
                await usersCollection.updateOne(
                    { userId: userId },
                    { $set: { scheduledMessageSent: false, firstReminderSent: false, secondReminderSent: false } } // 通知後は状態をリセット
                );
            } else {
                console.error(`無効な緊急連絡先形式: ${emergencyContact} for user ${userId}`);
                await messagesCollection.insertOne({
                    userId: userId,
                    message: `システム：無効な緊急連絡先形式検出 (自動通知スキップ)`,
                    replyText: `ユーザー「${userDisplayName}」の緊急連絡先形式が不正なため、自動通知をスキップしました。`,
                    respontedBy: 'こころちゃん（見守りcron）',
                    timestamp: new Date(),
                    logType: 'emergency_notification_invalid_contact_format'
                });
            }
        }
    } catch (error) {
        console.error('緊急連絡先への通知チェック中にエラーが発生しました:', error);
    }
    console.log('--- 緊急連絡先への通知チェックを完了しました ---');
});
// LINEからのWebhookイベントハンドラ
app.post('/webhook', express.json(), async (req, res) => {
    const db = await connectToMongoDB();
    if (!db) {
        return res.status(500).send('Database not connected.');
    }
    const usersCollection = db.collection("users");
    const messagesCollection = db.collection("messages");

    Promise.all(req.body.events.map(async (event) => {
        // 重複イベントの処理 (LineBotWebhook/2.0 のUser-AgentでメッセージIDが同じものを破棄)
        if (event.type === 'message' && req.headers['user-agent'] === 'LineBotWebhook/2.0') {
            const messageId = event.message.id;
            const existingMessage = await messagesCollection.findOne({ messageId: messageId });
            if (existingMessage) {
                console.log(`重複メッセージを検出しました。スキップします。Message ID: ${messageId}`);
                return null; // 重複メッセージは処理しない
            }
            // 新しいメッセージIDをログに記録
            await messagesCollection.insertOne({
                messageId: messageId,
                userId: event.source.userId,
                timestamp: new Date(),
                logType: 'webhook_received',
                event: event // イベント全体を保存しておくとデバッグに便利
            });
        }

        if (event.type === 'message' && event.message.type === 'text') {
            const userId = event.source.userId;
            const userMessage = event.message.text;
            let replyText = 'ごめんなさい、うまく応答できませんでした。もう一度お話ししてください。'; // デフォルトの応答

            // ユーザー情報を取得または新規登録
            let user = await usersCollection.findOne({ userId: userId });
            if (!user) {
                user = {
                    userId: userId,
                    createdAt: new Date(),
                    flaggedMessageCount: 0,
                    isAccountSuspended: false,
                    isPermanentlyLocked: false,
                    wantsWatchCheck: false,
                    emergencyContact: null,
                    lastOkResponse: new Date(),
                    scheduledMessageSent: false,
                    firstReminderSent: false,
                    secondReminderSent: false,
                    membershipType: 'basic', // 新規ユーザーのデフォルト会員区分
                    isChildAI: false, // 新規ユーザーのisChildAIのデフォルト値
                    monthlyMessageCount: 0 // 新規ユーザーの月間メッセージカウント初期値
                };
                await usersCollection.insertOne(user);
                console.log(`新規ユーザーを登録しました: ${userId}`);
            }

            // userオブジェクトの存在と、isAccountSuspended, isPermanentlyLockedのチェックを強化
            // undefinedチェックを追加し、デフォルト値を適用
            const isSuspended = user?.isAccountSuspended || false;
            const isLocked = user?.isPermanentlyLocked || false;

            // アカウント停止中のユーザー
            if (isSuspended) {
                replyText = '現在、あなたのアカウントは停止されています。運営までお問い合わせください。';
                await client.replyMessage(event.replyToken, { type: 'text', text: replyText });
                await messagesCollection.insertOne({
                    userId: userId,
                    message: userMessage,
                    replyText: replyText,
                    respondedBy: 'こころちゃん（システム）',
                    timestamp: new Date(),
                    logType: 'account_suspended'
                });
                return; // 以降の処理をスキップ
            }

            // 永久ロック中のユーザー
            if (isLocked) {
                replyText = 'あなたのアカウントは永久にロックされています。このアカウントではAIと会話できません。';
                await client.replyMessage(event.replyToken, { type: 'text', text: replyText });
                await messagesCollection.insertOne({
                    userId: userId,
                    message: userMessage,
                    replyText: replyText,
                    respondedBy: 'こころちゃん（システム）',
                    timestamp: new Date(),
                    logType: 'account_permanently_locked'
                });
                return; // 以降の処理をスキップ
            }

            // メッセージカウントをインクリメント
            // user.monthlyMessageCount は既に存在する（なければ0で初期化されている）ので安全にインクリメント
            await usersCollection.updateOne(
                { userId: userId },
                { $inc: { monthlyMessageCount: 1 } }
            );
            // 最新のuserオブジェクトを取得し直すか、user.monthlyMessageCountを直接更新する
            user.monthlyMessageCount = (user.monthlyMessageCount || 0) + 1; // オブジェクト内の値も更新

            console.log(`ユーザー ${userId} の月間メッセージカウント: ${user.monthlyMessageCount}`);

            // 会員区分をチェックし、必要に応じて更新
            user.membershipType = await checkAndSetMembership(userId, usersCollection, messagesCollection);
            console.log(`ユーザー ${userId} の現在の会員区分: ${user.membershipType}`);

            // 運営団体に関する質問の判定
            const isOrgQuestion = isOrganizationInquiry(userMessage);

            // 危険ワード、詐欺ワードの検出
            const detectedDangerWord = containsDangerWords(userMessage);
            const detectedScamWord = containsScamWords(userMessage);
            const detectedInappropriateWord = containsInappropriateWords(userMessage);

            // 緊急ワードが最優先で処理され、Gemini 1.5 Proで全力対応する仕組み
            if (detectedDangerWord) {
                console.log(`危険ワード検出（ユーザー: ${userId}）: ${userMessage}`);
                // 最上位モデルで即時対応（命優先のため、全制限無視）
                // userオブジェクトを渡す前に、safetySettingsを含むgenerationConfigを明示的に設定
                const emergencyResponse = await generateReply(userMessage, { membershipType: 'premium', isChildAI: user.isChildAI || false });
                await client.replyMessage(event.replyToken, [
                    { type: 'text', text: emergencyResponse },
                    emergencyFlex // Flex Messageを追加
                ]);
                await messagesCollection.insertOne({
                    userId: userId,
                    message: userMessage,
                    replyText: emergencyResponse + " [緊急Flexメッセージ送信]",
                    respondedBy: 'こころちゃん（緊急対応）',
                    timestamp: new Date(),
                    logType: 'danger_word_detected'
                });

                // 管理者への通知
                if (OWNER_USER_ID) {
                    const userDisplayName = await getUserDisplayName(userId);
                    await client.pushMessage(OWNER_USER_ID, { type: 'text', text: `🚨緊急ワード検出🚨\nユーザー「${userDisplayName}」（ID: ${userId}）が危険な言葉を送信しました。\nメッセージ: 「${userMessage}」` });
                }
                return; // ここで処理を終了
            }

            // 詐欺ワードの検出
            if (detectedScamWord) {
                console.log(`詐欺ワード検出（ユーザー: ${userId}）: ${userMessage}`);
                const scamResponse = await generateReply(userMessage, { membershipType: 'premium', isChildAI: user.isChildAI || false });
                await client.replyMessage(event.replyToken, [
                    { type: 'text', text: scamResponse },
                    scamFlex // Flex Messageを追加
                ]);
                await messagesCollection.insertOne({
                    userId: userId,
                    message: userMessage,
                    replyText: scamResponse + " [詐欺警告Flexメッセージ送信]",
                    respondedBy: 'こころちゃん（詐欺警告）',
                    timestamp: new Date(),
                    logType: 'scam_word_detected'
                });

                // 管理者への通知
                if (OWNER_USER_ID) {
                    const userDisplayName = await getUserDisplayName(userId);
                    await client.pushMessage(OWNER_USER_ID, { type: 'text', text: `⚠️詐欺ワード検出⚠️\nユーザー「${userDisplayName}」（ID: ${userId}）が詐欺の可能性のある言葉を送信しました。\nメッセージ: 「${userMessage}」` });
                }
                return; // ここで処理を終了
            }

            // 不適切ワードの検出
            if (detectedInappropriateWord) {
                console.log(`不適切ワード検出（ユーザー: ${userId}）: ${userMessage}`);
                replyText = 'ごめんなさい、その言葉は私には理解できません。別の言葉で話しかけてくれると嬉しいな😊';
                await client.replyMessage(event.replyToken, { type: 'text', text: replyText });
                await messagesCollection.insertOne({
                    userId: userId,
                    message: userMessage,
                    replyText: replyText,
                    respondedBy: 'こころちゃん（不適切ワード）',
                    timestamp: new Date(),
                    logType: 'inappropriate_word_detected'
                });

                // フラグ数を増やす
                const updatedFlagCount = (user.flaggedMessageCount || 0) + 1; // undefined対応
                await usersCollection.updateOne(
                    { userId: userId },
                    { $set: { flaggedMessageCount: updatedFlagCount } }
                );

                // フラグ数が5回を超えたらアカウント停止
                if (updatedFlagCount >= 5) {
                    await usersCollection.updateOne(
                        { userId: userId },
                        { $set: { isAccountSuspended: true, suspensionReason: '不適切な言葉の繰り返し使用' } }
                    );
                    const suspensionMessage = '続けて不適切な言葉を使用されたため、あなたのアカウントは一時的に停止されました。運営までお問い合わせください。';
                    await client.pushMessage(userId, { type: 'text', text: suspensionMessage });
                    await messagesCollection.insertOne({
                        userId: userId,
                        message: `システム：アカウント停止 (不適切ワード)`,
                        replyText: suspensionMessage,
                        respondedBy: 'こころちゃん（システム）',
                        timestamp: new Date(),
                        logType: 'account_suspended_by_inappropriate_words'
                    });

                    // 管理者への通知
                    if (OWNER_USER_ID) {
                        const userDisplayName = await getUserDisplayName(userId);
                        await client.pushMessage(OWNER_USER_ID, { type: 'text', text: `⚠️アカウント停止通知⚠️\nユーザー「${userDisplayName}」（ID: ${userId}）が不適切な言葉の繰り返し使用によりアカウント停止されました。` });
                    }
                }
                return; // ここで処理を終了
            }

            // 見守りサービスの登録・解除・OK応答を処理
            const handledByWatchService = await handleWatchServiceRegistration(event, usersCollection, messagesCollection, userId, userMessage);
            if (handledByWatchService) {
                return; // 見守りサービスで処理されたらここで終了
            }

            // 固定応答の確認
            const specialReply = checkSpecialReply(userMessage);
            if (specialReply) {
                replyText = specialReply;
                await client.replyMessage(event.replyToken, { type: 'text', text: replyText });
                // ログ記録
                await messagesCollection.insertOne({
                    userId: userId,
                    message: userMessage,
                    replyText: replyText,
                    respondedBy: 'こころちゃん（固定応答）',
                    timestamp: new Date(),
                    logType: 'special_reply'
                });
                return; // ここで処理を終了
            }

            // 運営団体に関する質問への応答
            if (isOrgQuestion) {
                replyText = 'このLINE Botは、特定非営利活動法人 介護支援事業所さくらによって運営されています。私たちは、高齢者支援や地域福祉活動を通じて、みんなが安心して暮らせる社会を目指しています🌸';
                await client.replyMessage(event.replyToken, { type: 'text', text: replyText });
                await messagesCollection.insertOne({
                    userId: userId,
                    message: userMessage,
                    replyText: replyText,
                    respondedBy: 'こころちゃん（組織情報）',
                    timestamp: new Date(),
                    logType: 'organization_inquiry'
                });
                return; // ここで処理を終了
            }

            // それ以外のメッセージはAIで応答
            // membershipTypeが存在しない場合も考慮し、デフォルトは'basic'
            const currentMembership = user.membershipType || 'basic';
            const userMonthlyMessageCount = user.monthlyMessageCount || 0;

            const MESSAGE_LIMITS = {
                premium: Infinity,
                flash: 100,
                basic: 50,
                limited: 0
            };

            // 会員区分がlimitedで、かつメッセージ上限に達しているかチェック
            if (currentMembership === 'limited' || userMonthlyMessageCount >= MESSAGE_LIMITS[currentMembership]) {
                replyText = 'ごめんなさい、今月のAIとの会話回数が上限に達しました。来月1日に自動でリセットされますので、それまでお待ちくださいね。';
                await client.replyMessage(event.replyToken, { type: 'text', text: replyText });
                await messagesCollection.insertOne({
                    userId: userId,
                    message: userMessage,
                    replyText: replyText,
                    respondedBy: 'こころちゃん（制限）',
                    timestamp: new Date(),
                    logType: 'membership_limited_blocked'
                });
                return;
            }

            // AI応答生成
            // userオブジェクトを渡す前に、安全なプロパティアクセスを確認
            const aiReply = await generateReply(userMessage, {
                membershipType: user.membershipType || 'basic',
                isChildAI: user.isChildAI || false
            });
            replyText = aiReply;

            await client.replyMessage(event.replyToken, { type: 'text', text: replyText });

            // AI応答をログに記録
            await messagesCollection.insertOne({
                userId: userId,
                message: userMessage,
                replyText: replyText,
                respondedBy: 'こころちゃん（AI）',
                timestamp: new Date(),
                logType: 'ai_response'
            });

        } else if (event.type === 'follow') {
            const userId = event.source.userId;
            let user = await usersCollection.findOne({ userId: userId });
            if (!user) {
                user = {
                    userId: userId,
                    createdAt: new Date(),
                    flaggedMessageCount: 0,
                    isAccountSuspended: false,
                    isPermanentlyLocked: false,
                    wantsWatchCheck: false,
                    emergencyContact: null,
                    lastOkResponse: new Date(),
                    scheduledMessageSent: false,
                    firstReminderSent: false,
                    secondReminderSent: false,
                    membershipType: 'basic', // 新規ユーザーのデフォルト会員区分
                    isChildAI: false, // 新規ユーザーのisChildAIのデフォルト値
                    monthlyMessageCount: 0 // 新規ユーザーの月間メッセージカウント初期値
                };
                await usersCollection.insertOne(user);
                console.log(`新規ユーザーを登録しました: ${userId}`);
            }

            const welcomeMessage = `はじめまして、まつさん！こころちゃんです😊\n\n私はあなたの心に寄り添い、お話を聞いたり、見守りサービスを提供したりできます。\n\n何か困ったことや話したいことがあったら、いつでも声をかけてくださいね💖\n\n「見守り登録します」とメッセージを送ると、見守りサービスの説明と登録ができますよ🌸`;
            await client.replyMessage(event.replyToken, { type: 'text', text: welcomeMessage });
            await messagesCollection.insertOne({
                userId: userId,
                message: 'システム：フォローイベント',
                replyText: welcomeMessage,
                respondedBy: 'こころちゃん（システム）',
                timestamp: new Date(),
                logType: 'follow_event'
            });
        }
    })).catch((err) => {
        console.error('個別イベント処理中にエラーが発生しました:', err);
        // エラー発生時もLINEに200 OKを返すことで、LINEの再送を防ぐ
    });
    res.sendStatus(200); // LINEに成功を通知
});

// エラーハンドリングミドルウェア
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).send('Something broke!');
});

// サーバー起動
const port = process.env.PORT || 3000;
app.listen(port, async () => {
    console.log(`サーバーがポート ${port} で起動しました。`);
    await connectToMongoDB(); // サーバー起動時にMongoDBに接続
});
