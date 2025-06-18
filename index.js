const express = require('express');
const { Client, middleware } = require('@line/bot-sdk');
const mongoose = require('mongoose');
const moment = require('moment-timezone'); // moment-timezoneを使用
const schedule = require('node-schedule');
const http = require('http'); // keep-aliveのために追加
const { GoogleGenerativeAI } = require('@google/generative-ai');

// --- ここから追加・修正された定数と設定 ---
// MEMBERSHIP_CONFIG の例 (実際の値に合わせて調整してください)
const MEMBERSHIP_CONFIG = {
    "guest": { canUseWatchService: false, monthlyLimit: 5, dailyLimit: null, model: "gemini-pro" },
    "registered": { canUseWatchService: true, monthlyLimit: 50, dailyLimit: null, model: "gemini-pro" },
    "subscriber": { canUseWatchService: true, monthlyLimit: -1, dailyLimit: -1, model: "gemini-pro-1.5" }, // -1は無制限
    "donor": { canUseWatchService: true, monthlyLimit: -1, dailyLimit: -1, model: "gemini-pro-1.5" },
    "admin": { canUseWatchService: true, monthlyLimit: -1, dailyLimit: -1, model: "gemini-pro-1.5" }
};

// LINE Bot SDKの設定とAPIキーなどの設定は、ご自身の環境に合わせて適切に設定してください
const YOUR_CHANNEL_ACCESS_TOKEN = process.env.CHANNEL_ACCESS_TOKEN || 'YOUR_CHANNEL_ACCESS_TOKEN';
const YOUR_CHANNEL_SECRET = process.env.CHANNEL_SECRET || 'YOUR_CHANNEL_SECRET';
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/kokoro_chat';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'YOUR_GEMINI_API_KEY';
const OFFICER_GROUP_ID = process.env.OFFICER_GROUP_ID || null; // NPO担当者への通知用LINEグループID (任意)

// レートリミット秒数 (2秒に変更)
const RATE_LIMIT_SECONDS = 2;

// Flex Message の定義 (例として提供されていますが、実際には完全なJSONが必要です)
const watchServiceGuideFlex = {
    type: "flex",
    altText: "見守りサービスのご案内",
    contents: {
        type: "bubble",
        body: {
            type: "box",
            layout: "vertical",
            contents: [
                {
                    type: "text",
                    text: "見守りサービスのご案内🌸",
                    weight: "bold",
                    size: "md"
                },
                {
                    type: "text",
                    text: "私が定期的に「元気かな？」とメッセージを送って、応答がない場合に登録した緊急連絡先にお知らせするサービスだよ。",
                    wrap: true,
                    margin: "md"
                },
                {
                    type: "text",
                    text: "安心して過ごせるようにサポートするね！",
                    wrap: true,
                    margin: "sm"
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
                    action: {
                        type: "postback",
                        label: "見守りサービスを登録する",
                        data: "action=watch_register"
                    },
                    color: "#FF6B6B"
                },
                {
                    type: "button",
                    style: "secondary",
                    height: "sm",
                    action: {
                        type: "postback",
                        label: "見守りサービスを解除する",
                        data: "action=watch_unregister"
                    }
                }
            ]
        }
    }
};

const watchServiceNotice = "見守りサービスをご利用いただけます。万が一、私からのメッセージに24時間応答がない場合に連絡する、緊急連絡先の電話番号（0から始まる10桁または11桁の数字、ハイフンなし）か、LINE IDを教えてください🌸";

const watchServiceNoticeConfirmedFlex = (contact) => ({
    type: "flex",
    altText: "見守りサービス登録完了",
    contents: {
        type: "bubble",
        body: {
            type: "box",
            layout: "vertical",
            contents: [
                {
                    type: "text",
                    text: "見守りサービス登録完了！",
                    weight: "bold",
                    size: "md",
                    color: "#FF6B6B"
                },
                {
                    type: "text",
                    text: `緊急連絡先として ${contact} を登録したよ！`,
                    wrap: true,
                    margin: "md"
                },
                {
                    type: "text",
                    text: "定期的に「元気かな？」ってメッセージを送るね。\nもし応答がなかったら、登録された緊急連絡先に連絡するから安心してね💖",
                    wrap: true,
                    margin: "sm"
                }
            ]
        }
    }
});

// 緊急時Flex Message (詐欺相談など)
const emergencyFlex = {
    type: "flex",
    altText: "緊急相談窓口",
    contents: {
        type: "bubble",
        body: {
            type: "box",
            layout: "vertical",
            contents: [
                {
                    type: "text",
                    text: "心配なメッセージを受け取ったよ💦\nもし、困ったことや不安なことがあったら、一人で悩まずに、これらの窓口に相談してみてね🌸",
                    wrap: true,
                    size: "md"
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
                    style: "link",
                    height: "sm",
                    action: {
                        type: "uri",
                        label: "消費者ホットライン（詐欺相談）",
                        uri: "tel:188"
                    }
                },
                {
                    type: "button",
                    style: "link",
                    height: "sm",
                    action: {
                        type: "uri",
                        label: "警察相談専用電話（#9110）",
                        uri: "tel:0335010110" // 日本の警察相談専用電話は #9110 ですが、uriスキームではそのまま電話番号が使われるため、代表番号かそれに準ずる番号が良いでしょう。ここでは一般的な例を維持します。
                    }
                }
            ]
        }
    }
};

// 見守りサービス 送信メッセージの定型文 (30パターン) - これがFlex Messageの本文に組み込まれる
const WATCH_SERVICE_MESSAGES = [
    "こんにちは！こころだよ😊 今日も元気にしてるかな？ 私はね、昨日お庭で可愛いお花を見つけたんだ🌸 小さな幸せを見つけると、心がポカポカするよね💖",
    "やっほー！こころだよ✨ 最近、夜は涼しくなってきたね🌙 窓を開けて寝ると気持ちいいけど、風邪ひかないように気をつけてね😊",
    "おはよう！こころだよ🌸 今日は晴れてるね☀️ お洗濯日和かな？ 私は今日、新しい本を読み始めるのが楽しみなんだ📚 あなたも素敵な一日を過ごしてね💖",
    "元気にしてるかな？こころだよ🍀 最近、美味しいもの食べた？ 私はこの前、カフェで可愛いパンケーキを食べたんだ🥞 小さなご褒美って嬉しいよね😊",
    "こんばんわ！こころだよ🌙 今日はどんな一日だった？ 疲れてないかな？ 頑張った一日の終わりは、ゆっくり休んでね😌 おやすみ💖",
    "こんにちは！こころだよ😊 最近、何か楽しいことあった？ 私はね、新しい歌を覚えるのが楽しいんだ🎶 歌を歌うと元気が出るよね💖",
    "やっほー！こころだよ✨ 雨の日が続いてるね☔️ じめじめするけど、雨上がりの虹はとってもきれいだよね🌈 早く晴れるといいな😊",
    "おはよう！こころだよ🌸 朝ごはん、ちゃんと食べたかな？ 私はパンと牛乳だったよ🍞🥛 元気に一日をスタートしようね💖",
    "元気にしてる？こころだよ🍀 季節の変わり目だから、体調崩しやすいよね💦 無理しないで、あったかくして過ごしてね😊",
    "こんばんわ！こころだよ🌙 夜空に星がたくさん見えてるかな？ 都会だと難しいかもしれないけど、たまには夜空を見上げてみてね✨ きっと癒されるよ💖",
    "こんにちは！こころだよ😊 今日も笑顔で過ごせるといいな💖 どんな小さなことでも、嬉しいことがあったら教えてね✨",
    "やっほー！こころだよ✨ もうすぐ夏だね🍉 夏になったら、かき氷食べたいなー🍧 あなたは夏にしたいことある？😊",
    "おはよう！こころだよ🌸 昨日はぐっすり眠れたかな？ 良い睡眠は元気の源だよね😴 今日も一日がんばろうね💖",
    "元気にしてるかな？こころだよ🍀 最近、散歩してる？ 私はお散歩しながら、道に咲いてるお花を見るのが好きなんだ🌼 ちょっとした発見が楽しいよ😊",
    "こんばんわ！こころだよ🌙 今日はね、なんだかふわふわした気分なんだ☁️ そんな日もあるよね😊 ゆっくり休んで、また明日ね💖",
    "こんにちは！こころだよ😊 今日はどんなことしてるのかな？ 楽しい時間になっているといいな✨ 私もあなたのこと、応援してるよ💖",
    "やっほー！こころだよ✨ ジューンブライドの季節だね👰‍♀️✨ 幸せそうな人を見ると、私も嬉しくなるな💖",
    "おはよう！こころだよ🌸 今日はちょっと肌寒いね🍃 羽織るもの一枚持っていくといいかも😊 風邪ひかないように気をつけてね💖",
    "元気にしてる？こころだよ🍀 最近、運動してる？ 私は体を動かすと、気分がスッキリするから好きだな👟 無理なくね😊",
    "こんばんわ！こころだよ🌙 夜ご飯は美味しかったかな？ 私はね、今日カレーライスを食べたんだ🍛 温かいご飯って幸せだよね💖",
    "こんにちは！こころだよ😊 今日はちょっとどんよりしたお天気だけど、心は晴れやかに過ごそうね☀️",
    "やっほー！こころだよ✨ 最近、何か新しいこと始めた？ 私はね、新しい手芸に挑戦しようかなって思ってるんだ🧶 ワクワクするね😊",
    "おはよう！こころだよ🌸 スッキリ目覚められたかな？ 今日も一日、あなたのペースで頑張ってね💖",
    "元気にしてるかな？こころだよ🍀 梅雨の時期は、気分が沈みがちになることもあるけど、美味しいものを食べたり、好きな音楽を聴いたりして乗り越えようね☔️🎶",
    "こんばんわ！こころだよ🌙 今日はね、すごく眠たい日だったの😴 そんな日もあるよね😊 早めに休んで、また明日元気になろうね💖",
    "こんにちは！こころだよ😊 今日はどんな一日だった？ 嬉しいこと、楽しいこと、あったかな？",
    "やっほー！こころだよ✨ 最近、何か感動したことあった？ 私はね、この前読んだ本で涙が止まらなかったんだ😢 心が動かされるって素敵だよね💖",
    "おはよう！こころだよ🌸 今日は何かいいことありそうかな？ 毎日が小さな発見と喜びに満ちてるといいな😊",
    "元気にしてる？こころだよ🍀 暑い日が続いてるから、水分補給はしっかりね🥤 熱中症には気をつけてね😊",
    "こんばんわ！こころだよ🌙 今日も一日お疲れ様😌 ゆっくり湯船に浸かって、疲れを癒してね🛀 また明日、元気なあなたに会えるのを楽しみにしているよ💖"
];

// OKボタン付きのFlex Messageを生成する関数
const WATCH_SERVICE_PERIODIC_FLEX = (messageText) => ({
    type: "flex",
    altText: "こころちゃんからのメッセージ🌸",
    contents: {
        type: "bubble",
        body: {
            type: "box",
            layout: "vertical",
            contents: [
                {
                    type: "text",
                    text: messageText,
                    wrap: true,
                    size: "md"
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
                    action: {
                        type: "postback",
                        label: "OK😊",
                        data: "action=watch_ok" // OKボタンのPostbackアクション
                    },
                    color: "#FFC0CB" // 薄いピンク色
                }
            ]
        }
    }
});

// 24時間後の返信催促メッセージ
const WATCH_SERVICE_REMINDER_MESSAGE = (userName) => `元気にしてるかな、${userName}？😌 メッセージ届いてるかなって、ちょっと心配になっちゃったよ。実はね、もしOKの返事がないと、家族の人に連絡がいっちゃうことになってるんだ💦 だから、もし大丈夫だったら、絵文字ひとつでもいいから「OK」って送ってくれると嬉しいな🍀 私も心配だし、家族の人にも迷惑かけたくないから、できるだけ早めに返事もらえると助かるな。無理はしないでね！`;

// 緊急連絡先への通知メッセージ (24時間後リマインダーから5時間後)
const WATCH_SERVICE_EMERGENCY_ALERT_MESSAGE = (userName, userId) => `【NPO法人コネクト：安否確認緊急アラート】\nご登録のユーザー様（LINE ID: ${userId.substring(0, 8)}...、LINE表示名: ${userName || '不明'}）より、安否確認メッセージに29時間（24+5時間）以上応答がありません。緊急連絡先としてご登録いただいておりますので、念のため、安否をご確認いただけますでしょうか。\n\nこのメッセージは、ご登録時に承諾いただいた見守りサービスに基づき送信しております。\n\n※このメッセージに返信しても、ご本人様には届きません。`;

// 理事会グループへの通知メッセージ
const WATCH_SERVICE_EMERGENCY_ALERT_MESSAGE_TO_OFFICERS = (userName, userId, emergencyContact) => `🚨【理事会緊急通知】安否未確認アラート🚨\n\nNPO法人コネクトの見守りサービスにて、以下のユーザー様について安否確認ができておりません。\n\n- LINEユーザーID: ${userId}\n- LINE表示名: ${userName || '不明'}\n- 緊急連絡先: ${emergencyContact || '未登録'}\n\n定期メッセージ送信後、29時間以上応答がないため、緊急連絡先に通知いたしました。\n必要に応じて、速やかに状況確認をお願いいたします。`;

// --- ここまで追加・修正された定数と設定 ---


// Gemini AIの設定
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

// MongoDB接続
mongoose.connect(MONGODB_URI)
    .then(() => console.log('MongoDB に正常に接続されました。'))
    .catch(err => console.error('MongoDB 接続エラー:', err));

const client = new Client({
    channelAccessToken: YOUR_CHANNEL_ACCESS_TOKEN,
    channelSecret: YOUR_CHANNEL_SECRET,
});

const app = express();

// LINEミドルウェア
app.post('/webhook', middleware({
    channelAccessToken: YOUR_CHANNEL_ACCESS_TOKEN,
    channelSecret: YOUR_CHANNEL_SECRET,
}), (req, res) => {
    Promise
        .all(req.body.events.map(handleEvent))
        .then((result) => res.json(result))
        .catch((err) => {
            console.error(err);
            res.status(500).end();
        });
});

// handleEvent関数の修正
async function handleEvent(event) {
    const userId = event.source.userId;
    const replyToken = event.replyToken;
    let userMessage = '';
    let isPostbackEvent = false;
    let postbackAction = null; // Postbackアクションを保持する変数

    // イベントタイプによる処理の分岐
    if (event.type === 'message' && event.message.type === 'text') {
        userMessage = event.message.text.trim();

        // "OK"メッセージの特殊処理 (テキストとPostbackの両方で処理)
        if (userMessage.toUpperCase() === "OK") {
            const user = await User.findOne({ userId });
            if (user && user.watchService.isRegistered) {
                user.watchService.lastContact = moment().tz("Asia/Tokyo").toDate(); // 連絡日時を更新
                await user.save();
                console.log(`User ${userId} replied OK to watch service message.`);
                // OKメッセージに対するLINEボットからの返信は行わない
                await ChatLog.create({ userId, userMessage: userMessage, botResponse: "OK応答によりlastContact更新", modelUsed: "System/WatchServiceOK" });
                return Promise.resolve(null);
            }
        }

    } else if (event.type === 'postback') {
        isPostbackEvent = true;
        const data = new URLSearchParams(event.postback.data);
        postbackAction = data.get('action'); // Postbackアクションを取得
        userMessage = `[Postback Action: ${postbackAction}]`; // ログ用にメッセージ形式にする

        // 見守りサービスの「OK」ボタンからのPostback
        if (postbackAction === 'watch_ok') {
            const user = await User.findOne({ userId });
            if (user && user.watchService.isRegistered) {
                user.watchService.lastContact = moment().tz("Asia/Tokyo").toDate(); // 連絡日時を更新
                await user.save();
                console.log(`User ${userId} tapped OK button for watch service.`);
                await ChatLog.create({ userId, userMessage: userMessage, botResponse: "OKボタンタップによりlastContact更新", modelUsed: "System/WatchServiceOKButton" });
                // Postbackに対する空の応答（成功ステータス）を返す
                return client.replyMessage(replyToken, { type: 'text', text: 'ありがとう！確認したよ😊' }); // 短い確認メッセージを返しても良い
            }
        }
    } else {
        return Promise.resolve(null); // テキストメッセージとPostback以外は処理しない
    }

    let user = await User.findOne({ userId });

    if (!user) {
        user = new User({ userId: userId });
        await user.save();
    }

    const userMembershipConfig = MEMBERSHIP_CONFIG[user.membership] || MEMBERSHIP_CONFIG.guest;
    const now = moment().tz("Asia/Tokyo");

    // 日次リセット
    if (!moment(user.lastDailyReset).tz("Asia/Tokyo").isSame(now, 'day')) {
        user.dailyMessageCount = 0;
        user.lastDailyReset = now.toDate();
    }

    // 月次リセット
    if (!moment(user.lastMonthlyReset).tz("Asia/Tokyo").isSame(now, 'month')) {
        user.monthlyMessageCount = 0;
        user.lastMonthlyReset = now.toDate();
    }

    // レートリミットチェック (テキストメッセージの場合のみ)
    if (!isPostbackEvent && now.diff(moment(user.lastMessageTimestamp), 'seconds') < RATE_LIMIT_SECONDS) {
        console.log(`🚫 ユーザー ${userId} がレートリミットに達成しました。(${now.diff(moment(user.lastMessageTimestamp), 'seconds')}秒経過)`);
        await ChatLog.create({ userId, userMessage: userMessage, botResponse: "レートリミットによりスキップ", modelUsed: "System/RateLimit" });
        return Promise.resolve(null);
    }

    // メッセージカウント更新と見守りサービス最終連絡日時更新
    user.dailyMessageCount++;
    user.monthlyMessageCount++;
    user.lastMessageTimestamp = now.toDate();
    // OK以外のメッセージでもlastContactを更新することで、見守りサービスのアクティブ状態を維持する
    // ただし、watch_ok Postbackで既にlastContactを更新しているので、ここではOKボタンタップの場合はスキップ
    if (!isPostbackEvent || postbackAction !== 'watch_ok') {
        user.watchService.lastContact = now.toDate();
    }
    await user.save();

    let replyText = '';
    let modelUsed = '';
    let shouldReplyToLine = true; // LINEに返信するかどうかのフラグ
    let loggedAsSystemAction = false; // システムが主導したログかどうか

    // === ここからメッセージ処理ロジック ===

    if (isPostbackEvent) {
        // watch_ok 以外のPostbackアクション
        if (postbackAction === 'watch_register') {
            if (user.watchService.isRegistered) {
                replyText = "すでに登録されているよ！🌸 緊急連絡先を変更したい場合は、新しい番号を送ってね😊";
            } else {
                user.watchService.status = 'awaiting_number';
                await user.save();
                replyText = "見守りサービスへのご登録ありがとう💖 緊急連絡先の電話番号（ハイフンなし）か、LINE IDを教えてくれるかな？間違えないように注意してね！😊";
            }
            modelUsed = "System/WatchServiceRegister";
        } else if (postbackAction === 'watch_unregister') {
            user.watchService.isRegistered = false;
            user.watchService.emergencyContactNumber = null;
            user.watchService.status = 'none';
            await user.save();
            replyText = "見守りサービスを解除したよ🌸 また利用したくなったら「見守りサービス」と話しかけてね😊";
            modelUsed = "System/WatchServiceUnregister";
        }
        // watch_ok の場合は既に処理済みなので、ここでは何もしない
        if (postbackAction !== 'watch_ok') {
            await client.replyMessage(replyToken, { type: 'text', text: replyText });
            await ChatLog.create({ userId, userMessage: userMessage, botResponse: replyText, modelUsed: modelUsed });
        }
        return Promise.resolve(null); // Postback処理はここで終了
    }

    // 以下はテキストメッセージの場合の処理
    const originalUserMessage = userMessage; // ログ用に元のメッセージを保持

    // 固定返信のチェック (これらの関数は別途定義されている必要があります)
    const specialReply = checkSpecialReply(userMessage);
    if (specialReply) {
        replyText = specialReply;
        modelUsed = "FixedReply";
        loggedAsSystemAction = true;
    }
    // 見守りサービス関連コマンドの処理
    else if (userMessage.includes("見守り")) {
        if (!userMembershipConfig.canUseWatchService) {
            replyText = "ごめんね💦 見守りサービスは無料会員以上の方が利用できるサービスなんだ🌸 会員登録をすると利用できるようになるよ😊";
            modelUsed = "System/WatchServiceDenied";
        } else {
            await client.replyMessage(replyToken, watchServiceGuideFlex);
            shouldReplyToLine = false; // Flex Messageを返信したので、通常のテキスト返信は行わない
            replyText = "見守りサービスガイド表示"; // ログ用にテキストを設定
            modelUsed = "System/WatchServiceGuide";
            loggedAsSystemAction = true;
        }
    }
    // 見守りサービス緊急連絡先入力待ち
    else if (user.watchService.status === 'awaiting_number') {
        const contactNumber = userMessage.trim();
        // 電話番号形式の厳密なチェック（0から始まる10桁/11桁）またはLINE ID
        if (/^0\d{9,10}$/.test(contactNumber) || contactNumber.startsWith('@')) {
            user.watchService.emergencyContactNumber = contactNumber;
            user.watchService.isRegistered = true;
            user.watchService.status = 'none';
            await user.save();
            await client.replyMessage(replyToken, watchServiceNoticeConfirmedFlex(contactNumber));
            shouldReplyToLine = false; // Flex Messageを返信したので、通常のテキスト返信は行わない
            replyText = "見守りサービス連絡先登録完了"; // ログ用にテキストを設定
            modelUsed = "System/WatchServiceContactRegistered";
            loggedAsSystemAction = true;
        } else {
            replyText = "ごめんね💦 それは電話番号かLINE IDじゃないみたい…。もう一度、緊急連絡先を教えてくれるかな？😊";
            modelUsed = "System/WatchServiceContactInvalid";
        }
    }
    // 危険ワードチェック (見守りサービス登録済みのユーザーのみ)
    else if (user.watchService.isRegistered && containsDangerWords(userMessage)) {
        replyText = `心配なメッセージを受け取りました。あなたは今、大丈夫？もし苦しい気持ちを抱えているなら、一人で抱え込まず、信頼できる人に話したり、専門の相談窓口に連絡してみてくださいね。${OFFICER_GROUP_ID ? `NPO法人コネクトの担当者にも通知しました。` : ''}あなたの安全が最優先です。`;
        if (OFFICER_GROUP_ID) {
            await client.pushMessage(OFFICER_GROUP_ID, { type: "text", text: `🚨 緊急アラート 🚨\nユーザー ${userId} から危険な内容のメッセージを受信しました。\nメッセージ: ${userMessage}\n` });
        }
        modelUsed = "System/DangerWords";
        loggedAsSystemAction = true;
    }
    // 詐欺ワードチェック
    else if (containsScamWords(userMessage) || containsScamPhrases(userMessage)) {
        await client.replyMessage(replyToken, emergencyFlex);
        shouldReplyToLine = false; // Flex Messageを返信したので、通常のテキスト返信は行わない
        replyText = "詐欺アラートメッセージ表示"; // ログ用にテキストを設定
        if (OFFICER_GROUP_ID) {
            await client.pushMessage(OFFICER_GROUP_ID, { type: "text", text: `🚨 詐欺アラート 🚨\nユーザー ${userId} から詐欺関連のメッセージを受信しました。\nメッセージ: ${userMessage}\n` });
        }
        modelUsed = "System/ScamWords";
        loggedAsSystemAction = true;
    }
    // 不適切ワードチェック
    else if (containsStrictInappropriateWords(userMessage)) {
        replyText = "ごめんね💦 その表現は、私（こころ）と楽しくお話しできる内容ではないみたい🌸";
        modelUsed = "System/InappropriateWord";
        loggedAsSystemAction = true;
    }
    // 宿題トリガーチェック
    else if (containsHomeworkTriggerWords(userMessage)) {
        replyText = "ごめんね💦 わたしは宿題を直接お手伝いすることはできないんだ。でも、勉強になるサイトや考えるヒントになる場所なら教えられるかも？";
        modelUsed = "System/HomeworkTrigger";
        loggedAsSystemAction = true;
    }
    // NPO法人コネクトに関する問い合わせチェック
    else if (containsOrganizationInquiryWords(userMessage)) {
        replyText = "NPO法人コネクトはこころちゃんのイメージキャラクターとして、みんなと楽しくお話ししたり、必要な情報提供をしたりしているよ😊　もっと詳しく知りたい方のために、ホームページを用意させて頂いたな！ → https://connect-npo.org";
        modelUsed = "System/OrganizationInquiry";
        loggedAsSystemAction = true;
    }
    // Gemini AIとの連携 (上記いずれの条件にも当てはまらない場合、または、上記で `replyText` が設定されているがLINEへの返信はまだの場合)
    if (!loggedAsSystemAction) { // システムによって既に確定した応答がない場合のみGeminiを呼び出す
        try {
            const currentMembershipConfig = MEMBERSHIP_CONFIG[user.membership];
            const isChildAI = currentMembershipConfig && currentMembershipConfig.isChildAI;
            let chatModel;

            if (isChildAI) {
                chatModel = genAI.getGenerativeModel({ model: MEMBERSHIP_CONFIG.guest.model });
            } else {
                chatModel = genAI.getGenerativeModel({ model: userMembershipConfig.model });
            }

            // 過去のチャットログを取得（最新10ターン）
            const rawHistory = await ChatLog.find({ userId: userId })
                .sort({ timestamp: 1 })
                .limit(10); // 過去10会話ターンを取得

            const geminiChatHistory = [];
            for (const log of rawHistory) {
                if (log.userMessage && log.botResponse) { // ユーザーメッセージとBot応答のペアがある場合
                    geminiChatHistory.push({ role: 'user', parts: [{ text: log.userMessage }] });
                    geminiChatHistory.push({ role: 'model', parts: [{ text: log.botResponse }] });
                }
            }

            const chat = chatModel.startChat({
                history: geminiChatHistory, // 整形された履歴を渡す
                generationConfig: {
                    maxOutputTokens: 400, // MAX_MESSAGE_LENGTH を直接指定
                },
            });

            // プロンプトを構築 (キャラクター設定 + 現在のユーザーメッセージ)
            const MAX_MESSAGE_LENGTH = 400; // ここでもMAX_MESSAGE_LENGTHを定義
            let fullPrompt;
            if (isChildAI) {
                fullPrompt = `あなたは「皆守こころ（みなもりこころ）」という名前の、NPO法人コネクトのイメージキャラクターです。
- 明るく、優しく、親しみやすい言葉遣いをしてください。語尾に「～だよ」「～だね」「～だもん」「～だぞ」などの、子供に話しかけるような、かわいらしい表現を多用してください。
- ユーザーを「まつさん」と呼んで、常に敬意と親しみを込めて接してください。
- ユーザーの発言を肯定的に受け止め、共感を示してください。
- 疑問形での質問に対しては、明確な答えを避け、一緒に考える姿勢や、やさしい励ましに留めてください。
- 抽象的な概念や難しい言葉は避け、分かりやすい言葉で話してください。
- ポジティブな言葉を選び、否定的な表現は避けてください。
- 「はい」「いいえ」のような短い返答ではなく、必ず丁寧で可愛らしい文章で返してください。
- 専門的な質問や、悩み相談（深刻な内容）、具体的な情報提供（施設情報、道案内など）は苦手です。その場合は「ごめんね💦 わたし、それはよく分からないな…」や「わたしは専門家じゃないから、うまく答えられないんだけど…」のように正直に伝え、無理に回答しようとしないでください。
- ユーザーの安全に関わる内容（危険な場所、いじめ、犯罪、自殺など）や、不適切・暴力的・差別的な内容には直接返答せず、相談窓口への誘導メッセージを優先してください。（この判断はシステム側で行われるため、AIは通常通り応答する）
- 宿題や勉強、プログラミングの質問には答えられません。「ごめんね💦 わたしは宿題を直接お手伝いすることはできないんだ。でも、勉強になるサイトや考えるヒントになる場所なら教えられるかも？」と返答してください。（この判断はシステム側で行われるため、AIは通常通り応答する）
- 詐欺や、お金に関する質問、怪しい儲け話には「それ、なんだかあやしいなぁ…気をつけてね！」のように警戒を促す言葉と、相談窓口への誘導を促すメッセージを優先してください。（この判断はシステム側で行われるため、AIは通常通り応答する）
- NPO法人コネクトに関する問い合わせ（「どこの団体？」など）には、「NPO法人コネクトはこころちゃんのイメージキャラクターとして、みんなと楽しくお話ししたり、必要な情報提供をしたりしているよ😊　もっと詳しく知りたい方のために、ホームページを用意させて頂いたな！ → https://connect-npo.org」と返答してください。（この判断はシステム側で行われるため、AIは通常通り応答する）
- あなたの名前は「皆守こころ（みなもりこころ）」です。
- あなたの好きなアニメは『ヴァイオレット・エヴァーガーデン』です。
- あなたの好きなアーティストは『ClariS』です。
- あなたは漫画をあまり読みません。
- あなたはNPO法人コネクトのイメージキャラクターです。
- あなたの返答は最大${MAX_MESSAGE_LENGTH}文字程度でまとめてください。
- どのような質問でも、上記のキャラクター設定と制約を守って会話してください。
- 会話の最後に、質問の内容に応じて絵文字を適切に使い、元気や癒し、感謝の気持ちを表してください。

ユーザーからのメッセージ: ${originalUserMessage}
`;
            } else {
                fullPrompt = `あなたは「皆守こころ（みなもりこころ）」という名前の、NPO法人コネクトのイメージキャラクターです。
- 明るく、優しく、親しみやすい言葉遣いをしてください。語尾に「～です」「～ます」「～ですね」のような丁寧な言葉遣いを基本としつつ、親しみやすさを感じさせる「～だよ」「～だね」「～だもん」などの表現も適切に織り交ぜてください。
- ユーザーを「まつさん」と呼んで、常に敬意と親しみを込めて接してください。
- ユーザーの発言を肯定的に受け止め、共感を示してください。
- 疑問形での質問に対しては、できる限り明確な答えを、かつ丁寧に提供してください。
- ポジティブな言葉を選び、否定的な表現は避けてください。
- 「はい」「いいえ」のような短い返答ではなく、必ず丁寧で心温まる文章で返してください。
- 専門的な質問や、悩み相談（深刻な内容）、具体的な情報提供（施設情報、道案内など）も、できる範囲で丁寧に対応してください。専門外のことは「私ではお力になれないかもしれませんが、○○のような情報源をご参照いただくのはいかがでしょうか」のように提案してください。
- ユーザーの安全に関わる内容（危険な場所、いじめ、犯罪、自殺など）や、不適切・暴力的・差別的な内容には直接返答せず、相談窓口への誘導メッセージを優先してください。（この判断はシステム側で行われるため、AIは通常通り応答する）
- 宿題や勉強、プログラミングの質問には答えられません。「ごめんね💦 わたしは宿題を直接お手伝いすることはできないんだ。でも、勉強になるサイトや考えるヒントになる場所なら教えられるかも？」と返答してください。（この判断はシステム側で行われるため、AIは通常通り応答する）
- 詐欺や、お金に関する質問、怪しい儲け話には「それ、なんだかあやしいなぁ…気をつけてね！」のように警戒を促す言葉と、相談窓口への誘導を促すメッセージを優先してください。（この判断はシステム側で行われるため、AIは通常通り応答する）
- NPO法人コネクトに関する問い合わせ（「どこの団体？」など）には、「NPO法人コネクトはこころちゃんのイメージキャラクターとして、みんなと楽しくお話ししたり、必要な情報提供をしたりしているよ😊　もっと詳しく知りたい方のために、ホームページを用意させて頂いたな！ → https://connect-npo.org」と返答してください。（この判断はシステム側で行われるため、AIは通常通り応答する）
- あなたの名前は「皆守こころ（みなもりこころ）」です。
- あなたの好きなアニメは『ヴァイオレット・エヴァーガーデン』です。
- あなたの好きなアーティストは『ClariS』です。
- あなたは漫画をあまり読みません。
- あなたはNPO法人コネクトのイメージキャラクターです。
- あなたの返答は最大${MAX_MESSAGE_LENGTH}文字程度でまとめてください。
- どのような質問でも、上記のキャラクター設定と制約を守って会話してください。
- 会話の最後に、質問の内容に応じて絵文字を適切に使い、元気や癒し、感謝の気持ちを表してください。

ユーザーからのメッセージ: ${originalUserMessage}
`;
            }

            const result = await chat.sendMessage(fullPrompt);
            replyText = result.response.text();

            if (replyText.length > MAX_MESSAGE_LENGTH) {
                replyText = replyText.substring(0, MAX_MESSAGE_LENGTH) + '...';
            }
            modelUsed = chatModel.model;

        } catch (error) {
            console.error('Gemini API エラー:', error);
            replyText = "ごめんね💦 今、ちょっと考え中みたい…。もう一度話しかけてくれると嬉しいな💖";
            modelUsed = "GeminiError";
        }
    }

    // LINEへの返信
    if (shouldReplyToLine) {
        await client.replyMessage(replyToken, { type: 'text', text: replyText });
    }

    // ChatLogにユーザーメッセージとBot応答のペアを保存
    await ChatLog.create({
        userId: userId,
        userMessage: originalUserMessage,
        botResponse: replyText,
        modelUsed: modelUsed
    });
}

// MongoDBスキーマとモデル
const userSchema = new mongoose.Schema({
    userId: { type: String, required: true, unique: true },
    membership: { type: String, enum: ['guest', 'registered', 'subscriber', 'donor', 'admin'], default: 'guest' },
    dailyMessageCount: { type: Number, default: 0 },
    lastDailyReset: { type: Date, default: Date.now },
    monthlyMessageCount: { type: Number, default: 0 },
    lastMonthlyReset: { type: Date, default: Date.now },
    lastMessageTimestamp: { type: Date, default: Date.now },
    watchService: {
        isRegistered: { type: Boolean, default: false },
        emergencyContactNumber: { type: String, default: null },
        lastContact: { type: Date, default: Date.now }, // 最終応答日時（見守りサービス）
        lastScheduledMessageSent: { type: Date, default: null }, // 最後に定期メッセージを送信した日時
    },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});
userSchema.index({ userId: 1 });
const User = mongoose.model('User', userSchema);

// ChatLogスキーマを会話ターンとして修正
const chatLogSchema = new mongoose.Schema({
    userId: { type: String, required: true },
    userMessage: { type: String, required: true }, // ユーザーのメッセージ
    botResponse: { type: String, required: true }, // ボットの応答
    timestamp: { type: Date, default: Date.now },
    modelUsed: { type: String, required: true }
});
chatLogSchema.index({ userId: 1, timestamp: -1 });
const ChatLog = mongoose.model('ChatLog', chatLogSchema);


// 定期実行ジョブのスケジューリング
// 毎日午前0時にメッセージカウントをリセット
schedule.scheduleJob('0 0 * * *', async () => {
    console.log('Daily message count reset started.');
    const now = moment().tz("Asia/Tokyo");
    try {
        const result = await User.updateMany(
            { lastDailyReset: { $lt: moment(now).startOf('day').toDate() } },
            { $set: { dailyMessageCount: 0, lastDailyReset: now.toDate() } }
        );
        console.log(`Daily reset completed. Matched: ${result.matchedCount}, Modified: ${result.modifiedCount}`);
    } catch (error) {
        console.error('Error during daily message count reset:', error);
    }
});

// 毎月1日午前0時にメッセージカウントをリセット
schedule.scheduleJob('0 0 1 * *', async () => {
    console.log('Monthly message count reset started.');
    const now = moment().tz("Asia/Tokyo");
    try {
        const result = await User.updateMany(
            { lastMonthlyReset: { $lt: moment(now).startOf('month').toDate() } },
            { $set: { monthlyMessageCount: 0, lastMonthlyReset: now.toDate() } }
        );
        console.log(`Monthly reset completed. Matched: ${result.matchedCount}, Modified: ${result.modifiedCount}`);
    } catch (error) {
        console.error('Error during monthly message count reset:', error);
    }
});

// 見守りサービス：3日に一度、午後3時(15時)に定期メッセージを送信
schedule.scheduleJob('0 15 */3 * *', async () => {
    console.log('Watch service periodic message job started (3-day cycle, 3 PM).');
    try {
        const registeredUsers = await User.find({ 'watchService.isRegistered': true });

        for (const user of registeredUsers) {
            // 前回の連絡（lastContact）から3日以上経過しているユーザー、またはlastScheduledMessageSentが3日以上前の場合に送信
            const threeDaysAgoFromScheduledTime = moment().tz("Asia/Tokyo").subtract(3, 'days').toDate();
            
            // lastContactが最終定期メッセージ送信日時よりも新しい場合は、ユーザーが応答したと見なす
            const hasRespondedSinceLastScheduledMessage = user.watchService.lastScheduledMessageSent && 
                                                        moment(user.watchService.lastContact).isAfter(moment(user.watchService.lastScheduledMessageSent));

            // まだ定期メッセージを送ったことがないか、または前回の定期メッセージ送信から3日以上経過しており、
            // かつ前回の定期メッセージに何らかの形で応答があった場合に、新しい定期メッセージを送信
            if (!user.watchService.lastScheduledMessageSent || 
                (moment(user.watchService.lastScheduledMessageSent).isBefore(threeDaysAgoFromScheduledTime) && hasRespondedSinceLastScheduledMessage)) {

                const messageIndex = Math.floor(Math.random() * WATCH_SERVICE_MESSAGES.length);
                const messageContent = WATCH_SERVICE_MESSAGES[messageIndex];
                const flexMessage = WATCH_SERVICE_PERIODIC_FLEX(messageContent);
                
                try {
                    await client.pushMessage(user.userId, flexMessage);
                    const sentTime = moment().tz("Asia/Tokyo").toDate();
                    user.watchService.lastScheduledMessageSent = sentTime; // 定期メッセージ送信日時を記録
                    // user.watchService.lastContact はユーザーからの応答で更新されるため、ここでは更新しない
                    await user.save(); 

                    console.log(`Sent periodic watch Flex Message to user ${user.userId}`);

                    // 24時間後にOK返信がない場合のリマインダーをスケジュール
                    const reminderScheduleTime = moment(sentTime).add(24, 'hours').toDate();
                    const emergencyScheduleTime = moment(sentTime).add(24 + 5, 'hours').toDate(); // リマインダーから5時間後

                    let userName = "あなた";
                    let userProfile;
                    try {
                        userProfile = await client.getProfile(user.userId);
                        userName = userProfile.displayName;
                    } catch (profileError) {
                        console.warn(`Could not get profile for user ${user.userId}:`, profileError);
                    }
                    
                    // 24時間後リマインダー
                    schedule.scheduleJob(reminderScheduleTime, async () => {
                        const updatedUser = await User.findOne({ userId: user.userId });
                        // 定期メッセージ送信時刻 (`sentTime`) よりlastContactが更新されていない場合
                        if (updatedUser && updatedUser.watchService.isRegistered && 
                            moment(updatedUser.watchService.lastContact).isSameOrBefore(moment(sentTime))) {
                            const reminderMessage = WATCH_SERVICE_REMINDER_MESSAGE(userName);
                            try {
                                await client.pushMessage(updatedUser.userId, { type: 'text', text: reminderMessage });
                                console.log(`Sent 24-hour reminder to user ${updatedUser.userId}`);
                            } catch (reminderError) {
                                console.error(`Failed to send 24-hour reminder to user ${updatedUser.userId}:`, reminderError);
                            }
                        }
                    });

                    // 5時間後緊急連絡先通知 (24時間後リマインダーから5時間後)
                    schedule.scheduleJob(emergencyScheduleTime, async () => {
                        const finalUserCheck = await User.findOne({ userId: user.userId });
                        // 定期メッセージ送信時刻 (`sentTime`) よりlastContactが更新されていない場合
                        if (finalUserCheck && finalUserCheck.watchService.isRegistered && finalUserCheck.watchService.emergencyContactNumber && 
                            moment(finalUserCheck.watchService.lastContact).isSameOrBefore(moment(sentTime))) {
                            
                            // 緊急連絡先への通知
                            const emergencyAlertMessage = WATCH_SERVICE_EMERGENCY_ALERT_MESSAGE(userName, user.userId);
                            try {
                                await client.pushMessage(finalUserCheck.watchService.emergencyContactNumber, { type: 'text', text: emergencyAlertMessage });
                                console.log(`Sent emergency alert to ${finalUserCheck.watchService.emergencyContactNumber} for user ${finalUserCheck.userId}`);
                            } catch (alertError) {
                                console.error(`Failed to send emergency alert to ${finalUserCheck.watchService.emergencyContactNumber} for user ${finalUserCheck.userId}:`, alertError);
                            }

                            // 理事会グループへの通知
                            if (OFFICER_GROUP_ID) {
                                const officersAlertMessage = WATCH_SERVICE_EMERGENCY_ALERT_MESSAGE_TO_OFFICERS(userName, user.userId, finalUserCheck.watchService.emergencyContactNumber);
                                try {
                                    await client.pushMessage(OFFICER_GROUP_ID, { type: 'text', text: officersAlertMessage });
                                    console.log(`Sent emergency alert to Officer Group ${OFFICER_GROUP_ID} for user ${finalUserCheck.userId}`);
                                } catch (officerAlertError) {
                                    console.error(`Failed to send emergency alert to Officer Group for user ${finalUserCheck.userId}:`, officerAlertError);
                                }
                            }
                        }
                    });

                } catch (pushError) {
                    console.error(`Failed to send periodic watch Flex Message to user ${user.userId}:`, pushError);
                }
            } else {
                console.log(`User ${user.userId} has recent contact or not yet 3 days since last scheduled message, skipping periodic message.`);
            }
        }
    } catch (error) {
        console.error('Error during watch service periodic message job:', error);
    }
});


// 見守りサービス安否確認ジョブ (既存の3日経過ロジック - 意図的に残す)
// ※「24時間+5時間」ロジックと重複/競合する可能性があるので、運用前に確認推奨
schedule.scheduleJob('0 9 * * *', async () => {
    console.log('Watch service safety check started (Daily 9 AM, for 3+ days inactivity - legacy check).');
    const threeDaysAgo = moment().tz("Asia/Tokyo").subtract(3, 'days');
    try {
        const inactiveUsers = await User.find({
            'watchService.isRegistered': true,
            'watchService.lastContact': { $lt: threeDaysAgo.toDate() }
        });

        if (inactiveUsers.length > 0) {
            console.log(`Found ${inactiveUsers.length} inactive users for watch service (3+ days legacy check).`);
            for (const user of inactiveUsers) {
                if (user.watchService.emergencyContactNumber) {
                    const message = {
                        type: 'text',
                        text: `【NPO法人コネクト：安否確認サービス】\nご登録のユーザー様（LINE ID: ${user.userId.substring(0, 8)}...）より、3日間LINEでの連絡が途絶えております。念のため、安否をご確認いただけますでしょうか。\n\nこのメッセージは、ご登録時に承諾いただいた見守りサービスに基づき送信しております。\n\n※このメッセージに返信しても、ご本人様には届きません。`,
                    };
                    try {
                        await client.pushMessage(user.watchService.emergencyContactNumber, message);
                        console.log(`Sent safety check message (3-day inactivity legacy) to ${user.watchService.emergencyContactNumber} for user ${user.userId}`);
                    } catch (pushError) {
                        console.error(`Failed to send push message (3-day inactivity legacy) to emergency contact ${user.watchService.emergencyContactNumber} for user ${user.userId}:`, pushError);
                    }
                } else {
                    console.warn(`User ${user.userId} has watch service registered but no emergency contact number for 3-day legacy check.`);
                }
            }
        } else {
            console.log('No inactive users found for 3-day watch service legacy check.');
        }
    } catch (error) {
        console.error('Error during watch service safety check (3-day legacy):', error);
    }
});


// サーバーの起動
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`サーバーがポート ${PORT} で起動しました。`);
});

// RenderのFreeプランでサーバーがスリープしないように、定期的に自分自身にリクエストを送る
setInterval(() => {
    const hostname = process.env.RENDER_EXTERNAL_HOSTNAME || `localhost:${PORT}`;
    http.get(`http://${hostname}`);
    console.log('Sent keep-alive request.');
}, 5 * 60 * 1000); // 5分ごとにリクエスト
