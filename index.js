const express = require('express');
const { Client, middleware } = require('@line/bot-sdk');
const mongoose = require('mongoose');
const moment = require('moment-timezone');
const schedule = require('node-schedule');
const http = require('http');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// --- watch-messages.js からメッセージを読み込む ---
const WATCH_SERVICE_MESSAGES = require('./watch-messages');
// --- ここまで ---

// --- ここから定数と設定 ---
const MEMBERSHIP_CONFIG = {
    "guest": { canUseWatchService: false, monthlyLimit: 5, dailyLimit: null, model: "gemini-pro" },
    "registered": { canUseWatchService: true, monthlyLimit: 50, dailyLimit: null, model: "gemini-pro" },
    "subscriber": { canUseWatchService: true, monthlyLimit: -1, dailyLimit: -1, model: "gemini-pro-1.5" },
    "donor": { canUseWatchService: true, monthlyLimit: -1, dailyLimit: -1, model: "gemini-pro-1.5" },
    "admin": { canUseWatchService: true, monthlyLimit: -1, dailyLimit: -1, model: "gemini-pro-1.5" }
};

const YOUR_CHANNEL_ACCESS_TOKEN = process.env.CHANNEL_ACCESS_TOKEN || 'YOUR_CHANNEL_ACCESS_TOKEN';
const YOUR_CHANNEL_SECRET = process.env.CHANNEL_SECRET || 'YOUR_CHANNEL_SECRET';
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/kokoro_chat';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'YOUR_GEMINI_API_KEY';
const OFFICER_GROUP_ID = process.env.OFFICER_GROUP_ID || null; // NPO担当者への通知用LINEグループID (任意)

const RATE_LIMIT_SECONDS = 2; // 2秒

// Flex Message の定義 (変更なし)
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
                        uri: "tel:0335010110"
                    }
                }
            ]
        }
    }
};

// WATCH_SERVICE_MESSAGES は watch-messages.js から読み込まれるため、ここからは削除されています。

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
                        data: "action=watch_ok"
                    },
                    color: "#FFC0CB"
                }
            ]
        }
    }
});

const WATCH_SERVICE_REMINDER_MESSAGE = (userName) => `元気にしてるかな、${userName}？😌 メッセージ届いてるかなって、ちょっと心配になっちゃったよ。実はね、もしOKの返事がないと、家族の人に連絡がいっちゃうことになってるんだ💦 だから、もし大丈夫だったら、絵文字ひとつでもいいから「OK」って送ってくれると嬉しいな🍀 私も心配だし、家族の人にも迷惑かけたくないから、できるだけ早めに返事もらえると助かるな。無理はしないでね！`;

const WATCH_SERVICE_EMERGENCY_ALERT_MESSAGE = (userName, userId) => `【NPO法人コネクト：安否確認緊急アラート】\nご登録のユーザー様（LINE ID: ${userId.substring(0, 8)}...、LINE表示名: ${userName || '不明'}）より、安否確認メッセージに29時間（24+5時間）以上応答がありません。緊急連絡先としてご登録いただいておりますので、念のため、安否をご確認いただけますでしょうか。\n\nこのメッセージは、ご登録時に承諾いただいた見守りサービスに基づき送信しております。\n\n※このメッセージに返信しても、ご本人様には届きません。`;

const WATCH_SERVICE_EMERGENCY_ALERT_MESSAGE_TO_OFFICERS = (userName, userId, emergencyContact) => `🚨【理事会緊急通知】安否未確認アラート🚨\n\nNPO法人コネクトの見守りサービスにて、以下のユーザー様について安否確認ができておりません。\n\n- LINEユーザーID: ${userId}\n- LINE表示名: ${userName || '不明'}\n- 緊急連絡先: ${emergencyContact || '未登録'}\n\n定期メッセージ送信後、29時間以上応答がないため、緊急連絡先に通知いたしました。\n必要に応じて、速やかに状況確認をお願いいたします。`;

// 詐欺検出時の理事会グループへの通知メッセージ (SCAM_DETECTED_EMERGENCY_ALERT_MESSAGE は削除済み)
const SCAM_DETECTED_OFFICER_ALERT_MESSAGE = (userName, userId, emergencyContact, detectedMessage) => `🚨【理事会緊急通知】詐欺ワード検出アラート🚨\n\nNPO法人コネクトの見守りサービスにて、以下のユーザー様から詐欺・危険と判断されるメッセージを受信しました。\n\n- LINEユーザーID: ${userId}\n- LINE表示名: ${userName || '不明'}\n- 緊急連絡先: ${emergencyContact || '未登録'}\n- 受信メッセージ:\n「${detectedMessage}」\n\n必要に応じて、速やかに状況確認をお願いいたします。`;


// --- ここまで定数と設定 ---


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

// --- ここから補助関数の定義 (変更なし) ---

const checkSpecialReply = (message) => {
    const lowerMessage = message.toLowerCase();

    if (lowerMessage.includes("名前")) {
        return "私の名前は皆守こころ（みなもりこころ）です🌸こころちゃんって呼んでね💖";
    }
    if (lowerMessage.includes("誰が作った")) {
        return "コネクトの理事長さんが、みんなの幸せを願って私を作ってくれたんだよ🌱";
    }
    if (lowerMessage.includes("こんにちは") || lowerMessage.includes("こんにちわ")) {
        return "まつさん、こんにちは～！😊 今日も元気かな？";
    }
    if (lowerMessage.includes("おはよう")) {
        return "まつさん、おはよう！😊 良い一日になるといいね！";
    }
    if (lowerMessage.includes("こんばんは") || lowerMessage.includes("こんばんわ")) {
        return "まつさん、こんばんは！😊 今日も一日お疲れ様でした！";
    }
    if (lowerMessage.includes("ありがとう") || lowerMessage.includes("ありがとうございます")) {
        return "どういたしまして！まつさんの役に立てて嬉しいな💖";
    }
    if (lowerMessage.includes("元気") && lowerMessage.includes("？")) {
        return "私はいつも元気だよ！まつさんも元気にしてるかな？😊";
    }
    return null;
};

const containsDangerWords = (message) => {
    const dangerWords = [
        "死にたい", "自殺", "消えたい", "もう無理", "助けて", "苦しい",
        "いじめ", "暴力", "虐待", "ハラスメント", "レイプ", "性的", "体調が悪い",
        "助けを求めている", "危険な場所", "一人で抱え込んでいる", "薬物", "ドラッグ",
        "倒れそう", "意識がない", "救急車", "病院に行く", "病気", "鬱", "うつ",
        "精神的に辛い", "リストカット", "自傷行為"
    ];
    const lowerMessage = message.toLowerCase();
    return dangerWords.some(word => lowerMessage.includes(word));
};

const containsScamWords = (message) => {
    const scamWords = [
        "詐欺", "だまし", "騙し", "怪しい話", "儲かる", "絶対儲かる",
        "高額報酬", "副業", "未公開株", "当選", "無料プレゼント", "タダ",
        "一口", "必ず", "送金", "入金", "振り込み", "キャッシュカード",
        "暗証番号", "ワンクリック", "オレオレ", "架空請求", "公的機関をかたる",
        "還付金", "投資話", "ロマンス詐欺", "国際ロマンス", "美人局",
        "副業で稼ぐ", "仮想通貨", "レターパック", "宅配業者", "緊急", "早急に",
        "個人情報", "送ってください", "銀行口座", "口座番号", "クレジットカード",
        "カード情報", "パスワード", "認証コード", "最終警告", "差し押さえ",
        "税金", "税務署", "年金事務所", "区役所", "市役所", "警察", "検察", "弁護士",
        "消費者センター", "裁判所", "SNS投資", "LINE投資", "SNS副業", "LINE副業"
    ];
    const lowerMessage = message.toLowerCase();
    return scamWords.some(word => lowerMessage.includes(word));
};

const containsScamPhrases = (message) => {
    const scamPhrases = [
        "あなただけ", "特別なあなた", "秘密の話", "誰にも言わないで",
        "今すぐクリック", "確認のため", "個人情報を入力してください",
        "至急連絡ください", "電話番号を教えてください", "住所を教えてください",
        "口座に振り込んでください", "現金書留で送ってください",
        "ログインしてください", "アプリをダウンロード", "パスワード変更",
        "セキュリティ強化", "アカウント凍結", "アカウント停止",
        "身に覚えのない請求", "有料コンテンツ", "支払いが滞っている",
        "料金を滞納している", "最終通告", "本日中に", "訴訟を起こします",
        "仮想通貨の投資", "FX投資", "高利回り", "元本保証", "紹介制度",
        "オンラインカジノ", "オンラインギャンブル", "儲け話",
        "簡単な作業で稼げる", "スマホだけで稼ぐ", "誰でも稼げる",
        "友だち追加", "LINEで連絡", "LINEに誘導", "LINEグループ招待",
        "高額配当", "日利", "月利"
    ];
    const lowerMessage = message.toLowerCase();
    return scamPhrases.some(phrase => lowerMessage.includes(phrase));
};

const containsStrictInappropriateWords = (message) => {
    const strictInappropriateWords = [
        "死ね", "殺す", "アホ", "バカ", "クソ", "カス", "ボケ",
        "キモい", "ブス", "デブ", "障害", "差別", "性交", "セックス",
        "ちんこ", "まんこ", "ふたなり", "ホモ", "レズ", "障害者",
        "死ね", "殺す", "馬鹿", "阿呆", "カス野郎", "死んでしまえ",
        "狂ってる", "異常者", "気持ち悪い", "不細工", "デブ", "不潔",
        "変態", "売春", "買春", "強姦", "売女", "強盗", "詐欺", "犯罪",
        "麻薬", "覚せい剤", "売人", "ヤクザ", "暴力団", "テロ", "殺人",
        "爆弾", "銃", "ナイフ", "刺す", "殴る", "蹴る", "血", "死体",
        "エロ", "アダルト", "ポルノ", "AV", "風俗", "ソープ", "ゲイ",
    ];
    const lowerMessage = message.toLowerCase();
    return strictInappropriateWords.some(word => lowerMessage.includes(word));
};

const containsHomeworkTriggerWords = (message) => {
    const homeworkWords = [
        "宿題", "課題", "レポート", "答え", "解き方", "教えて",
        "プログラミング", "コード", "エラー", "勉強", "問題集", "テスト",
        "論文", "計算", "翻訳", "要約", "添削", "作文", "英文法", "数学",
        "科学", "歴史", "地理", "国語", "理科", "社会", "英単語", "公式"
    ];
    const lowerMessage = message.toLowerCase();
    return homeworkWords.some(word => lowerMessage.includes(word));
};

const containsOrganizationInquiryWords = (message) => {
    const inquiryWords = [
        "コネクト", "NPO法人", "団体", "法人", "会社", "運営", "どんな", "何してる",
        "詳細", "どこ", "活動内容", "ホームページ", "サイト"
    ];
    const lowerMessage = message.toLowerCase();
    return inquiryWords.some(word => lowerMessage.includes(word));
};

// --- ここまで補助関数の定義 ---

// handleEvent関数の修正
async function handleEvent(event) {
    const userId = event.source.userId;
    const replyToken = event.replyToken;
    let userMessage = '';
    let isPostbackEvent = false;
    let postbackAction = null;

    if (event.type === 'message' && event.message.type === 'text') {
        userMessage = event.message.text.trim();
        // "OK"メッセージの特殊処理 (テキストの場合)
        if (userMessage.toUpperCase() === "OK") {
            const user = await User.findOne({ userId });
            if (user && user.watchService.isRegistered) {
                user.watchService.lastContact = moment().tz("Asia/Tokyo").toDate();
                await user.save();
                console.log(`User ${userId} replied OK to watch service message (text).`);
                await ChatLog.create({ userId, userMessage: userMessage, botResponse: "OK応答によりlastContact更新", modelUsed: "System/WatchServiceOK" });
                return Promise.resolve(null); // 処理を終了
            }
        }
    } else if (event.type === 'postback') {
        isPostbackEvent = true;
        const data = new URLSearchParams(event.postback.data);
        postbackAction = data.get('action');
        userMessage = `[Postback Action: ${postbackAction}]`; // ログ用

        // 見守りサービスの「OK」ボタンからのPostback
        if (postbackAction === 'watch_ok') {
            const user = await User.findOne({ userId });
            if (user && user.watchService.isRegistered) {
                user.watchService.lastContact = moment().tz("Asia/Tokyo").toDate();
                await user.save();
                console.log(`User ${userId} tapped OK button for watch service.`);
                await ChatLog.create({ userId, userMessage: userMessage, botResponse: "OKボタンタップによりlastContact更新", modelUsed: "System/WatchServiceOKButton" });
                return client.replyMessage(replyToken, { type: 'text', text: 'ありがとう！確認したよ😊' });
            }
        }
        // 見守りサービスの登録Postback
        else if (postbackAction === 'watch_register') {
            let user = await User.findOne({ userId }); // let で再宣言可能にする
            if (!user) { // ユーザーが存在しない場合は作成
                user = new User({ userId: userId });
                await user.save();
            }
            if (user.watchService.isRegistered) {
                await client.replyMessage(replyToken, { type: 'text', text: "すでに登録されているよ！🌸 緊急連絡先を変更したい場合は、新しい番号を送ってね😊" });
            } else {
                user.watchService.status = 'awaiting_number';
                await user.save();
                await client.replyMessage(replyToken, { type: 'text', text: "見守りサービスへのご登録ありがとう💖 緊急連絡先の電話番号（ハイフンなし）か、LINE IDを教えてくれるかな？間違えないように注意してね！😊" });
            }
            await ChatLog.create({ userId, userMessage: userMessage, botResponse: `System/WatchServiceRegister action: ${postbackAction}`, modelUsed: "System" });
            return Promise.resolve(null); // 処理を終了
        }
        // 見守りサービスの解除Postback
        else if (postbackAction === 'watch_unregister') {
            let user = await User.findOne({ userId }); // let で再宣言可能にする
             if (!user) { // ユーザーが存在しない場合は作成
                user = new User({ userId: userId });
                await user.save();
            }
            user.watchService.isRegistered = false;
            user.watchService.emergencyContactNumber = null;
            user.watchService.status = 'none';
            await user.save();
            await client.replyMessage(replyToken, { type: 'text', text: "見守りサービスを解除したよ🌸 また利用したくなったら「見守りサービス」と話しかけてね😊" });
            await ChatLog.create({ userId, userMessage: userMessage, botResponse: `System/WatchServiceUnregister action: ${postbackAction}`, modelUsed: "System" });
            return Promise.resolve(null); // 処理を終了
        }
        // その他のPostbackイベントはここでは処理しないが、必要に応じて追加
        return Promise.resolve(null); // 未処理のPostbackもここで終了
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

    // 日次リセット、月次リセット (変更なし)
    if (!moment(user.lastDailyReset).tz("Asia/Tokyo").isSame(now, 'day')) {
        user.dailyMessageCount = 0;
        user.lastDailyReset = now.toDate();
    }
    if (!moment(user.lastMonthlyReset).tz("Asia/Tokyo").isSame(now, 'month')) {
        user.monthlyMessageCount = 0;
        user.lastMonthlyReset = now.toDate();
    }

    // レートリミットチェック (変更なし)
    if (!isPostbackEvent && now.diff(moment(user.lastMessageTimestamp), 'seconds') < RATE_LIMIT_SECONDS) {
        console.log(`🚫 ユーザー ${userId} がレートリミットに達成しました。(${now.diff(moment(user.lastMessageTimestamp), 'seconds')}秒経過)`);
        await ChatLog.create({ userId, userMessage: userMessage, botResponse: "レートリミットによりスキップ", modelUsed: "System/RateLimit" });
        return Promise.resolve(null);
    }

    // メッセージカウント更新と見守りサービス最終連絡日時更新 (変更なし)
    user.dailyMessageCount++;
    user.monthlyMessageCount++;
    user.lastMessageTimestamp = now.toDate();
    if (!isPostbackEvent || postbackAction !== 'watch_ok') {
        user.watchService.lastContact = now.toDate();
    }
    await user.save();

    let replyText = '';
    let modelUsed = '';
    let loggedAsSystemAction = false;

    const originalUserMessage = userMessage; // ログ用に元のメッセージを保持

    // === ここからメッセージ処理ロジック ===

    // 見守りサービス関連コマンドの処理を最優先
    if (userMessage.includes("見守り")) {
        if (!userMembershipConfig.canUseWatchService) {
            replyText = "ごめんね💦 見守りサービスは無料会員以上の方が利用できるサービスなんだ🌸 会員登録をすると利用できるようになるよ😊";
            modelUsed = "System/WatchServiceDenied";
            await client.replyMessage(replyToken, { type: 'text', text: replyText });
            await ChatLog.create({ userId, userMessage: originalUserMessage, botResponse: replyText, modelUsed: modelUsed });
            return Promise.resolve(null); // 処理を終了
        } else {
            await client.replyMessage(replyToken, watchServiceGuideFlex); // ボタン付きFlex Messageを送信
            replyText = "見守りサービスガイド表示";
            modelUsed = "System/WatchServiceGuide";
            await ChatLog.create({ userId, userMessage: originalUserMessage, botResponse: replyText, modelUsed: modelUsed });
            return Promise.resolve(null); // 処理を終了
        }
    }
    // 見守りサービス緊急連絡先入力待ち
    else if (user.watchService.status === 'awaiting_number') {
        const contactNumber = userMessage.trim();
        if (/^0\d{9,10}$/.test(contactNumber) || contactNumber.startsWith('@')) {
            user.watchService.emergencyContactNumber = contactNumber;
            user.watchService.isRegistered = true;
            user.watchService.status = 'none';
            await user.save();
            await client.replyMessage(replyToken, watchServiceNoticeConfirmedFlex(contactNumber));
            replyText = "見守りサービス連絡先登録完了";
            modelUsed = "System/WatchServiceContactRegistered";
            await ChatLog.create({ userId, userMessage: originalUserMessage, botResponse: replyText, modelUsed: modelUsed });
            return Promise.resolve(null); // 処理を終了
        } else {
            replyText = "ごめんね💦 それは電話番号かLINE IDじゃないみたい…。もう一度、緊急連絡先を教えてくれるかな？😊";
            modelUsed = "System/WatchServiceContactInvalid";
            await client.replyMessage(replyToken, { type: 'text', text: replyText });
            await ChatLog.create({ userId, userMessage: originalUserMessage, botResponse: replyText, modelUsed: modelUsed });
            return Promise.resolve(null); // 処理を終了
        }
    }
    // 固定返信のチェック
    const specialReply = checkSpecialReply(userMessage);
    if (specialReply) {
        replyText = specialReply;
        modelUsed = "FixedReply";
        loggedAsSystemAction = true;
        await client.replyMessage(replyToken, { type: 'text', text: replyText });
        await ChatLog.create({ userId, userMessage: originalUserMessage, botResponse: replyText, modelUsed: modelUsed });
        return Promise.resolve(null); // 処理を終了
    }
    // 危険ワードチェック (見守りサービス登録済みのユーザーのみ)
    else if (user.watchService.isRegistered && containsDangerWords(userMessage)) {
        replyText = `心配なメッセージを受け取りました。あなたは今、大丈夫？もし苦しい気持ちを抱えているなら、一人で抱え込まず、信頼できる人に話したり、専門の相談窓口に連絡してみてくださいね。${OFFICER_GROUP_ID ? `NPO法人コネクトの担当者にも通知しました。` : ''}あなたの安全が最優先です。`;
        
        // 緊急連絡先への通知 (危険ワード検出時) は、前回の指示通り詐欺検出時のメッセージを利用しないよう、現状は保留または別途定義が必要
        // もし、危険ワード検出時にも緊急連絡先へ通知したい場合は、ここにロジックを追加してください。
        // 例:
        // if (user.watchService.emergencyContactNumber) {
        //     let userName = "不明なユーザー";
        //     try {
        //         const userProfile = await client.getProfile(user.userId);
        //         userName = userProfile.displayName;
        //     } catch (profileError) {
        //         console.warn(`Could not get profile for user ${user.userId}:`, profileError);
        //     }
        //     const dangerAlertMessage = `【緊急】ユーザー様（LINE表示名: ${userName || '不明'}）より、危険な内容（"${originalUserMessage}"）を含むメッセージが検出されました。安否をご確認ください。`;
        //     try {
        //         await client.pushMessage(user.watchService.emergencyContactNumber, { type: 'text', text: dangerAlertMessage });
        //         console.log(`Sent emergency alert (Danger Word) to ${user.watchService.emergencyContactNumber} for user ${user.userId}`);
        //     } catch (alertError) {
        //         console.error(`Failed to send emergency alert (Danger Word) to ${user.watchService.emergencyContactNumber} for user ${user.userId}:`, alertError);
        //     }
        // }

        // 理事会グループへの通知 (危険ワード検出時)
        if (OFFICER_GROUP_ID) {
            let userName = "不明なユーザー";
            try {
                const userProfile = await client.getProfile(user.userId);
                userName = userProfile.displayName;
            } catch (profileError) {
                console.warn(`Could not get profile for user ${user.userId}:`, profileError);
            }
            const officersAlert = SCAM_DETECTED_OFFICER_ALERT_MESSAGE(userName, user.userId, user.watchService.emergencyContactNumber, originalUserMessage); // 詐欺用メッセージを流用
            try {
                await client.pushMessage(OFFICER_GROUP_ID, { type: "text", text: officersAlert });
                console.log(`Sent emergency alert (Danger Word) to Officer Group ${OFFICER_GROUP_ID} for user ${user.userId}`);
            } catch (officerAlertError) {
                console.error(`Failed to send emergency alert (Danger Word) to Officer Group for user ${user.userId}:`, officerAlertError);
            }
        }

        modelUsed = "System/DangerWords";
        loggedAsSystemAction = true;
        await client.replyMessage(replyToken, { type: 'text', text: replyText });
        await ChatLog.create({ userId, userMessage: originalUserMessage, botResponse: replyText, modelUsed: modelUsed });
        return Promise.resolve(null); // 処理を終了
    }
    // 詐欺ワードチェック
    else if (containsScamWords(userMessage) || containsScamPhrases(userMessage)) {
        await client.replyMessage(replyToken, emergencyFlex); // ユーザーには相談窓口のFlex Messageを返す (維持)

        // *** 緊急連絡先への通知は削除済み ***

        // 理事会グループへの通知 (詐欺ワード検出時) は維持
        if (OFFICER_GROUP_ID) {
            let userName = "不明なユーザー";
            try {
                const userProfile = await client.getProfile(user.userId);
                userName = userProfile.displayName;
            } catch (profileError) {
                console.warn(`Could not get profile for user ${user.userId}:`, profileError);
            }
            const officersAlert = SCAM_DETECTED_OFFICER_ALERT_MESSAGE(userName, user.userId, user.watchService.emergencyContactNumber, originalUserMessage);
            try {
                await client.pushMessage(OFFICER_GROUP_ID, { type: "text", text: officersAlert });
                console.log(`Sent emergency alert (Scam) to Officer Group ${OFFICER_GROUP_ID} for user ${user.userId}`);
            } catch (officerAlertError) {
                console.error(`Failed to send emergency alert (Scam) to Officer Group for user ${user.userId}:`, officerAlertError);
            }
        }

        replyText = "詐欺アラートメッセージ表示"; // ログ用
        modelUsed = "System/ScamWords";
        await ChatLog.create({ userId, userMessage: originalUserMessage, botResponse: replyText, modelUsed: modelUsed });
        return Promise.resolve(null); // 処理を終了
    }
    // 不適切ワードチェック
    else if (containsStrictInappropriateWords(userMessage)) {
        replyText = "ごめんね💦 その表現は、私（こころ）と楽しくお話しできる内容ではないみたい🌸";
        modelUsed = "System/InappropriateWord";
        loggedAsSystemAction = true;
        await client.replyMessage(replyToken, { type: 'text', text: replyText });
        await ChatLog.create({ userId, userMessage: originalUserMessage, botResponse: replyText, modelUsed: modelUsed });
        return Promise.resolve(null); // 処理を終了
    }
    // 宿題トリガーチェック
    else if (containsHomeworkTriggerWords(userMessage)) {
        replyText = "ごめんね💦 わたしは宿題を直接お手伝いすることはできないんだ。でも、勉強になるサイトや考えるヒントになる場所なら教えられるかも？";
        modelUsed = "System/HomeworkTrigger";
        loggedAsSystemAction = true;
        await client.replyMessage(replyToken, { type: 'text', text: replyText });
        await ChatLog.create({ userId, userMessage: originalUserMessage, botResponse: replyText, modelUsed: modelUsed });
        return Promise.resolve(null); // 処理を終了
    }
    // NPO法人コネクトに関する問い合わせチェック
    else if (containsOrganizationInquiryWords(userMessage)) {
        replyText = "NPO法人コネクトはこころちゃんのイメージキャラクターとして、みんなと楽しくお話ししたり、必要な情報提供をしたりしているよ😊　もっと詳しく知りたい方のために、ホームページを用意させて頂いたな！ → https://connect-npo.org";
        modelUsed = "System/OrganizationInquiry";
        loggedAsSystemAction = true;
        await client.replyMessage(replyToken, { type: 'text', text: replyText });
        await ChatLog.create({ userId, userMessage: originalUserMessage, botResponse: replyText, modelUsed: modelUsed });
        return Promise.resolve(null); // 処理を終了
    }

    // Gemini AIとの連携 (上記いずれの条件にも当てはまらない場合のみ)
    try {
        const currentMembershipConfig = MEMBERSHIP_CONFIG[user.membership];
        const isChildAI = currentMembershipConfig && currentMembershipConfig.isChildAI;
        let chatModel;

        if (isChildAI) {
            chatModel = genAI.getGenerativeModel({ model: MEMBERSHIP_CONFIG.guest.model });
        } else {
            chatModel = genAI.getGenerativeModel({ model: userMembershipConfig.model });
        }

        const rawHistory = await ChatLog.find({ userId: userId })
            .sort({ timestamp: 1 })
            .limit(10);

        const geminiChatHistory = [];
        for (const log of rawHistory) {
            if (log.userMessage && log.botResponse) {
                geminiChatHistory.push({ role: 'user', parts: [{ text: log.userMessage }] });
                geminiChatHistory.push({ role: 'model', parts: [{ text: log.botResponse }] });
            }
        }

        const chat = chatModel.startChat({
            history: geminiChatHistory,
            generationConfig: {
                maxOutputTokens: 400,
            },
        });

        const MAX_MESSAGE_LENGTH = 400;
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

        await client.replyMessage(replyToken, { type: 'text', text: replyText });
        await ChatLog.create({ userId, userMessage: originalUserMessage, botResponse: replyText, modelUsed: modelUsed });

    } catch (error) {
        console.error('Gemini API エラー:', error);
        replyText = "ごめんね💦 今、ちょっと考え中みたい…。もう一度話しかけてくれると嬉しいな💖";
        modelUsed = "GeminiError";
        await client.replyMessage(replyToken, { type: 'text', text: replyText });
        await ChatLog.create({ userId, userMessage: originalUserMessage, botResponse: replyText, modelUsed: modelUsed });
    }
}

// MongoDBスキーマとモデル (変更なし)
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
        lastContact: { type: Date, default: Date.now },
        lastScheduledMessageSent: { type: Date, default: null },
    },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});
userSchema.index({ userId: 1 });
const User = mongoose.model('User', userSchema);

const chatLogSchema = new mongoose.Schema({
    userId: { type: String, required: true },
    userMessage: { type: String, required: true },
    botResponse: { type: String, required: true },
    timestamp: { type: Date, default: Date.now },
    modelUsed: { type: String, required: true }
});
chatLogSchema.index({ userId: 1, timestamp: -1 });
const ChatLog = mongoose.model('ChatLog', chatLogSchema);


// 定期実行ジョブのスケジューリング (変更なし)
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

// 見守りサービス定期メッセージと緊急アラートのスケジュール (変更なし)
schedule.scheduleJob('0 15 */3 * *', async () => { // 3日周期で15:00に実行
    console.log('Watch service periodic message job started (3-day cycle, 3 PM).');
    try {
        const registeredUsers = await User.find({ 'watchService.isRegistered': true });

        for (const user of registeredUsers) {
            const threeDaysAgoFromScheduledTime = moment().tz("Asia/Tokyo").subtract(3, 'days').toDate();
            
            // 前回スケジュールメッセージ送信後、ユーザーが応答しているかを確認
            const hasRespondedSinceLastScheduledMessage = user.watchService.lastScheduledMessageSent && 
                                                        moment(user.watchService.lastContact).isAfter(moment(user.watchService.lastScheduledMessageSent));

            // 最後のスケジュールメッセージ送信がない、または3日以上経過していて、かつその間に応答があった場合のみ送信
            if (!user.watchService.lastScheduledMessageSent || 
                (moment(user.watchService.lastScheduledMessageSent).isBefore(threeDaysAgoFromScheduledTime) && hasRespondedSinceLastScheduledMessage)) {

                const messageIndex = Math.floor(Math.random() * WATCH_SERVICE_MESSAGES.length);
                const messageContent = WATCH_SERVICE_MESSAGES[messageIndex];
                const flexMessage = WATCH_SERVICE_PERIODIC_FLEX(messageContent);
                
                try {
                    await client.pushMessage(user.userId, flexMessage);
                    const sentTime = moment().tz("Asia/Tokyo").toDate();
                    user.watchService.lastScheduledMessageSent = sentTime;
                    await user.save(); 

                    console.log(`Sent periodic watch Flex Message to user ${user.userId}`);

                    // 24時間後のリマインダーをスケジュール
                    const reminderScheduleTime = moment(sentTime).add(24, 'hours').toDate();
                    // 24時間 + 5時間後の緊急通知をスケジュール
                    const emergencyScheduleTime = moment(sentTime).add(24 + 5, 'hours').toDate();

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
                        // ユーザーが見守りサービスを登録しており、かつ定期メッセージ送信後に連絡がない場合のみ
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

                    // 24時間 + 5時間後の緊急通知
                    schedule.scheduleJob(emergencyScheduleTime, async () => {
                        const finalUserCheck = await User.findOne({ userId: user.userId });
                        // ユーザーが見守りサービスを登録しており、緊急連絡先があり、かつリマインダー送信後も連絡がない場合のみ
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`サーバーがポート ${PORT} で起動しました。`);
});

setInterval(() => {
    const hostname = process.env.RENDER_EXTERNAL_HOSTNAME || `localhost:${PORT}`;
    http.get(`http://${hostname}`);
    console.log('Sent keep-alive request.');
}, 5 * 60 * 1000);
