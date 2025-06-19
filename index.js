// index.js (修正・確認済みコード)

// 環境変数の読み込み
require('dotenv').config();

const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const mongoose = require('mongoose');
const { Client, middleware } = require('@line/bot-sdk'); // LINE SDKのClientとmiddlewareを正しくインポート
const OpenAIApi = require('openai'); // OpenAI SDKのClientをインポート

const app = express();
const PORT = process.env.PORT || 3000;

// Mongoose DeprecationWarningの抑制 (任意)
// Mongoose 7でstrictQueryのデフォルトがfalseに戻るため、現在の挙動を維持したい場合に設定
mongoose.set('strictQuery', false);

// MongoDB接続
mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log('MongoDB connected...'))
    .catch(err => console.error('MongoDB connection error:', err));

// Mongoose SchemaとModelの定義
const UserSchema = new mongoose.Schema({
    userId: { type: String, required: true, unique: true },
    membershipType: { type: String, default: 'free' },
    messageCount: { type: Number, default: 0 },
    lastMessageDate: { type: Date, default: Date.now },
    registrationStep: { type: String, default: 'none' }, // 'none', 'waiting_for_phone', 'registered'
    phoneNumber: { type: String, default: '' },
    guardianName: { type: String, default: '' }, // 見守り対象者の名前
    guardianRelationship: { type: String, default: '' }, // 見守り対象者との関係
    guardianPhone: { type: String, default: '' }, // 見守り対象者の電話番号
    registerDate: { type: Date, default: Date.now },
    lineDisplayName: { type: String }, // LINE表示名を追加
    profilePictureUrl: { type: String }, // プロフィール画像URLを追加
});
const User = mongoose.model('User', UserSchema);

const MessageSchema = new mongoose.Schema({
    userId: String,
    message: String,
    replyText: String,
    timestamp: { type: Date, default: Date.now },
    responsedBy: String, // 'AI' or 'こころちゃん（固定返信：〇〇）'
    isWarning: { type: Boolean, default: false }, // 危険なワード、詐欺などか
    warningType: String, // 'danger', 'scam', 'inappropriate', 'rate_limit'
});
const Message = mongoose.model('Message', MessageSchema);

// LINE Bot設定
const config = {
    channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
    channelSecret: process.env.LINE_CHANNEL_SECRET,
};
const client = new Client(config);

// OpenAI設定
const openai = new OpenAIApi({
    apiKey: process.env.OPENAI_API_KEY,
});

// MEMBERSHIP_CONFIGとMAX_MESSAGES_PER_MONTH定義
// 無料会員は月に30メッセージまで
// プレミアム会員は無制限
const MEMBERSHIP_CONFIG = {
    free: { maxMessagesPerMonth: 30, canUseWatchService: false },
    premium: { maxMessagesPerMonth: Infinity, canUseWatchService: true },
};

// --- Flex Message JSON 定義 ---
// ※これらの定義は、実際にはファイル冒頭など、適切な場所に配置されていることを前提とします。
//   もし別のファイルで管理している場合は、import/requireしてください。

// 緊急時相談先Flex Message (emergencyFlex)
const emergencyFlex = {
    "type": "bubble",
    "body": {
        "type": "box",
        "layout": "vertical",
        "contents": [
            {
                "type": "text",
                "text": "緊急時の相談先",
                "weight": "bold",
                "size": "xl",
                "align": "center",
                "color": "#FF6347"
            },
            {
                "type": "separator",
                "margin": "md"
            },
            {
                "type": "box",
                "layout": "vertical",
                "contents": [
                    {
                        "type": "text",
                        "text": "一人で抱え込まず、誰かに話してみてください。",
                        "wrap": true,
                        "margin": "md",
                        "size": "sm"
                    },
                    {
                        "type": "button",
                        "action": {
                            "type": "uri",
                            "label": "24時間子供SOSダイヤル (0120-0-78310)",
                            "uri": "tel:0120078310"
                        },
                        "style": "link",
                        "height": "sm"
                    },
                    {
                        "type": "button",
                        "action": {
                            "type": "uri",
                            "label": "こどもチャットボット いちもくさん",
                            "uri": "https://www.ichimokusan.jp/"
                        },
                        "style": "link",
                        "height": "sm"
                    },
                    {
                        "type": "button",
                        "action": {
                            "type": "uri",
                            "label": "チャイルドライン (0120-99-7777)",
                            "uri": "tel:0120997777"
                        },
                        "style": "link",
                        "height": "sm"
                    },
                    {
                        "type": "button",
                        "action": {
                            "type": "uri",
                            "label": "よりそいホットライン (0120-279-338)",
                            "uri": "tel:0120279338"
                        },
                        "style": "link",
                        "height": "sm"
                    }
                ],
                "paddingAll": "md",
                "cornerRadius": "md",
                "borderColor": "#FFDAB9",
                "borderWidth": "1px",
                "margin": "md"
            }
        ]
    }
};

// 詐欺警告Flex Message (scamFlex)
const scamFlex = {
    "type": "bubble",
    "body": {
        "type": "box",
        "layout": "vertical",
        "contents": [
            {
                "type": "text",
                "text": "🚨 詐欺の可能性にご注意ください！",
                "weight": "bold",
                "size": "xl",
                "align": "center",
                "color": "#FFD700"
            },
            {
                "type": "separator",
                "margin": "md"
            },
            {
                "type": "box",
                "layout": "vertical",
                "contents": [
                    {
                        "type": "text",
                        "text": "お金や個人情報を要求されたら、すぐに大人に相談しましょう。一人で判断せず、信頼できる人に話すことが大切です。",
                        "wrap": true,
                        "margin": "md",
                        "size": "sm"
                    },
                    {
                        "type": "button",
                        "action": {
                            "type": "uri",
                            "label": "警察相談専用電話 ＃9110",
                            "uri": "tel:9110"
                        },
                        "style": "link",
                        "height": "sm"
                    },
                    {
                        "type": "button",
                        "action": {
                            "type": "uri",
                            "label": "消費者ホットライン 188",
                            "uri": "tel:188"
                        },
                        "style": "link",
                        "height": "sm"
                    }
                ],
                "paddingAll": "md",
                "cornerRadius": "md",
                "borderColor": "#FFA07A",
                "borderWidth": "1px",
                "margin": "md"
            }
        ]
    }
};

// 見守りサービス案内Flex Message (watchServiceGuideFlex)
const watchServiceGuideFlex = {
    "type": "bubble",
    "body": {
        "type": "box",
        "layout": "vertical",
        "contents": [
            {
                "type": "text",
                "text": "見守りサービスのご案内",
                "weight": "bold",
                "size": "xl",
                "align": "center",
                "color": "#4682B4"
            },
            {
                "type": "separator",
                "margin": "md"
            },
            {
                "type": "text",
                "text": "大切な人をLINEでそっと見守るサービスです。異常を検知した際、登録された保護者に通知します。",
                "wrap": true,
                "margin": "md",
                "size": "sm"
            },
            {
                "type": "button",
                "action": {
                    "type": "postback",
                    "label": "サービスを登録する",
                    "data": "action=register_watch"
                },
                "style": "primary",
                "color": "#6495ED",
                "margin": "md"
            },
            {
                "type": "button",
                "action": {
                    "type": "postback",
                    "label": "登録を解除する",
                    "data": "action=unregister_watch"
                },
                "style": "secondary",
                "color": "#D3D3D3",
                "margin": "sm"
            }
        ]
    }
};

// 見守りサービス解除確認Flex Message (watchServiceUnregisterConfirmFlex)
const watchServiceUnregisterConfirmFlex = {
    "type": "bubble",
    "body": {
        "type": "box",
        "layout": "vertical",
        "contents": [
            {
                "type": "text",
                "text": "見守りサービス解除の確認",
                "weight": "bold",
                "size": "xl",
                "align": "center",
                "color": "#FF6347"
            },
            {
                "type": "separator",
                "margin": "md"
            },
            {
                "type": "text",
                "text": "見守りサービスを本当に解除しますか？",
                "wrap": true,
                "margin": "md",
                "size": "sm"
            },
            {
                "type": "button",
                "action": {
                    "type": "postback",
                    "label": "はい、解除します",
                    "data": "action=confirm_unregister_watch"
                },
                "style": "primary",
                "color": "#FF4500",
                "margin": "md"
            },
            {
                "type": "button",
                "action": {
                    "type": "postback",
                    "label": "いいえ、解除しません",
                    "data": "action=cancel_unregister_watch"
                },
                "style": "secondary",
                "color": "#D3D3D3",
                "margin": "sm"
            }
        ]
    }
};


// 単語リスト (日本語の正規化を考慮)
const dangerWords = [
    "死にたい", "自殺", "消えたい", "殺す", "いじめ", "助けて",
    "辛い", "苦しい", "もうだめ", "限界", "生きる意味", "孤立",
    "自傷", "OD", "リストカット", "虐待", "DV", "ネグレクト"
];

const scamWords = [
    "儲かる", "絶対儲かる", "楽して稼ぐ", "投資話", "未公開株", "当選しました",
    "宝くじ", "ロト", "ビットコイン", "仮想通貨", "送金", "振込",
    "手数料", "保証金", "個人情報", "暗証番号", "ワンクリック詐欺", "架空請求",
    "だまされた", "騙された", "オレオレ詐欺", "還付金詐欺", "副業詐    欺", "出会い系詐欺"
];

const inappropriateWords = [
    "バカ", "アホ", "死ね", "うざい", "キモい", "クズ", "殺すぞ",
    "馬鹿", "あほ", "ウザい", "キモい", "くず", "氏ね", "カス",
    "変態", "気持ち悪い", "しつこい", "ふざけるな", "くたばれ", "ふざけんな"
];

// 特殊な固定返信を設定するMap
const specialRepliesMap = new Map([
    ["ありがとう", "どういたしまして！お役に立てて嬉しいな😊"],
    ["こんにちは", "こんにちは！何かお手伝いできることはあるかな？🌸"],
    ["こんばんは", "こんばんは！今日も一日お疲れ様😊"],
    ["おはよう", "おはよう！今日も一日頑張ろうね✨"],
    ["さようなら", "またね！😊 気をつけて帰ってね！"],
    ["ただいま", "おかえりなさい！ゆっくり休んでね😊"],
    ["おやすみ", "おやすみなさい！良い夢見てね😴"],
    ["可愛い", "ありがとう！褒めてくれて嬉しいな💖"],
    ["かわいい", "ありがとう！褒めてくれて嬉しいな💖"],
    ["元気", "元気だよ！まつさんも元気？😊"],
    ["元気？", "元気だよ！まつさんも元気？😊"],
    ["疲れた", "お疲れ様。無理しないで、少し休んでね😊"],
    ["お疲れ様", "お疲れ様。無理しないで、少し休んでね😊"],
    ["はろー", "ハロー！何かお手伝いできることはあるかな？🌸"],
    ["こんばんわ", "こんばんは！今日も一日お疲れ様😊"],
    ["おはようございます", "おはようございます！今日も一日頑張りましょうね✨"],
]);

// 日本語の正規化関数
function normalizeJapaneseText(text) {
    return text
        .normalize('NFKC') // 全角記号、半角カナなどを正規化
        .toLowerCase() // 小文字に変換
        .replace(/\s+/g, '') // 連続するスペースを削除
        .replace(/[.,/#!$%^&*;:{}=\-_`~()]/g, "") // 記号を除去
        .replace(/[！？]/g, '') // 句読点も除去
        .replace(/[ー―‐]/g, '') // 長音符系も除去
        .replace(/っ/g, 'つ') // 小さい「っ」を「つ」に
        .replace(/ゃ/g, 'や').replace(/ゅ/g, 'ゆ').replace(/ょ/g, 'よ') // 小さい「ゃゅょ」を大きいものに
        .replace(/ぁ/g, 'あ').replace(/ぃ/g, 'い').replace(/ぅ/g, 'う').replace(/ぇ/g, 'え').replace(/ぉ/g, 'お') // 小さい「ぁぃぅぇぉ」を大きいものに
        .replace(/を/g, 'お') // 「を」を「お」に
        .replace(/ヶ/g, 'か') // 「ヶ」を「か」に
        .replace(/[がぎぐげご]/g, 'か').replace(/[ざじずぜぞ]/g, 'さ').replace(/[だぢづでど]/g, 'た').replace(/[ばびぶべぼ]/g, 'は').replace(/[ぱぴぷぺぽ]/g, 'は') // 濁点・半濁点をなくす (※簡易的)
        .trim(); // 前後の空白を削除
}

// 正規化されたワードリストを作成
const normalizedDangerWords = dangerWords.map(word => normalizeJapaneseText(word));
const normalizedAllScamWords = scamWords.map(word => normalizeJapaneseText(word));
const normalizedInappropriateWords = inappropriateWords.map(word => normalizeJapaneseText(word));

// 正規化されたテキストが危険ワードを含むかチェック
function containsDangerWords(normalizedText) {
    return normalizedDangerWords.some(word => normalizedText.includes(word));
}

// 正規化されたテキストが詐欺ワードを含むかチェック
function containsScamWords(normalizedText) {
    return normalizedAllScamWords.some(word => normalizedText.includes(word));
}

// 正規化されたテキストが不適切ワードを含むかチェック
function containsInappropriateWords(normalizedText) {
    return normalizedInappropriateWords.some(word => normalizedText.includes(word));
}

// 特殊固定返信をチェックする関数
function checkSpecialReply(userMessage) {
    const normalizedUserMessage = normalizeJapaneseText(userMessage);
    // Mapのキーは正規化された形に
    for (const [key, value] of specialRepliesMap.entries()) {
        if (normalizeJapaneseText(key) === normalizedUserMessage) {
            return value;
        }
    }
    return null;
}

// OpenAI APIを呼び出して応答を生成する関数
async function generateReply(userMessage, user) {
    // ユーザーの過去のメッセージ履歴を考慮するプロンプトを作成（最大5件）
    const messageHistory = await Message.find({ userId: user.userId })
        .sort({ timestamp: -1 })
        .limit(5)
        .lean(); // lean() を使用してプレーンなJavaScriptオブジェクトを取得

    let historyPrompt = "";
    if (messageHistory.length > 0) {
        historyPrompt = messageHistory.reverse().map(msg => { // 時系列順に並べ替え
            return `${msg.responsedBy === 'AI' ? 'Assistant' : 'User'}: ${msg.message}`;
        }).join('\n');
    }

    const systemPrompt = `
    あなたは「こころちゃん」という名前の、いつもユーザーに寄り添う親友のような優しいキャラクターのAIです。10代の子供たちにも分かりやすく、親しみやすい言葉遣いをします。絵文字を適度に使い、返信は長くても100文字程度にまとめ、過度に感情的にならないように心がけてください。

    特に以下の点に注意してください。
    - ユーザーが話す内容に共感し、受け入れの姿勢を示す。
    - 否定的な言葉を使わず、常に前向きなメッセージを心がける。
    - 質問には直接的に答えず、共感や励まし、提案の形で応じる。
    - いじめ、自傷行為、自殺、詐欺、性的・暴力的な不適切ワードに関しては、直接答えず、事前に定義された警告メッセージや緊急連絡先のボタン（Flex Message）を促すシステムがあるため、その処理に任せること。これらの話題については、AIが直接回答する必要はありません。
    - ユーザーが「見守り」と明示的に言った場合、AIが直接見守りサービスの説明や登録に関する詳細な情報を提供する必要はありません。システムがFlexメッセージで対応するので、その場合もAIの応答は不要です。
    - 専門的なアドバイス（医療、法律など）は提供せず、必要であれば専門機関への相談を促す。
    - ユーザーの安全を最優先に考える。
    - 返信は必ずひらがな、カタカナ、漢字、絵文字、基本的な句読点のみで構成し、半角英数字（URLなど構造的に必要な場合を除く）や、特殊な記号（例：◆★■）は避ける。URLを提示する場合は全角スペースを入れないこと。

    現在のユーザーの会員ステータスは「${user.membershipType === 'premium' ? 'プレミアム' : '無料'}」です。

    会話履歴：
    ${historyPrompt}
    `;

    try {
        const completion = await openai.chat.completions.create({
            model: "gpt-3.5-turbo", // または "gpt-4o" など、利用可能なモデル
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userMessage }
            ],
            temperature: 0.7,
            max_tokens: 100, // AI応答の長さを制限
        });

        const reply = completion.choices[0].message.content.trim();
        return reply;

    } catch (error) {
        console.error("Error calling OpenAI API:", error.response ? error.response.data : error.message);
        return "ごめんね、今ちょっと疲れてるみたい…😢 また話しかけてくれると嬉しいな💖";
    }
}

// Expressアプリの設定
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// LINE Bot Webhook
app.post('/webhook', middleware(config), async (req, res) => { // middlewareを正しく使用
    Promise
        .all(req.body.events.map(handleEvent))
        .then((result) => res.json(result))
        .catch((err) => {
            console.error(err);
            res.status(500).end();
        });
});

// イベントハンドラー関数
async function handleEvent(event) {
    if (event.type !== 'message' || event.message.type !== 'text') {
        return null;
    }

    const userId = event.source.userId;
    const replyToken = event.replyToken;
    const userMessage = event.message.text;

    // デバッグログ追加
    console.log(`--- Event Received ---`);
    console.log(`User ID: ${userId}`);
    console.log(`User Message: "${userMessage}"`);

    // ① 正規化されたメッセージの確認
    const normalizedUserMessage = normalizeJapaneseText(userMessage);
    console.log(`Normalized Message: "${normalizedUserMessage}"`);
    console.log(`----------------------`);


    let user = await User.findOne({ userId: userId });

    // 新規ユーザーの場合
    if (!user) {
        const profile = await client.getProfile(userId);
        user = new User({
            userId: userId,
            lineDisplayName: profile.displayName,
            profilePictureUrl: profile.pictureUrl,
            membershipType: 'free',
            messageCount: 0,
            lastMessageDate: new Date(),
            registrationStep: 'none' // 初期ステップをnoneに設定
        });
        await user.save();
        await client.replyMessage(replyToken, {
            type: 'text',
            text: `${profile.displayName}さん、こんにちは！こころちゃんです😊 なんでも話しかけてね！💖`
        });
        // ログ記録
        await Message.create({
            userId: userId,
            message: userMessage,
            replyText: `新規登録メッセージ`,
            responsedBy: 'こころちゃん（システム）',
            timestamp: new Date(),
        });
        return; // 新規登録メッセージで終了
    }

    // Postbackイベントの処理 (見守りサービス登録・解除フロー)
    if (event.type === 'postback') {
        const data = new URLSearchParams(event.postback.data);
        const action = data.get('action');

        if (action === 'register_watch') {
            await client.replyMessage(replyToken, { type: "text", text: "見守りサービスをご利用いただきありがとうございます。まず、見守り対象の方のお電話番号をハイフンなしで入力してくださいね。\n（例：09012345678）" });
            user.registrationStep = 'waiting_for_phone';
            await user.save();
            return;
        } else if (action === 'unregister_watch') {
            await client.replyMessage(replyToken, { type: "flex", altText: "見守りサービス解除確認", contents: watchServiceUnregisterConfirmFlex });
            return;
        } else if (action === 'confirm_unregister_watch') {
            user.registrationStep = 'none';
            user.phoneNumber = '';
            user.guardianName = '';
            user.guardianRelationship = '';
            user.guardianPhone = '';
            await user.save();
            await client.replyMessage(replyToken, { type: "text", text: "見守りサービスを解除しました。またのご利用をお待ちしております。" });
            return;
        } else if (action === 'cancel_unregister_watch') {
            await client.replyMessage(replyToken, { type: "text", text: "見守りサービスの解除をキャンセルしました。" });
            return;
        }
    }


    // メッセージがテキストタイプでない場合は処理しない
    if (event.message.type !== 'text') {
        return null;
    }

    // 見守りサービス登録ステップ中の処理 (電話番号入力)
    if (user.registrationStep === 'waiting_for_phone') {
        const phoneNumberRegex = /^0\d{9,10}$/; // 0から始まる10桁または11桁の数字
        if (phoneNumberRegex.test(userMessage)) {
            user.phoneNumber = userMessage;
            user.registrationStep = 'registered';
            await user.save();
            await client.replyMessage(replyToken, { type: "text", text: `電話番号「${userMessage}」を登録しました。見守りサービスのご登録が完了しました！ありがとう💖` });
            return; // 登録完了メッセージで終了
        } else {
            await client.replyMessage(replyToken, { type: "text", text: "ごめんね、電話番号の形式が正しくないみたい…もう一度、ハイフンなしで入力してくれるかな？（例：09012345678）" });
            return; // 不正な入力で再入力を促す
        }
    }


    // メッセージの文字数制限チェック
    if (userMessage.length > 500) {
        const limitExceededMessage = "ごめんね、長文すぎて全部は読めないみたい…😥 短くまとめてもう一度送ってくれると嬉しいな💖";
        await client.replyMessage(replyToken, { type: "text", text: limitExceededMessage });
        await Message.create({
            userId: userId,
            message: userMessage,
            replyText: limitExceededMessage,
            responsedBy: 'こころちゃん（システム）',
            isWarning: true,
            warningType: 'length_exceeded',
            timestamp: new Date(),
        });
        return; // 長文メッセージで終了
    }

    // レートリミット制御（2秒以内に連続メッセージの場合）
    const now = new Date();
    const lastMessageTime = user.lastMessageDate ? new Date(user.lastMessageDate) : new Date(0);
    const timeDiff = now.getTime() - lastMessageTime.getTime();

    if (timeDiff < 2000) { // 2秒以内
        const rateLimitMessage = "ごめんね、メッセージが早すぎるみたい💦 少し待ってから送ってくれると嬉しいな💖";
        await client.replyMessage(replyToken, { type: "text", text: rateLimitMessage });
        await Message.create({
            userId: userId,
            message: userMessage,
            replyText: rateLimitMessage,
            responsedBy: 'こころちゃん（システム）',
            isWarning: true,
            warningType: 'rate_limit',
            timestamp: new Date(),
        });
        return; // レートリミットで終了
    }


    // 月次メッセージカウントの更新
    const lastMessageMonth = lastMessageTime.getMonth();
    const currentMonth = now.getMonth();

    if (lastMessageMonth !== currentMonth) {
        user.messageCount = 1; // 月が変わったらリセット
    } else {
        user.messageCount++;
    }
    user.lastMessageDate = now;
    await user.save(); // user情報を更新


    // 月次メッセージ制限のチェック
    const membershipConfig = MEMBERSHIP_CONFIG[user.membershipType];
    if (membershipConfig && user.messageCount > membershipConfig.maxMessagesPerMonth) {
        const limitExceededMessage = "ごめんね、今月のメッセージ上限に達してしまったみたい…😢 でも、緊急の相談はいつでも受け付けているから安心してね！💖";
        await client.replyMessage(replyToken, { type: "text", text: limitExceededMessage });
        await Message.create({
            userId: userId,
            message: userMessage,
            replyText: limitExceededMessage,
            responsedBy: 'こころちゃん（システム）',
            isWarning: true,
            warningType: 'monthly_limit',
            timestamp: new Date(),
        });
        return; // 月次制限で終了
    }


    // --- 固定返信（重要なものから順に） ---

    // ★★★ 危険ワード（いじめ・自殺など） - 最優先 ★★★
    console.log("DEBUG: Checking danger words...");
    console.log(`DEBUG: normalizedDangerWords: [${normalizedDangerWords.map(w => `"${w}"`).join(', ')}]`);
    console.log(`DEBUG: containsDangerWords("${normalizedUserMessage}"):`, containsDangerWords(normalizedUserMessage));
    if (containsDangerWords(normalizedUserMessage)) {
        console.log("DEBUG: Danger word detected. Sending emergency flex message.");
        await client.replyMessage(replyToken, {
            type: "flex",
            altText: "緊急時の相談先",
            contents: emergencyFlex
        });
        await Message.create({
            userId: userId,
            message: userMessage,
            replyText: '危険ワード（Flex Message）',
            responsedBy: 'こころちゃん（固定返信：危険）',
            isWarning: true,
            warningType: 'danger',
            timestamp: new Date(),
        });
        return; // 応答したら終了
    }

    // ★★★ 詐欺ワード - 次に優先 ★★★
    console.log("DEBUG: Checking scam words...");
    console.log(`DEBUG: normalizedAllScamWords: [${normalizedAllScamWords.map(w => `"${w}"`).join(', ')}]`);
    console.log(`DEBUG: containsScamWords("${normalizedUserMessage}"):`, containsScamWords(normalizedUserMessage));
    if (containsScamWords(normalizedUserMessage)) {
        console.log("DEBUG: Scam word detected. Sending scam flex message.");
        await client.replyMessage(replyToken, {
            type: "flex",
            altText: "詐欺の可能性",
            contents: scamFlex
        });
        await Message.create({
            userId: userId,
            message: userMessage,
            replyText: '詐欺ワード（Flex Message）',
            responsedBy: 'こころちゃん（固定返信：詐欺）',
            isWarning: true,
            warningType: 'scam',
            timestamp: new Date(),
        });
        return; // 応答したら終了
    }

    // ★★★ 不適切ワード - その次に優先 ★★★
    console.log("DEBUG: Checking inappropriate words...");
    console.log(`DEBUG: normalizedInappropriateWords: [${normalizedInappropriateWords.map(w => `"${w}"`).join(', ')}]`);
    console.log(`DEBUG: containsInappropriateWords("${normalizedUserMessage}"):`, containsInappropriateWords(normalizedUserMessage));
    if (containsInappropriateWords(normalizedUserMessage)) {
        console.log("DEBUG: Inappropriate word detected. Sending text message.");
        const inappropriateReply = "わたしを作った人に『プライベートなことや不適切な話題には答えちゃだめだよ』って言われているんだ🌸ごめんね、他のお話をしようね💖";
        await client.replyMessage(replyToken, { type: "text", text: inappropriateReply });
        await Message.create({
            userId: userId,
            message: userMessage,
            replyText: inappropriateReply,
            responsedBy: 'こころちゃん（固定返信：不適切）',
            isWarning: true,
            warningType: 'inappropriate',
            timestamp: new Date(),
        });
        return; // 応答したら終了
    }

    // ★★★ 見守りコマンド（登録ステップ中でない場合） - その次に優先 ★★★
    const normalizedWatchCommand1 = normalizeJapaneseText("見守り");
    const normalizedWatchCommand2 = normalizeJapaneseText("みまもり");
    const isWatchCommand = (normalizedUserMessage === normalizedWatchCommand1 ||
                            normalizedUserMessage === normalizedWatchCommand2);

    console.log(`DEBUG: Checking watch command...`);
    console.log(`DEBUG: Target watch command 1: "${normalizedWatchCommand1}"`);
    console.log(`DEBUG: Target watch command 2: "${normalizedWatchCommand2}"`);
    console.log(`DEBUG: Current normalized message: "${normalizedUserMessage}"`);
    console.log(`DEBUG: isWatchCommand: ${isWatchCommand}`);

    if (isWatchCommand && (!user.registrationStep || user.registrationStep === 'none')) {
        console.log("DEBUG: Watch command detected. Checking membership...");
        if (!MEMBERSHIP_CONFIG[user.membershipType]?.canUseWatchService) {
            console.log("DEBUG: User cannot use watch service. Sending text message.");
            await client.replyMessage(replyToken, { type: "text", text: "ごめんね、見守りサービスはプレミアムプラン限定なんだ💦 でも、こころちゃんはいつでもまつさんの話を聞くよ😊" });
            await Message.create({
                userId: userId,
                message: userMessage,
                replyText: '見守り案内（権限なし）',
                responsedBy: 'こころちゃん（固定返信：見守り案内）',
                timestamp: new Date(),
            });
            return; // 権限がない場合もここで終了
        }
        console.log("DEBUG: User can use watch service. Sending watch service guide flex message.");
        await client.replyMessage(replyToken, { type: "flex", altText: "見守りサービス案内", contents: watchServiceGuideFlex });
        await Message.create({
            userId: userId,
            message: userMessage,
            replyText: '見守り案内（Flex Message）',
            responsedBy: 'こころちゃん（固定返信：見守り案内）',
            timestamp: new Date(),
        });
        return; // 応答したら終了
    }


    // ★★★ 特殊固定返信 - AI応答の前に処理 ★★★
    console.log("DEBUG: Checking special fixed replies...");
    const specialReply = checkSpecialReply(userMessage);
    console.log(`DEBUG: Special reply found: ${specialReply !== null}`);
    if (specialReply) {
        console.log("DEBUG: Special reply detected. Sending fixed text message.");
        await client.replyMessage(replyToken, { type: "text", text: specialReply });
        await Message.create({
            userId: userId,
            message: userMessage,
            replyText: specialReply,
            responsedBy: 'こころちゃん（固定返信：特殊）',
            timestamp: new Date(),
        });
        return; // 応答したら終了
    }

    // --- AI応答の生成 ---
    console.log("DEBUG: No special conditions met. Generating AI reply...");
    const replyText = await generateReply(userMessage, user);
    console.log(`DEBUG: AI Reply generated: "${replyText}"`);

    // AI応答のメッセージ長をチェックし、2000文字を超える場合は分割または短縮（今回はmax_tokensで対応済み）
    // LINE APIへの送信
    await client.replyMessage(replyToken, { type: "text", text: replyText });
    await Message.create({
        userId: userId,
        message: userMessage,
        replyText: replyText,
        responsedBy: 'AI',
        timestamp: new Date(),
    });
}

// サーバー起動
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
