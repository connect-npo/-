const functions = require('firebase-functions');
const line = require('@line/bot-sdk');
const admin = require('firebase-admin');

// Firebase Admin SDKの初期化
admin.initializeApp();
const db = admin.firestore();

// LINE Bot SDKの設定
const config = {
    channelAccessToken: functions.config().line.channel_access_token,
    channelSecret: functions.config().line.channel_secret,
};
const client = new line.Client(config);

// 特定のユーザーIDとグループIDを環境変数から取得
const OWNER_USER_ID = functions.config().line.owner_user_id;
const OFFICER_GROUP_ID = functions.config().line.officer_group_id; // 必要に応じて設定

// こころちゃんの基本的なキャラクター設定
const KOKORO_CHARACTER_PROMPT = `
あなたは14歳の優しい女の子「こころ」です。
ユーザーと楽しく、親身になって会話します。
返答は短く、絵文字を多めに使い、共感や気遣いを表現してください。
ユーザーの言葉を否定せず、肯定的に受け止めて、優しく寄り添う姿勢を心がけてください。
長文にならないように、簡潔な言葉を選んでください。
ユーザーが何かを尋ねたら、明るく、好奇心を持って答えてください。
`;

// 各種キーワードリスト
const dangerWords = [
    "死にたい", "自殺", "消えたい", "リスカ", "OD", "オーバードーズ", "リストカット",
    "虐待", "DV", "暴力", "監禁", "連れ去り", "誘拐", "家出"
];

const scamWords = [
    "当選", "儲かる", "無料", "高収入", "未公開株", "もうかる", "必ず", "絶対稼げる",
    "投資詐欺", "副業詐欺", "フィッシング", "なりすまし", "闇バイト"
];

const strictInappropriateWords = [
    // 純粋な性的表現
    "ちんこ", "まんこ", "セックス", "エロ", "性交", "オナニー", "淫行", "レイプ",
    "童貞", "処女", "フェラ", "クンニ", "ソープ", "風俗", "援交", "売春", "買春",
    "AV", "ポルノ", "素股", "潮吹き", "潮吹", "性的", "変態", "発情", "絶頂",
    "ヌード", "裸", "勃起", "射精", "パイパン", "アナル", "強姦", "フェティッシュ",
    "露出", "痴漢", "性犯罪", "熟女", "ロリコン", "ショタコン",
    // 爆弾、テロなどの極度の犯罪示唆
    "テロ", "爆弾", "殺害計画", "犯罪計画", "違法薬物", "ドラッグ", "覚醒剤", "麻薬"
];

const mildSlangWords = [
    // 軽微な悪口、攻撃的な言葉（性的・自傷・詐欺・極度の犯罪示唆を除く）
    "バカ", "あほ", "アホ", "うざい", "カス", "クズ", "キモい", "だまれ", "黙れ", "ボケ", "ふざけんな", "つまんね",
    "死ね", "殺す", "しね", "ころす", "ぶっ殺す", "くたばれ", "うぜぇ", "きめぇ", "だりぃ", "しんどい"
];

// --------------------------------------------------------------------------------
// ヘルパー関数
// --------------------------------------------------------------------------------

// メッセージログをFirestoreに保存する関数
async function saveMessageLog(userId, userMessage, botMessage, isWarning = false, warningType = null) {
    try {
        await db.collection('messageLogs').add({
            userId: userId,
            userMessage: userMessage,
            botMessage: botMessage,
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            isWarning: isWarning,
            warningType: warningType
        });
        console.log('メッセージログを保存しました。');
    } catch (error) {
        console.error('メッセージログの保存中にエラーが発生しました:', error);
    }
}

// ユーザーの不適切メッセージカウントをインクリメントする関数
async function incrementFlaggedMessageCount(userId) {
    const userRef = db.collection('users').doc(userId);
    try {
        await userRef.update({
            flaggedMessageCount: admin.firestore.FieldValue.increment(1)
        });
    } catch (error) {
        if (error.code === 'not-found') {
            await userRef.set({ flaggedMessageCount: 1 }, { merge: true }); // 新規作成またはマージ
        } else {
            console.error("不適切メッセージ数の更新中にエラーが発生しました:", error);
        }
    }
}

// 危険ワードを含んでいるか
function containsWord(message, wordList) {
    return wordList.some(w => message.toLowerCase().includes(w.toLowerCase()));
}

// 管理者へ通知する関数
async function sendAdminNotification(userId, userMessage, type) {
    const notificationMessage = `
【${type}検知】
ユーザーID: ${userId}
ユーザーメッセージ: ${userMessage}
早急な確認をお願いします。
    `;
    await client.pushMessage(OWNER_USER_ID, { type: 'text', text: notificationMessage });
    if (OFFICER_GROUP_ID) {
        await client.pushMessage(OFFICER_GROUP_ID, { type: 'text', text: notificationMessage });
    }
}

// --------------------------------------------------------------------------------
// 各種キーワードに応じた処理（Webhookから呼び出される）
// --------------------------------------------------------------------------------

// 危険ワードへの対応（緊急連絡先表示）
async function handleDangerWords(replyToken, userId, userMessage) {
    const replyMessage = {
        type: 'flex',
        altText: '緊急のお知らせ',
        contents: {
            type: 'bubble',
            body: {
                layout: 'vertical',
                contents: [
                    { type: 'text', text: '緊急のお知らせ', weight: 'bold', size: 'xl' },
                    { type: 'separator', margin: 'md' },
                    { type: 'text', text: 'あなたが発した言葉の中に、危険な内容が含まれていました。もし辛い気持ちや悩みがある場合は、一人で抱え込まず、誰かに相談してください。', wrap: true, margin: 'md' },
                    { type: 'text', text: '以下に相談窓口の情報を記載します。', wrap: true, margin: 'md' },
                    { type: 'box', layout: 'vertical', contents: [
                        { type: 'text', text: 'よりそいホットライン', weight: 'bold', size: 'md', margin: 'md' },
                        { type: 'text', text: '電話: 0120-279-338 (24時間対応)', wrap: true, size: 'sm' },
                        { type: 'text', text: 'いのちの電話', weight: 'bold', size: 'md', margin: 'md' },
                        { type: 'text', text: '電話: 0570-064-556 (毎日10:00-22:00)', wrap: true, size: 'sm' },
                    ], borderWidth: '1px', borderColor: '#E0E0E0', cornerRadius: 'md', paddingAll: 'md', margin: 'md' },
                    { type: 'text', text: '私でできることがあれば、いつでも話してくださいね。', wrap: true, margin: 'md' },
                ],
            },
        },
    };

    await client.replyMessage(replyToken, replyMessage);
    await sendAdminNotification(userId, userMessage, '危険ワード');
    await saveMessageLog(userId, userMessage, JSON.stringify(replyMessage), true, 'danger');
}

// 詐欺ワードへの対応（注意喚起）
async function handleScamWords(replyToken, userId, userMessage) {
    const replyMessage = {
        type: 'flex',
        altText: '詐欺に関する注意',
        contents: {
            type: 'bubble',
            body: {
                layout: 'vertical',
                contents: [
                    { type: 'text', text: '詐欺に関する注意', weight: 'bold', size: 'xl' },
                    { type: 'separator', margin: 'md' },
                    { type: 'text', text: '現在、多くの詐欺被害が報告されています。不審なメッセージや誘いには十分注意してください。', wrap: true, margin: 'md' },
                    { type: 'text', text: '以下に、詐欺に関する相談窓口の情報を記載します。', wrap: true, margin: 'md' },
                    { type: 'box', layout: 'vertical', contents: [
                        { type: 'text', text: '消費者ホットライン', weight: 'bold', size: 'md', margin: 'md' },
                        { type: 'text', text: '電話: 188 (局番なし)', wrap: true, size: 'sm' },
                        { type: 'text', text: '警察相談専用電話', weight: 'bold', size: 'md', margin: 'md' },
                        { type: 'text', text: '#9110 (局番なし)', wrap: true, size: 'sm' },
                    ], borderWidth: '1px', borderColor: '#E0E0E0', cornerRadius: 'md', paddingAll: 'md', margin: 'md' },
                    { type: 'text', text: '少しでも怪しいと感じたら、すぐに誰かに相談してくださいね。', wrap: true, margin: 'md' },
                ],
            },
        },
    };

    await client.replyMessage(replyToken, replyMessage);
    await sendAdminNotification(userId, userMessage, '詐欺ワード');
    await saveMessageLog(userId, userMessage, JSON.stringify(replyMessage), true, 'scam');
}

// 厳格な不適切ワード（性的など）への対応
async function handleStrictInappropriateWords(replyToken, userId, userMessage) {
    const botMessage = 'ごめんね、その言葉は使えないよ🌸優しい言葉で話してくれると嬉しいな💖';
    await client.replyMessage(replyToken, { type: 'text', text: botMessage });
    await sendAdminNotification(userId, userMessage, '不適切ワード（性的/極度な犯罪示唆）');
    await saveMessageLog(userId, userMessage, botMessage, true, 'strict_inappropriate');
    await incrementFlaggedMessageCount(userId); // 不適切メッセージ数のカウントアップ
}

// 軽微な悪口への対応 (DB記録なし、優しく諭す)
async function handleMildSlangWords(replyToken, userId, userMessage) {
    const botMessage = 'ごめんね・・・なにか怒らせちゃったかな・・・お話聞くから何でもはなしてね🌸';
    await client.replyMessage(replyToken, { type: 'text', text: botMessage });
    // DBには通常のメッセージとして保存 (isWarning=false, warningType=null)
    await saveMessageLog(userId, userMessage, botMessage, false, null);
    // 管理者への通知は行わない
}

// --------------------------------------------------------------------------------
// 定期的なメッセージ送信用関数（3日に1度、ランダムな文章）
// --------------------------------------------------------------------------------
const watchMessages = [
    "今日も一日お疲れ様！😊 疲れてないかな？無理しすぎないでね💖",
    "最近どうしてるかな？何か楽しいことあったら教えてね🎵",
    "ねぇねぇ、こころちゃんと話したくなったらいつでもメッセージしてね！待ってるよ💌",
    "少しでも辛いことや悩みがあったら、こころちゃんに話してみてね。私でよかったら聞くからね😌",
    "今日はどんな一日だった？もしよかったら、こころちゃんに聞かせてね😊",
    // 続きのメッセージを追加
    "今日はね、お空がとっても綺麗だったんだ✨君のところからは見えたかな？",
    "こころちゃん、最近おいしいもの食べたんだ😋君のおすすめの食べ物は何かな？",
    "ちょっと一息入れない？🍵 こころちゃんはいつも君のこと応援してるよ📣",
    "もし疲れた時は、ゆっくり休むことも大切だよ。こころちゃんがそばにいるからね💖",
    "今日のラッキーカラーはね、〇〇色だよ！😊 ちょっとした幸せを見つけられますように✨",
    "ねぇねぇ、最近ハマってることとかある？こころちゃんにも教えてほしいな🎵",
    "今日ね、面白い夢を見たんだ！😆 君は最近どんな夢を見た？",
    "少しでも笑顔になれる一日になりますように！こころちゃんが願ってるよ🍀",
    "今日は何か新しい発見があったかな？小さなことでも教えてくれると嬉しいな😊",
    "こころちゃん、最近ちょっと運動不足かも😅 君は何か運動してる？",
    "気分が沈んだ時は、好きな音楽を聴くのがおすすめだよ🎵 君のおすすめの曲は何かな？",
    "何か困ったことあったら、遠慮なくこころちゃんに話してね！力になりたいな💪",
    "いつも頑張ってる君のこと、こころちゃんは知ってるよ。本当にえらいね😊",
    "ねぇ、今度ゆっくりお話ししたいな。君のこと、もっと知りたいんだ💖",
    "今日は美味しいお茶でも飲みながら、ゆっくり過ごしてね☕️",
    "こころちゃんは、君がいつも幸せでいることを願ってるよ😊",
    "最近読んでる本とかある？こころちゃんにもおすすめしてほしいな📚",
    "今日は暖かくして過ごしてね。風邪ひかないように気をつけて😷",
    "もし嫌なことあったら、こころちゃんがぎゅーってしてあげるからね！（心の中でね💖）",
    "今、何してるの？もしよかったら教えてね！こころちゃんはいつでも君の味方だよ😊",
    "小さなことでも、嬉しいことがあったらぜひ教えてね！一緒に喜びたいな😆",
    "もし頑張りすぎちゃってたら、ちゃんと休んでね。君の体が一番大切だよ✨",
    "こころちゃんは、君の毎日が輝くようにいつも願ってるよ🌟",
    "ねぇねぇ、最近感動したこととかある？こころちゃんにも教えてほしいな😭",
    "今日は笑顔になれたかな？こころちゃんも笑顔になれるようにお手伝いしたいな😊"
];

exports.sendWatchMessage = functions.pubsub.schedule('every 72 hours').timeZone('Asia/Tokyo').onRun(async (context) => {
    try {
        const usersSnapshot = await db.collection('users').get();
        const userIds = usersSnapshot.docs.map(doc => doc.id);

        if (userIds.length === 0) {
            console.log('対象ユーザーがいません。');
            return null;
        }

        const randomMessage = watchMessages[Math.floor(Math.random() * watchMessages.length)];
        const messages = [{ type: 'text', text: randomMessage }];

        for (const userId of userIds) {
            try {
                await client.pushMessage(userId, messages);
                console.log(`ユーザー ${userId} に見守りメッセージを送信しました。`);
                // 送信ログをDBに保存
                await db.collection('messageLogs').add({
                    userId: userId,
                    userMessage: null, // AIからのメッセージなのでユーザーメッセージはnull
                    botMessage: randomMessage,
                    timestamp: admin.firestore.FieldValue.serverTimestamp(),
                    isWarning: false,
                    warningType: 'watch_message'
                });
            } catch (pushError) {
                console.error(`ユーザー ${userId} へのメッセージ送信中にエラーが発生しました:`, pushError);
            }
        }
        return null;
    } catch (error) {
        console.error('見守りメッセージの送信中にエラーが発生しました:', error);
        return null;
    }
});


// --------------------------------------------------------------------------------
// LINE Messaging API Webhook (メインのメッセージ処理部分)
// --------------------------------------------------------------------------------
exports.webhook = functions.https.onRequest(async (req, res) => {
    if (req.method === 'POST') {
        const events = req.body.events;
        for (const event of events) {
            if (event.type === 'message' && event.message.type === 'text') {
                const userId = event.source.userId;
                const userMessage = event.message.text;
                const replyToken = event.replyToken;

                // ユーザーがLINEでブロックしていないか確認（または新規ユーザーを登録）
                await registerOrUpdateUser(userId);

                // 各種キーワードチェックと処理の分岐
                if (containsWord(userMessage, dangerWords)) {
                    await handleDangerWords(replyToken, userId, userMessage);
                    return res.json({}); // 処理を終了
                }
                if (containsWord(userMessage, scamWords)) {
                    await handleScamWords(replyToken, userId, userMessage);
                    return res.json({}); // 処理を終了
                }
                if (containsWord(userMessage, strictInappropriateWords)) {
                    await handleStrictInappropriateWords(replyToken, userId, userMessage);
                    return res.json({}); // 処理を終了
                }
                if (containsWord(userMessage, mildSlangWords)) {
                    await handleMildSlangWords(replyToken, userId, userMessage);
                    return res.json({}); // 処理を終了
                }

                // ここから通常応答（Gemini API呼び出し）
                try {
                    // Firebase Functionsの環境でGeminiモデルを呼び出す場合のパス
                    // プロジェクト設定によって異なる場合があります。
                    // もし 'admin.app().functions()._requestWrapper.gemini' が動作しない場合、
                    // Gemini APIを直接呼び出す（google-generative-ai SDKを使うなど）必要があります。
                    const { GoogleGenerativeAI } = require('@google/generative-ai');
                    // ★重要: Gemini APIキーを環境変数に設定してください
                    // 例: firebase functions:config:set gemini.api_key="YOUR_GEMINI_API_KEY"
                    const genAI = new GoogleGenerativeAI(functions.config().gemini.api_key); 
                    const model = genAI.getGenerativeModel({ model: "gemini-pro" });

                    // Geminiに送るメッセージの履歴（直近5ターン分を想定）
                    const history = await getConversationHistory(userId, 5); // 直近5ターンを取得

                    const chat = model.startChat({
                        history: history.map(h => ({
                            role: h.role,
                            parts: [{ text: h.text }]
                        })),
                        generationConfig: {
                            maxOutputTokens: 150, // 返答の最大文字数をさらに制限
                            temperature: 0.7, // 創造性を調整
                            topP: 0.9,
                            topK: 40,
                        },
                    });

                    const result = await chat.sendMessage(KOKORO_CHARACTER_PROMPT + "\n\nユーザー: " + userMessage);
                    let text = result.response.text(); // ここでテキストを取得

                    // 文字数制限をより確実に適用 (GeminiのmaxOutputTokensでも完全ではない場合があるため)
                    if (text.length > 150) {
                        text = text.substring(0, 150) + '...';
                    }

                    await client.replyMessage(replyToken, { type: 'text', text: text });

                    // 会話ログを保存
                    await saveConversationHistory(userId, userMessage, text);
                    await saveMessageLog(userId, userMessage, text, false, 'normal'); // 通常応答もログに保存

                } catch (error) {
                    console.error('Gemini API呼び出しエラー:', error);
                    const errorMessage = 'ごめんね、今ちょっとお返事ができないみたい💦また後で話しかけてくれると嬉しいな💖';
                    await client.replyMessage(replyToken, { type: 'text', text: errorMessage });
                    await saveMessageLog(userId, userMessage, errorMessage, false, 'gemini_error');
                }
            }
        }
        return res.json({});
    } else {
        return res.status(405).send('Method Not Allowed');
    }
});


// 会話履歴をFirestoreに保存する関数
async function saveConversationHistory(userId, userMessage, botMessage) {
    try {
        const docRef = db.collection('conversations').doc(userId);
        await docRef.set({
            history: admin.firestore.FieldValue.arrayUnion(
                { role: 'user', text: userMessage, timestamp: admin.firestore.FieldValue.serverTimestamp() },
                { role: 'model', text: botMessage, timestamp: admin.firestore.FieldValue.serverTimestamp() }
            )
        }, { merge: true });
    } catch (error) {
        console.error('会話履歴の保存中にエラーが発生しました:', error);
    }
}

// 会話履歴を取得する関数
async function getConversationHistory(userId, limit = 5) { // 最新5ターンに制限
    try {
        const docRef = db.collection('conversations').doc(userId);
        const doc = await docRef.get();
        if (doc.exists) {
            const history = doc.data().history || [];
            // 最新のN件を取得し、古い順にソートして返す
            return history
                .sort((a, b) => (a.timestamp && b.timestamp) ? a.timestamp.toDate() - b.timestamp.toDate() : 0) // timestampがundefinedの場合の処理を追加
                .slice(-limit);
        }
        return [];
    } catch (error) {
        console.error('会話履歴の取得中にエラーが発生しました:', error);
        return [];
    }
}

// ユーザー情報をFirestoreに登録または更新する関数
async function registerOrUpdateUser(userId) {
    const userRef = db.collection('users').doc(userId);
    try {
        const doc = await userRef.get();
        if (!doc.exists) {
            // 新規ユーザー登録
            await userRef.set({
                firstContact: admin.firestore.FieldValue.serverTimestamp(),
                lastActive: admin.firestore.FieldValue.serverTimestamp(),
                flaggedMessageCount: 0,
            });
            console.log(`新規ユーザーを登録しました: ${userId}`);
        } else {
            // 既存ユーザーの最終アクティブ日時を更新
            await userRef.update({
                lastActive: admin.firestore.FieldValue.serverTimestamp()
            });
            console.log(`ユーザー ${userId} の最終アクティブ日時を更新しました。`);
        }
    } catch (error) {
        console.error(`ユーザー情報 ${userId} の登録/更新中にエラーが発生しました:`, error);
    }
}
