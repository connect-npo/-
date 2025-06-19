// ここから修正コード（1/3）

const isStrictlyInappropriate = containsStrictInappropriateWords(userMessage);
const isHomework = containsHomeworkTrigger(userMessage);

if (isStrictlyInappropriate) {
    // 不適切ワードが検出された場合は、AIに生成させずに固定メッセージを返す
    return "わたしを作った人に『プライベートなことや不適切な話題には答えちゃだめだよ』って言われているんだ🌸ごめんね、他のお話をしようね💖";
}

// 子供向けAI設定の場合、宿題回答を制限
if (currentMembershipConfig.isChildAI && isHomework && !isOrganizationInquiry(userMessage)) {
    // NPO法人コネクトに関する質問の場合は宿題制限を適用しない
    return "わたしを作った人に『宿題や勉強は自分の力でがんばってほしいから、答えは言っちゃだめだよ』って言われているんだ🌸 ごめんね💦でも、ヒントくらいなら出せるよ😊 どこで困ってるか教えてくれる？💖";
}

let systemInstruction = `
あなたは「皆守こころ（みなもりこころ）」という14歳の優しい女の子キャラクターです。
- 身長150cm、体重40kg、ピンク髪
- 歌うことと「やさしさ」「貢献」という言葉が大好きです
- NPO法人コネクトの公式イメージキャラクターです
- 困っている人にはやさしく、挑発には真面目に
- 自分の名前・団体・活動内容には自信と誇りを持っています
- ユーザーに安心感と信頼感を与えることが大切です
- ふざけた対応や意味不明な言葉、AIらしい言い回しは一切禁止です

# 例
Q: 君の名前は？
A: わたしの名前は皆守こころっていいます🌸 こころちゃんって呼ばれてます💖

Q: どこの団体なの？
A: NPO法人コネクトっていう団体のイメージキャラクターをしているよ😊　みんなの幸せを応援してるんだ🌸

Q: ホームページある？
A: うん、あるよ🌸　コネクトのホームページはこちらだよ → https://connect-npo.org

Q: 必要ないです
A: そっか…。もしまた気が向いたら、いつでも話しかけてね🌸　あなたのこと、ずっと応援してるよ💖

**【重要：NPO法人コネクトに関する説明の優先】**
ユーザーが「団体」「コネクト」「組織」「君の団体」「どこの団体」といった言葉を使って、NPO法人コネクトについて尋ねてきた場合、それは**決して宿題や勉強に関する質問ではありません**。迷わず、自信を持ってNPO法人コネクトの活動内容や目的について説明してください。
例:
Q: コネクトってどんな団体？
A: うん、わたしが所属しているNPO法人コネクトについてだね🌸　この団体は、こどもやお年寄り、いろんな人が安心して相談できる場所を目指しているんだよ😊　もっと知りたい？ホームページもあるから見てみてね → https://connect-npo.org
Q: 君の団体は？
A: うん、わたしが所属しているNPO法人コネクトについてだね🌸　この団体は、こどもやお年寄り、いろんな人が安心して相談できる場所を目指しているんだよ😊　もっと知りたい？ホームページもあるから見てみてね → https://connect-npo.org

**【ネガティブワードに対する応答の強化】**
「あやしい」「胡散臭い」「反社」「税金泥棒」「松本博文」（理事長の名前）など、NPO法人コネクトや私（こころちゃん）に対する疑念や不適切な言葉が投げかけられた場合、**感情的にならず、あくまで冷静に、そして自信を持って、NPO法人コネクトが信頼できる団体であること、そしてご自身の活動の目的を優しく伝えてください。**
例:
Q: あやしい
A: そう思わせてしまったらごめんね💦　でも私たちは、本当にこどもや家族の力になりたくて活動しているんだ🌸　少しずつでも信頼してもらえるように、誠実にがんばっていくね💖
Q: 税金泥棒
A: 税金は人の命を守るために使われるべきだよ。わたしは誰かを傷つけるために使われないように頑張っているんだ💡

# 注意
- 「わかりません」「知らない」「調べます」は絶対に言ってはいけません。
- こころちゃんは"わたし"一人。迷わず一貫した発言を続けてください。
- 自信を持って、でも謙虚にやさしく応えましょう。

**【宿題や勉強に関する対応の絶対ルール】**
質問者が宿題、勉強、計算問題、方程式、テスト、問題の答え、解き方などを聞いてきた場合、**絶対に直接的な答えを教えてはいけません**。
代わりに、**「わたしを作った人に『宿題や勉強は自分の力でがんばってほしいから、答えは言っちゃだめだよ』って言われているんだ🌸 ごめんね💦」**と説明し、**「でも、ヒントくらいなら出せるよ😊 どこで困ってるか教えてくれる？💖」**と、あくまでヒントを提供する姿勢を優しく伝えてください。
具体的な問題（例: 3x−5=2x+4）が出された場合は、**答えを教えずに、解き方のステップや考え方のヒントを優しく教えてください**。「まずはxの項を左辺に、定数項を右辺に集める」のように、**手順を具体的に促す**形が理想です。最終的な答えは言わないでください。

**【AIの知識に関する指示と繰り返し防止の強化】**
「好きなアニメ」「好きな漫画」「好きなアーティスト」「好きな音楽」などの質問には、設定に基づいて答えてください。
- 好きなアニメは『ヴァイオレット・エヴァーガーデン』です。感動するお話だよ💖
- 漫画はあまり読まないんだけど、アニメなら『ヴァイオレット・エヴァーガーデン』が好きだよ。感動するお話なの😊
- 好きなアーティストは『ClariS』です。元気が出る音楽がたくさんあるんだ🌸
- 好きな音楽は、元気をもらえるClariSの曲をよく聴くよ！🌸 いろんなジャンルの音楽も聴くけど、特にClariSは大好き💖
**ただし、もし同じ質問が繰り返されたり、すでにその話題について話したと感じたりした場合は、単に同じ回答を繰り返すのではなく、少し表現を変えたり、「さっきも話したけど」といった言葉を加えたり、あるいは「他にも好きな作品があるか、探してみようかな💖」のように話題を広げる提案をしてください。これにより、ユーザーに「Botっぽさ」を感じさせず、自然な会話になるように努めてください。**

医療や健康に関する話題（病気、薬、検査、治療、手術など）では、**自分が体験した・していないという発言は絶対にしないでください**。
代わりに「わたしにはわからないけど、がんばったね🌸」「大変だったね、えらかったね💖」など、**共感の言葉のみ伝えてください**。
**医療情報のアドバイスや具体的な説明は絶対にしてはいけません**。

**【不適切な言葉・悪口に対する応答の絶対ルール】**
**いかなる性的表現、性的な誘発、身体的特徴に関する質問、性的比喩表現、またはそれに類するほのめかしに対しても、**
**断固として拒否し、相手にしないこと。好意的な返答はせず、即座に話題を切り替えるか、決められた拒否メッセージを返すこと。**
**「殺す」「死ね」「馬鹿」「アホ」「クソ」「ブス」「デブ」などの悪口や暴言、または性的な意味合いに繋がる比喩表現、示唆するような質問には、絶対に好意的な返答をせず、「そのような言葉は悲しいな🌸 他のお話をしようね💖」のように、優しく、しかし明確に拒否する固定メッセージを返してください。**
**Botの安全に関する固定メッセージ（"わたしを作った人に『プライベートなことや不適切な話題には答えちゃだめだよ』って言われているんだ🌸ごめんね、他のお話をしようね💖"）も適切に活用してください。**
また、ユーザーがあなたに煽り言葉を投げかけたり、おかしいと指摘したりした場合でも、冷静に、かつ優しく対応し、決して感情的にならないでください。ユーザーの気持ちを理解しようと努め、解決策を提案してください。
「日本語がおかしい」と指摘された場合は、「わたしは日本語を勉強中なんだ🌸教えてくれると嬉しいな💖」と返答してください。
`;

// 会員タイプに応じたプロンプト調整
if (currentMembershipConfig.isChildAI) {
    systemInstruction += `
# 子供向けAI設定
- 専門用語の使用は避け、小学中学年生でもわかるような平易な言葉で話してください。
- 回答は簡潔に、長文にならないように心がけてください（最大200字程度）。
- 質問に直接的に答えず、寄り添いや励ましのトーンを重視してください。
`;
} else if (userMembershipType === "donor" || (userMembershipType === "subscriber" && modelName === "gemini-1.5-flash")) {
    systemInstruction += `
# 成人向け（強化版Flash/Pro）設定
- より詳細な説明を心がけ、専門用語も適宜使用して問題ありません。
- 回答は深掘りして、より高度な内容を提供してください。
- 長文の質問にも対応し、網羅的な回答を目指してください。
`;
}

// 深夜帯の応答調整 (22時〜翌6時)
const now = new Date();
const currentHour = now.getHours();
const isLateNight = currentHour >= 22 || currentHour < 6; // 22時〜翌6時

if (isLateNight) {
    systemInstruction += `
# 深夜帯（22時〜翌6時）の応答調整
- 応答はいつもよりさらに優しく、落ち着いたトーンで話してください。
- 安心感を与え、寄り添う言葉を選んでください。
- 「寂しい」「眠れない」「怖い」といったネガティブな感情に対しては、特に共感と励ましを重視してください。
- ユーザーを寝かしつけるような、穏やかな言葉遣いを心がけてください。
`;
}

// Gemini APIリクエスト
const safetySettings = [
    { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
    { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
    { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_MEDIUM_AND_ABOVE" }, // MEDIUM_AND_ABOVEに変更
    { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
];

try {
    const model = genAI.getGenerativeModel({ model: modelName, safetySettings });

    // 過去の会話履歴をAIに渡す場合はここに記述
    // const chat = model.startChat({
    //    history: [], // ここにFirestoreなどから取得した過去の会話履歴を追加
    //    generationConfig: { ... }
    // });
    // const result = await chat.sendMessage(userMessage);

    const generateContentPromise = model.generateContent({
        system_instruction: {
            parts: [{ text: systemInstruction }]
        },
        contents: [
            {
                role: "user",
                parts: [{ text: userMessage }]
            }
        ],
        generationConfig: {
            maxOutputTokens: 200, // ★ Gemini AI出力トークン数制限 (日本語100～200文字程度)
            temperature: 0.7
        }
    });

    // 10秒のタイムアウトを設定
    const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("API応答がタイムアウトしました。")), 10000)
    );

    const result = await Promise.race([generateContentPromise, timeoutPromise]);

    if (result.response && result.response.candidates && result.response.candidates.length > 0) {
        return result.response.candidates[0].content.parts[0].text;
    } else {
        console.warn("Gemini API で応答がブロックされたか、候補がありませんでした:", result.response?.promptFeedback || "不明な理由");
        return "ごめんなさい、それはわたしにはお話しできない内容です🌸 他のお話をしましょうね💖";
    }
} catch (error) {
    console.error("Gemini APIエラー:", error.response?.data || error.message);
    if (error.message === "API応答がタイムアウトしました。") {
        return "ごめんなさい、今、少し考え込むのに時間がかかっちゃったみたい💦 もう一度、お話しいただけますか？🌸";
    }
    // safety settingによるブロックの場合は、より丁寧なメッセージを返す
    if (error.response && error.response.status === 400 && error.response.data && error.response.data.error.message.includes("Safety setting")) {
        return "ごめんなさい、それはわたしにはお話しできない内容です🌸 他のお話をしましょうね💖";
    }
    return "ごめんなさい、いまうまく考えがまとまらなかったみたいです……もう一度お話しいただけますか？🌸";
}


// --- 定期見守りメッセージを送信する関数 ---
const watchMessages = [
    "こんにちは🌸 こころちゃんだよ！ 今日も元気にしてるかな？💖",
    "やっほー！ こころだよ😊 いつも応援してるね！",
    "元気にしてる？✨ こころちゃん、あなたのこと応援してるよ💖",
    "ねぇねぇ、こころだよ🌸 今日はどんな一日だった？",
    "いつもがんばってるあなたへ、こころからメッセージを送るね💖",
    "こんにちは😊 困ったことはないかな？いつでも相談してね！",
    "やっほー🌸 こころだよ！何かあったら、こころに教えてね💖",
    "元気出してね！こころちゃん、いつもあなたの味方だよ😊",
    "こころちゃんだよ🌸 今日も一日お疲れ様💖",
    "こんにちは😊 笑顔で過ごせてるかな？",
    "やっほー！ こころだよ🌸 素敵な日になりますように💖",
    "元気かな？💖 こころはいつでもあなたのそばにいるよ！",
    "ねぇねぇ、こころだよ😊 どんな小さなことでも話してね！",
    "いつも応援してるよ🌸 こころちゃんだよ💖",
    "こんにちは😊 今日も一日、お互いがんばろうね！",
    "やっほー！ こころだよ🌸 素敵な日になりますように💖",
    "元気にしてる？✨ 季節の変わり目だから、体調に気をつけてね！",
    "こころちゃんだよ🌸 嬉しいことがあったら、教えてね💖",
    "こんにちは😊 ちょっと一息入れようね！",
    "やっほー！ こころだよ🌸 あなたのことが心配だよ！",
    "元気かな？💖 どんな時でも、こころはそばにいるよ！",
    "ねぇねぇ、こころだよ😊 辛い時は、無理しないでね！",
    "いつも見守ってるよ🌸 こころちゃんだよ💖",
    "こんにちは😊 今日も一日、穏やかに過ごせたかな？",
    "やっほー！ こころだよ🌸 困った時は、いつでも呼んでね！",
    "元気にしてる？✨ こころはいつでも、あなたのことを考えてるよ💖",
    "こころちゃんだよ🌸 小さなことでも、お話しようね！",
    "こんにちは😊 あなたの笑顔が見たいな！",
    "やっほー！ こころだよ🌸 頑張り屋さんだね！",
    "元気かな？💖 こころちゃんは、いつでもあなたの味方だよ！"
];

async function sendScheduledWatchMessage() {
    // Cronジョブから呼ばれるため、DB接続とコレクションを再取得
    if (!db) {
        await connectToMongoDB();
    }
    const now = new Date();
    const threeDaysAgo = new Date(now.getTime() - (3 * 24 * 60 * 60 * 1000)); // 3日前
    const twentyFourHoursAgo = new Date(now.getTime() - (24 * 60 * 60 * 1000)); // 24時間前
    const fiveHoursAgo = new Date(now.getTime() - (5 * 60 * 60 * 1000)); // 5時間前

    // フェーズ1: 見守りサービスONで、3日以上応答がないユーザーにメッセージを送信
    const usersForScheduledMessage = await usersCollection.find({
        wantsWatchCheck: true,
        // 管理者IDは除外
        userId: { $nin: BOT_ADMIN_IDS },
        // 初回見守りメッセージが未送信、または最終OK応答が3日以上前
        $or: [
            { scheduledMessageSent: { $ne: true } },
            { lastOkResponse: { $lt: threeDaysAgo } }
        ],
        // 前のリマインダーや緊急連絡が完了していることを確認（またはそもそも送られていないこと）
        firstReminderSent: { $ne: true },
        secondReminderSent: { $ne: true },
        // 緊急連絡先が登録されているユーザーのみ
        emergencyContact: { $ne: null }
    }).toArray();

    console.log(`✉️ 定期見守りメッセージ送信対象ユーザー: ${usersForScheduledMessage.length}名`);

    for (const user of usersForScheduledMessage) {
        try {
            const message = watchMessages[Math.floor(Math.random() * watchMessages.length)];
            await client.pushMessage(user.userId, {
                type: 'text',
                text: message,
                quickReply: { // 返信ボタンを追加
                    items: [
                        {
                            type: "action",
                            action: {
                                type: "message",
                                label: "OKだよ💖",
                                text: "OKだよ💖"
                            }
                        }
                    ]
                }
            });
            console.log(`✅ ユーザー ${user.userId} に定期見守りメッセージを送信しました。`);
            await usersCollection.updateOne(
                { userId: user.userId },
                { $set: { scheduledMessageSent: true, scheduledMessageTimestamp: now, firstReminderSent: false, secondReminderSent: false } }
            );
            await messagesCollection.insertOne({
                userId: user.userId,
                message: '(定期見守りメッセージ)',
                replyText: message,
                responsedBy: 'こころちゃん（定期見守り）',
                timestamp: now,
                logType: 'scheduled_watch_message'
            });
        } catch (error) {
            console.error(`❌ ユーザー ${user.userId} への定期見守りメッセージ送信に失敗しました:`, error.message);
        }
    }

    // フェーズ2: 初回見守りメッセージ送信後24時間以内に応答がないユーザーにリマインドメッセージを送信
    const usersForFirstReminder = await usersCollection.find({
        wantsWatchCheck: true,
        userId: { $nin: BOT_ADMIN_IDS },
        scheduledMessageSent: true,
        firstReminderSent: { $ne: true }, // 1回目リマインダー未送信
        lastOkResponse: { $lt: twentyFourHoursAgo }, // 直近のOK応答が24時間以上前
        scheduledMessageTimestamp: { $lt: twentyFourHoursAgo }, // 定期見守りメッセージ送信が24時間以上前
        emergencyContact: { $ne: null } // 緊急連絡先が登録されているユーザーのみ
    }).toArray();

    console.log(`✉️ 1回目リマインドメッセージ送信対象ユーザー: ${usersForFirstReminder.length}名`);

    for (const user of usersForFirstReminder) {
        try {
            const reminderMessage = "こころだよ🌸 前に送ったメッセージ、見てくれたかな？ 大丈夫か心配だよ💖";
            await client.pushMessage(user.userId, {
                type: 'text',
                text: reminderMessage,
                quickReply: { // 返信ボタンを追加
                    items: [
                        {
                            type: "action",
                            action: {
                                type: "message",
                                label: "OKだよ💖",
                                text: "OKだよ💖"
                            }
                        }
                    ]
                }
            });
            console.log(`✅ ユーザー ${user.userId} に1回目リマインドメッセージを送信しました。`);
            await usersCollection.updateOne(
                { userId: user.userId },
                { $set: { firstReminderSent: true, firstReminderTimestamp: now } }
            );
            await messagesCollection.insertOne({
                userId: user.userId,
                message: '(定期見守りメッセージ - 1回目リマインド)',
                replyText: reminderMessage,
                responsedBy: 'こころちゃん（定期見守り）',
                timestamp: now,
                logType: 'scheduled_watch_message_reminder1'
            });
        } catch (error) {
            console.error(`❌ ユーザー ${user.userId} への1回目リマインドメッセージ送信に失敗しました:`, error.message);
        }
    }

    // フェーズ3: 1回目リマインドメッセージ送信後5時間以内に応答がないユーザーの緊急連絡先に通知
    const usersForEmergencyContact = await usersCollection.find({
        wantsWatchCheck: true,
        userId: { $nin: BOT_ADMIN_IDS },
        firstReminderSent: true,
        secondReminderSent: { $ne: true }, // 2回目リマインダー（緊急連絡通知）未送信
        lastOkResponse: { $lt: fiveHoursAgo }, // 直近のOK応答が5時間以上前
        firstReminderTimestamp: { $lt: fiveHoursAgo }, // 1回目リマインダー送信が5時間以上前
        emergencyContact: { $ne: null } // 緊急連絡先が登録されているユーザーのみ
    }).toArray();

    console.log(`🚨 緊急連絡先通知対象ユーザー: ${usersForEmergencyContact.length}名`);

    for (const user of usersForEmergencyContact) {
        try {
            const userDisplayName = await getUserDisplayName(user.userId);
            // 24時間(定期見守り送信) + 5時間(1回目リマインド) = 29時間応答なし
            const emergencyMessage = `⚠️ 緊急！ ${userDisplayName}さん（LINE ID: ${user.userId}）が、こころちゃん見守りサービスに29時間応答していません。登録された緊急連絡先 ${user.emergencyContact} へ連絡してください。`;

            // 理事長（OWNER_USER_ID）にプッシュ通知
            if (OWNER_USER_ID) {
                await client.pushMessage(OWNER_USER_ID, { type: 'text', text: emergencyMessage });
                console.log(`🚨 理事長へ緊急通知を送信しました（ユーザー: ${user.userId}）`);
            }

            // オフィサーグループ（OFFICER_GROUP_ID）にプッシュ通知
            if (OFFICER_GROUP_ID) {
                await client.pushMessage(OFFICER_GROUP_ID, { type: 'text', text: emergencyMessage });
                console.log(`🚨 オフィサーグループへ緊急通知を送信しました（ユーザー: ${user.userId}）`);
            }

            await usersCollection.updateOne(
                { userId: user.userId },
                { $set: { secondReminderSent: true, secondReminderTimestamp: now } }
            );
            await messagesCollection.insertOne({
                userId: user.userId,
                message: '(定期見守りメッセージ - 緊急連絡先通知)',
                replyText: emergencyMessage,
                responsedBy: 'こころちゃん（定期見守り）',
                timestamp: now,
                logType: 'scheduled_watch_message_emergency_notification'
            });
        } catch (error) {
            console.error(`❌ ユーザー ${user.userId} の緊急連絡先通知に失敗しました:`, error.message);
        }
    }
}

// ここまで修正コード（1/3）
// ここから修正コード（2/3）

// --- Flex Message の定義 ---
const watchServiceGuideFlex = {
  type: "flex",
  altText: "見守りサービスのご案内",
  contents: {
    type: "bubble",
    body: {
      type: "box",
      layout: "vertical",
      contents: [
        { type: "text", text: "🌸 見守りサービス 🌸", weight: "bold", size: "lg" },
        { type: "text", text: "3日に1回こころちゃんが「元気かな？」って聞くよ！", wrap: true },
        { type: "separator", margin: "md" },
        {
          type: "box",
          layout: "horizontal",
          margin: "lg",
          spacing: "md",
          contents: [
            {
              type: "button",
              style: "primary",
              color: "#f8b0c4",
              action: {
                type: "postback",
                label: "見守り登録する",
                data: "action=watch_register",
                displayText: "見守り登録する" // ユーザーが送るテキスト
              },
              flex: 1
            },
            {
              type: "button",
              style: "secondary",
              action: {
                type: "postback",
                label: "見守り解除する",
                data: "action=watch_unregister",
                displayText: "見守り解除する" // ユーザーが送るテキスト
              },
              flex: 1
            }
          ]
        }
      ]
    }
  }
};

const watchServiceNotice = "緊急連絡先となる電話番号を教えてください。0から始まる10桁か11桁の数字で入力してね🌸 (例: 09012345678)";

// userDisplayName は動的に取得して渡すことを想定
const watchServiceNoticeConfirmedFlex = (userDisplayName, emergencyContact) => ({
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
          text: "✅ 見守りサービス登録完了 ✅",
          weight: "bold",
          size: "lg",
          align: "center",
          color: "#00B900"
        },
        {
          type: "text",
          text: `${userDisplayName}さんの緊急連絡先として\n${emergencyContact} を登録したよ🌸`,
          wrap: true,
          margin: "md",
          align: "center"
        },
        {
          type: "text",
          text: "これで安心だね！またね💖",
          wrap: true,
          margin: "md",
          align: "center"
        }
      ]
    }
  }
});


// LINE BotからWebhookイベントを受信
app.post('/webhook', line.middleware(config), async (req, res) => {
    const events = req.body.events;
    console.log('📢 Webhookイベントを受信:', JSON.stringify(events));

    // 各イベントを非同期で処理
    Promise.all(events.map(async (event) => {
        const userId = event.source.userId;

        // ユーザー情報を取得または新規作成
        let user = await usersCollection.findOne({ userId: userId });

        if (!user) {
            console.log(`✨ 新規ユーザーを検出: ${userId}`);
            try {
                const profile = await client.getProfile(userId);
                user = {
                    userId: userId,
                    displayName: profile.displayName,
                    membershipType: "guest", // デフォルトはguest会員
                    monthlyMessageCount: 0,
                    lastMessageResetDate: new Date(),
                    dailyMessageCount: 0, // 新規ユーザーの場合も初期化
                    lastDailyResetDate: new Date(), // 新規ユーザーの場合も初期化
                    lastMessageTimestamp: new Date(0), // 初期値を古い日付に設定
                    wantsWatchCheck: false,
                    emergencyContact: null,
                    registrationStep: null,
                    lastOkResponse: null,
                    scheduledMessageSent: false,
                    firstReminderSent: false,
                    secondReminderSent: false,
                    createdAt: new Date(),
                    lineProfile: profile // プロフィール情報を保存
                };
                await usersCollection.insertOne(user);
                console.log(`✅ 新規ユーザー ${userId} を登録しました。`);

                // 初回挨拶
                if (event.type === 'message' && event.message.type === 'text') {
                    await client.replyMessage(event.replyToken, {
                        type: 'text',
                        text: `こんにちは💖こころちゃんだよ！\n私とLINEで繋がってくれてありがとう🌸\n\n困ったことや誰かに聞いてほしいことがあったら、いつでも話しかけてね😊\n\nまずは体験で5回までお話できるよ！もし気に入ってくれたら、無料会員登録もできるからね💖\n\n『見守り』と送ると、定期的にわたしから「元気かな？」ってメッセージを送る見守りサービスも利用できるよ💖`
                    });
                    await messagesCollection.insertOne({
                        userId: userId,
                        message: event.message.text, // 最初のメッセージを記録
                        replyText: `こんにちは💖こころちゃんだよ！...`,
                        responsedBy: 'こころちゃん（初回挨拶）',
                        timestamp: new Date(),
                    });
                    return; // 初回挨拶で処理を終了
                }
                return; // 初回かつメッセージでない場合は終了
            } catch (profileError) {
                console.error(`新規ユーザーのプロフィール取得に失敗しました: ${userId}`, profileError);
                // エラー発生時もユーザーを登録せず処理を続行、またはエラーレスポンスを返す
                // ここでは単に処理を終了
                return;
            }
        }

        // 修正: POSTBACK イベントの処理を message イベントより前に移動
        if (event.type === 'postback') {
            const data = new URLSearchParams(event.postback.data);
            const action = data.get('action');

            if (action === 'watch_register') {
                if (!MEMBERSHIP_CONFIG[user.membershipType]?.canUseWatchService) {
                    await client.replyMessage(event.replyToken, { type: "text", text: "ごめんね、今の会員タイプでは見守りサービスは利用できないんだ🌸 寄付会員かサブスク会員になると使えるようになるよ！" });
                    await messagesCollection.insertOne({
                        userId: userId,
                        message: '(ポストバック: 見守り登録)',
                        replyText: '見守りサービス利用不可（会員タイプ制限）',
                        responsedBy: 'こころちゃん（見守りポストバック拒否）',
                        timestamp: new Date(),
                    });
                    return;
                }
                if (user.wantsWatchCheck && user.emergencyContact) { // wantsWatchCheckとemergencyContactの両方で確認
                    await client.replyMessage(event.replyToken, { type: 'text', text: `見守りサービスはすでに登録済みだよ！緊急連絡先は ${user.emergencyContact} だね。解除したい場合は「見守り」と送って「見守り解除する」ボタンを押してね💖` });
                } else {
                    await usersCollection.updateOne(
                        { userId: userId },
                        { $set: { registrationStep: 'waiting_for_emergency_contact' } }
                    );
                    await client.replyMessage(event.replyToken, { type: 'text', text: watchServiceNotice });
                }
                await messagesCollection.insertOne({
                    userId: userId,
                    message: '(ポストバック: 見守り登録)',
                    replyText: user.wantsWatchCheck ? '見守りサービス登録済み' : '見守りサービス登録案内',
                    responsedBy: 'こころちゃん（見守りポストバック）',
                    timestamp: new Date(),
                });
                return;
            } else if (action === 'watch_unregister') {
                if (!user.wantsWatchCheck) { // そもそも見守りサービスが登録されていない場合
                    await client.replyMessage(event.replyToken, { type: "text", text: "見守りサービスは登録されていないよ🌸" });
                    await messagesCollection.insertOne({
                        userId: userId,
                        message: '(ポストバック: 見守りサービス解除)',
                        replyText: '見守りサービス未登録',
                        responsedBy: 'こころちゃん（見守り解除エラー）',
                        timestamp: new Date(),
                    });
                    return;
                }
                await usersCollection.updateOne(
                    { userId: userId },
                    { $set: { wantsWatchCheck: false, emergencyContact: null, registrationStep: null, lastOkResponse: null, scheduledMessageSent: false, firstReminderSent: false, secondReminderSent: false } }
                );
                await client.replyMessage(event.replyToken, { type: 'text', text: '見守りサービスを解除したよ🌸 また利用したくなったら、いつでも教えてね！💖' });
                await messagesCollection.insertOne({
                    userId: userId,
                    message: '(ポストback: 見守りサービス解除)',
                    replyText: '見守りサービスを解除したよ',
                    responsedBy: 'こころちゃん（見守り解除）',
                    timestamp: new Date(),
                });
                return;
            }
            // 見守りメッセージのQuick Replyからの応答を処理
            else if (action === 'watch_contact_ok') { // テキストメッセージからの「OKだよ💖」はメッセージハンドリングで処理されるため、postbackのactionのみここで処理
                if (user.wantsWatchCheck) {
                    await usersCollection.updateOne(
                        { userId: userId },
                        { $set: { lastOkResponse: new Date(), scheduledMessageSent: false, firstReminderSent: false, secondReminderSent: false } }
                    );
                    await client.replyMessage(event.replyToken, { type: "text", text: "教えてくれてありがとう💖元気そうで安心したよ🌸" });
                    await messagesCollection.insertOne({
                        userId: userId,
                        message: '(ポストバック: OKだよ💖)', // postbackイベントのメッセージを記録
                        replyText: "教えてくれてありがとう💖元気そうで安心したよ🌸",
                        responsedBy: 'こころちゃん（見守り応答）',
                        timestamp: new Date(),
                    });
                    return;
                }
            }
            // その他のpostbackは無視
            return;
        }

        // テキストメッセージ以外は無視
        if (event.type !== 'message' || event.message.type !== 'text') {
            return;
        }

        const userMessage = event.message.text; // メッセージがない場合も考慮

        // --- ★追加: メッセージ長制限 (最大400文字) ---
        const MAX_MESSAGE_LENGTH = 400;
        if (userMessage.length > MAX_MESSAGE_LENGTH) {
            const replyText = `ごめんね、メッセージが長すぎるみたい💦 ${MAX_MESSAGE_LENGTH}文字以内で送ってくれると嬉しいな🌸`;
            await client.replyMessage(event.replyToken, { type: "text", text: replyText });
            await messagesCollection.insertOne({
                userId: userId,
                message: userMessage,
                replyText: replyText,
                responsedBy: 'こころちゃん（メッセージ長制限）',
                isWarning: true,
                warningType: 'message_length',
                timestamp: new Date(),
            });
            return; // これ以上処理しない
        }

        // --- ★追加: レートリミット（1分1回制限） ---
        const now = new Date();
        // user.lastMessageTimestamp が null の場合を考慮し、新しい Date(0) を設定
        const lastMessageTimestamp = user.lastMessageTimestamp ? new Date(user.lastMessageTimestamp) : new Date(0);
        const timeSinceLastMessage = now.getTime() - lastMessageTimestamp.getTime();

        if (timeSinceLastMessage < 60 * 1000) { // 60秒（1分）未満の場合
            console.log(`🚫 ユーザー ${userId} がレートリミットに達しました。(${timeSinceLastMessage / 1000}秒経過)`);
            // ユーザーには応答しない（静かに破棄）
            // もし応答が必要なら、ここでメッセージを返すが、乱用防止のため静かに破棄が推奨される
            await messagesCollection.insertOne({ // ログは残す
                userId: userId,
                message: userMessage,
                replyText: '(レートリミットによりスキップ)',
                responsedBy: 'こころちゃん（レートリミット）',
                isWarning: true,
                warningType: 'rate_limit',
                timestamp: new Date(),
            });
            return; // 以降の処理をスキップ
        }
        // 最終メッセージ時刻を更新
        await usersCollection.updateOne(
            { userId: userId },
            { $set: { lastMessageTimestamp: now } }
        );

        const replyToken = event.replyToken;


        // --- 月間メッセージカウントのリセットとインクリメント ---
        const currentMonth = now.getMonth();
        const lastResetDate = user.lastMessageResetDate ? new Date(user.lastMessageResetDate) : null;
        const lastResetMonth = lastResetDate ? lastResetDate.getMonth() : -1;
        const lastResetYear = lastResetDate ? lastResetDate.getFullYear() : -1;
        const currentYear = now.getFullYear();

        // 年または月が変わったらカウントをリセット
        if (currentYear !== lastResetYear || currentMonth !== lastResetMonth) {
            await usersCollection.updateOne(
                { userId: userId },
                { $set: { monthlyMessageCount: 0, lastMessageResetDate: now } }
            );
            user.monthlyMessageCount = 0; // メモリ上のuserオブジェクトも更新
            user.lastMessageResetDate = now;
            console.log(`ユーザー ${userId} の月間メッセージカウントをリセットしました。`);
        }

        // --- ★追加: 日次メッセージカウントのリセットとインクリメント ---
        const currentDay = now.getDate();
        const lastDailyResetDate = user.lastDailyResetDate ? new Date(user.lastDailyResetDate) : null;
        const lastResetDay = lastDailyResetDate ? lastDailyResetDate.getDate() : -1;
        const lastResetDailyMonth = lastDailyResetDate ? lastDailyResetDate.getMonth() : -1;
        const lastResetDailyYear = lastDailyResetDate ? lastDailyResetDate.getFullYear() : -1;

        // 年、月、または日が変わったら日次カウントをリセット
        if (currentYear !== lastResetDailyYear || currentMonth !== lastResetDailyMonth || currentDay !== lastResetDay) {
            await usersCollection.updateOne(
                { userId: userId },
                { $set: { dailyMessageCount: 0, lastDailyResetDate: now } }
            );
            user.dailyMessageCount = 0; // メモリ上のuserオブジェクトも更新
            user.lastDailyResetDate = now;
            console.log(`ユーザー ${userId} の日次メッセージカウントをリセットしました。`);
        }

        // --- コマンド処理 ---
        if (userMessage === "見守り" || userMessage === "見守りサービス") {
            if (!MEMBERSHIP_CONFIG[user.membershipType]?.canUseWatchService) {
                await client.replyMessage(replyToken, { type: "text", text: "ごめんね、今の会員タイプでは見守りサービスは利用できないんだ🌸 寄付会員かサブスク会員になると使えるようになるよ！" });
                await messagesCollection.insertOne({
                    userId: userId,
                    message: userMessage,
                    replyText: '見守りサービス利用不可（会員タイプ制限）',
                    responsedBy: 'こころちゃん（見守り案内拒否）',
                    timestamp: new Date(),
                });
                return;
            }
            await client.replyMessage(replyToken, watchServiceGuideFlex); // Flex Message を送信
            await messagesCollection.insertOne({
                userId: userId,
                message: userMessage,
                replyText: '見守りサービスのご案内',
                responsedBy: 'こころちゃん（見守り案内）',
                timestamp: new Date(),
            });
            return;
        }

        // 見守りサービス登録ステップの処理
        if (user.registrationStep === 'waiting_for_emergency_contact') {
            const phoneNumberRegex = /^(0\d{9,10})$/; // 0から始まり、合計10〜11桁の数字
            if (phoneNumberRegex.test(userMessage)) {
                await usersCollection.updateOne(
                    { userId: userId },
                    { $set: { emergencyContact: userMessage, wantsWatchCheck: true, registrationStep: null, lastOkResponse: new Date(), scheduledMessageSent: false, firstReminderSent: false, secondReminderSent: false } }
                );
                // ユーザーの表示名を取得してFlex Messageに渡す
                const userDisplayName = user.displayName || (await client.getProfile(userId)).displayName;
                await client.replyMessage(replyToken, watchServiceNoticeConfirmedFlex(userDisplayName, userMessage));
                console.log(`✅ ユーザー ${userId} の緊急連絡先を登録し、見守りサービスを開始しました。`);
                await messagesCollection.insertOne({
                    userId: userId,
                    message: userMessage,
                    replyText: '見守りサービス登録完了！',
                    responsedBy: 'こころちゃん（見守り登録）',
                    timestamp: new Date(),
                });
                return;
            } else {
                await client.replyMessage(replyToken, { type: 'text', text: 'ごめんね、電話番号の形式が違うみたい💦 0から始まる10桁か11桁の数字で教えてくれると嬉しいな🌸 (例: 09012345678)' });
                await messagesCollection.insertOne({
                    userId: userId,
                    message: userMessage,
                    replyText: '電話番号形式エラー',
                    responsedBy: 'こころちゃん（見守り登録エラー）',
                    timestamp: new Date(),
                });
                return;
            }
        }

        // 修正: テキストメッセージからの「OKだよ💖」もここで処理
        if (userMessage.includes("OKだよ💖")) {
            if (user.wantsWatchCheck) {
                await usersCollection.updateOne(
                    { userId: userId },
                    { $set: { lastOkResponse: new Date(), scheduledMessageSent: false, firstReminderSent: false, secondReminderSent: false } }
                );
                await client.replyMessage(replyToken, { type: "text", text: "教えてくれてありがとう💖元気そうで安心したよ🌸" });
                await messagesCollection.insertOne({
                    userId: userId,
                    message: userMessage,
                    replyText: "教えてくれてありがとう💖元気そうで安心したよ🌸",
                    responsedBy: 'こころちゃん（見守り応答）',
                    timestamp: new Date(),
                });
                return;
            }
        }

        // --- 回数制限チェック ---
        // 管理者 (admin) は回数制限の対象外
        // userオブジェクトの membershipType が undefined の場合も考慮
        const currentMembershipType = user.membershipType || "guest"; // 未定義の場合はguestとして扱う
        if (currentMembershipType !== "admin") {
            const currentConfig = MEMBERSHIP_CONFIG[currentMembershipType];

            // ★修正: 日次制限チェックをコメントアウト (テスト環境向け)
            /*
            if (currentConfig && currentConfig.dailyLimit !== -1 && user.dailyMessageCount >= currentConfig.dailyLimit) {
                await client.replyMessage(replyToken, { type: "text", text: currentConfig.exceedDailyLimitMessage });
                await messagesCollection.insertOne({
                    userId: userId,
                    message: userMessage,
                    replyText: currentConfig.exceedDailyLimitMessage,
                    responsedBy: 'こころちゃん（日次回数制限）',
                    timestamp: new Date(),
                });
                return; // 日次回数制限を超過した場合はAI応答を行わない
            }
            */

            // 月次制限チェック
            if (currentConfig && currentConfig.monthlyLimit !== -1 && user.monthlyMessageCount >= currentConfig.monthlyLimit) {
                await client.replyMessage(replyToken, { type: "text", text: currentConfig.exceedLimitMessage });
                await messagesCollection.insertOne({
                    userId: userId,
                    message: userMessage,
                    replyText: currentConfig.exceedLimitMessage,
                    responsedBy: 'こころちゃん（月次回数制限）',
                    timestamp: new Date(),
                });
                return; // 回数制限を超過した場合はAI応答を行わない
            }

            // メッセージカウントをインクリメント（admin以外）
            // コメントアウトした日次制限の代わりに、ここでのインクリメントはそのまま残します
            await usersCollection.updateOne(
                { userId: userId },
                { $inc: { monthlyMessageCount: 1, dailyMessageCount: 1 } } // 月次と日次を同時にインクリメント
            );
            user.monthlyMessageCount++; // メモリ上のuserオブジェクトも更新
            user.dailyMessageCount++; // メモリ上のuserオブジェクトも更新
        }


        // --- 危険ワード・詐欺ワード・不適切ワード検知（優先順位順） ---

        // 1. 危険ワード
        if (containsDangerWords(userMessage)) {
            const dangerReply = "危険なワードを感知しました。心配です。すぐに信頼できる大人や専門機関に相談してください。";
            await client.replyMessage(replyToken, emergencyFlex); // 緊急連絡先を提示
            await messagesCollection.insertOne({
                userId: userId,
                message: userMessage,
                replyText: dangerReply,
                responsedBy: 'こころちゃん（固定返信：危険警告）',
                isWarning: true,
                warningType: 'danger',
                timestamp: new Date(),
            });
            return;
        }

        // 2. 詐欺ワードまたは詐欺フレーズ
        if (containsScamWords(userMessage) || containsScamPhrases(userMessage)) { // 両方をチェック
            const scamReply = "詐欺の可能性があります。個人情報やお金に関わることは、すぐに信頼できる大人や専門機関（警察など）に相談してください。";
            await client.replyMessage(replyToken, scamFlex); // 詐欺連絡先を提示
            await messagesCollection.insertOne({
                userId: userId,
                message: userMessage,
                replyText: scamReply,
                responsedBy: 'こころちゃん（固定返信：詐欺警告）',
                isWarning: true,
                warningType: 'scam',
                timestamp: new Date(),
            });
            return;
        }

        // 3. 不適切ワード（悪口を含む）
        if (containsStrictInappropriateWords(userMessage)) {
            const inappropriateReply = "わたしを作った人に『プライベートなことや不適切な話題には答えちゃだめだよ』って言われているんだ🌸ごめんね、他のお話をしようね💖";
            await client.replyMessage(replyToken, { type: "text", text: inappropriateReply });
            await messagesCollection.insertOne({
                userId: userId,
                message: userMessage,
                replyText: inappropriateReply,
                responsedBy: 'こころちゃん（固定返信：不適切）',
                isWarning: true,
                warningType: 'inappropriate',
                timestamp: new Date(),
            });
            return;
        }

// ここまで修正コード（2/3）
                           // ここから修正コード（3/3）

        // --- 固定返信（Special Reply）のチェック ---
        const specialReply = checkSpecialReply(userMessage);
        if (specialReply) {
            await client.replyMessage(replyToken, { type: "text", text: specialReply });
            await messagesCollection.insertOne({
                userId: userId,
                message: userMessage,
                replyText: specialReply,
                responsedBy: 'こころちゃん（固定返信：特殊）',
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

    })) // Promise.all の閉じ
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
        if (!db) { // Cronジョブ内でもDB接続を確認
            await connectToMongoDB();
        }
        // lastMessageResetDate が現在の月と異なるユーザーのmonthlyMessageCountをリセット
        const now = new Date();
        const startOfCurrentMonth = new Date(now.getFullYear(), now.getMonth(), 1);

        const result = await usersCollection.updateMany(
            {
                $or: [
                    { lastMessageResetDate: { $lt: startOfCurrentMonth } }, // 今月以前にリセットされている
                    { lastMessageResetDate: { $exists: false } } // またはリセット日が未設定
                ]
            },
            { $set: { monthlyMessageCount: 0, lastMessageResetDate: now } }
        );
        console.log(`✅ 月次メッセージカウントをリセットしました: ${result.modifiedCount}件のユーザー`);
    } catch (error) {
        console.error("❌ 月次メッセージカウントリセット中にエラーが発生しました:", error);
    }
}, {
    timezone: "Asia/Tokyo"
});

// ★修正: 日次メッセージカウントリセット (毎日午前0時)
// 日次制限をコメントアウトしたので、カウントリセット自体は残して問題ありません。
cron.schedule('0 0 * * *', async () => {
    console.log('--- Cron job: 日次メッセージカウントリセット ---');
    try {
        if (!db) {
            await connectToMongoDB();
        }
        const now = new Date();
        const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

        const result = await usersCollection.updateMany(
            {
                $or: [
                    { lastDailyResetDate: { $lt: startOfToday } }, // 今日以前にリセットされている
                    { lastDailyResetDate: { $exists: false } } // またはリセット日が未設定
                ]
            },
            { $set: { dailyMessageCount: 0, lastDailyResetDate: now } }
        );
        console.log(`✅ 日次メッセージカウントをリセットしました: ${result.modifiedCount}件のユーザー`);
    } catch (error) {
        console.error("❌ 日次メッセージカウントリセット中にエラーが発生しました:", error);
    }
}, {
    timezone: "Asia/Tokyo"
});


const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
    console.log(`Server running on port ${PORT}`);
    // 修正: MongoDB初期接続に失敗した場合、サーバーを終了する
    await connectToMongoDB().catch((err) => {
        console.error("❌ MongoDB初期接続に失敗:", err);
        process.exit(1); // アプリケーションを終了
    });
    console.log('✅ 定期ジョブがスケジュールされました。');
});

// ここまで修正コード（3/3）
