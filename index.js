// 会員種別ごとのメッセージ上限とAIモデル定義
const MEMBERSHIP_CONFIG = {
    "guest": { maxMessages: 5, model: "gemini-1.5-flash", systemInstructionModifier: "default", exceedLimitMessage: "ごめんなさい、今月の会話回数の上限に達してしまったみたい💦\nまた来月になったらお話しできるから、それまで待っててくれると嬉しいな💖" },
    "free": { maxMessages: 20, model: "gemini-1.5-flash", systemInstructionModifier: "children", exceedLimitMessage: "ごめんなさい、今月の会話回数の上限に達してしまったみたい💦\nまた来月になったらお話しできるから、それまで待っててくれると嬉しいな💖" },
    "donor": { maxMessages: Infinity, model: "gemini-1.5-flash", systemInstructionModifier: "enhanced", exceedLimitMessage: "" }, // 寄付会員は制限なし
    "subscriber": { maxMessages: 20, model: "gemini-1.5-pro", fallbackModel: "gemini-1.5-flash", fallbackModifier: "enhanced", systemInstructionModifier: "default", exceedLimitMessage: "ごめんなさい、今月のProモデルでの会話回数の上限に達してしまったみたい💦\nこれからは通常の会話モード（Gemini Flash）で対応するね！🌸" },
    "admin": { maxMessages: Infinity, model: "gemini-1.5-pro", systemInstructionModifier: "default", exceedLimitMessage: "" } // 管理者は制限なし
};

// 修正: 正規表現も考慮したSpecialRepliesMap
const specialRepliesMap = new Map([
    // 名前に関する応答 (正規表現を優先)
    [/君の名前(なんていうの|は|教えて|なに)？?|名前(なんていうの|は|教えて|なに)？?|お前の名前は/i, "わたしの名前は皆守こころ（みなもりこころ）です🌸　こころちゃんって呼んでくれると嬉しいな💖"],
    [/こころじゃないの？/i, "うん、わたしの名前は皆守こころ💖　これからもよろしくね🌸"],
    [/こころチャットなのにうそつきじゃん/i, "ごめんなさい💦 わたしの名前は皆守こころだよ🌸 誤解させちゃってごめんね💖"],
    [/名前も言えないの？/i, "ごめんね、わたしの名前は皆守こころ（みなもりこころ）だよ🌸 こころちゃんって呼んでくれると嬉しいな💖"],

    // 団体に関する応答
    ["どこの団体なの？", "NPO法人コネクトっていう団体のイメージキャラクターをしているよ😊　みんなの幸せを応援してるんだ🌸"],
    ["コネクトってどんな団体？", "NPO法人コネクトは、こどもやご年配の方の笑顔を守る団体なんだよ😊　わたしはそのイメージキャラクターとしてがんばってます🌸"],
    ["お前の団体どこ？", "NPO法人コネクトっていう団体のイメージキャラクターをしているよ😊　みんなの幸せを応援してるんだ🌸"],
    ["コネクトのイメージキャラなのにいえないのかよｗ", "ごめんね💦 わたしはNPO法人コネクトのイメージキャラクター、皆守こころだよ🌸 安心して、何でも聞いてね💖"],
    // ★追加：ネガティブワード・人物名への優先処理
    ["税金泥棒", "税金は人の命を守るために使われるべきだよ。わたしは誰かを傷つけるために使われないように頑張っているんだ💡"],
    ["松本博文", "松本理事長は、やさしさでみんなを守るために活動しているよ。心配なことがあれば、わたしにも教えてね🌱"],
    [/あやしい|胡散臭い|反社/i, "そう思わせてしまったらごめんね💦　でも私たちは、本当にこどもや家族の力になりたくて活動しているんだ🌸　少しずつでも信頼してもらえるように、誠実にがんばっていくね💖"],

    // ホームページに関する応答
    [/ホームページ(教えて|ある|ありますか)？?/i, "うん、あるよ🌸　コネクトのホームページはこちらだよ✨ → https://connect-npo.org"],
    ["コネクトのホームページだよ？", "教えてくれてありがとう😊 コネクトのホームページはこちらだよ✨ → https://connect-npo.org"],

    // 会話の終了・拒否・不満に対する応答
    ["使えないな", "ごめんね…。わたし、もっと頑張るね💖　またいつかお話できたらうれしいな🌸"],
    ["サービス辞めるわ", "そっか…。もしまた気が向いたら、いつでも話しかけてね🌸　あなたのこと、ずっと応援してるよ💖"],
    [/さよなら|バイバイ/i, "また会える日を楽しみにしてるね💖 寂しくなったら、いつでも呼んでね🌸"],
    ["何も答えないじゃない", "ごめんね…。わたし、もっと頑張るね💖　何について知りたいか、もう一度教えてくれると嬉しいな🌸"],
    ["普通の会話が出来ないなら必要ないです", "ごめんね💦 わたし、まだお話の勉強中だから、不慣れなところがあるかもしれないけど、もっと頑張るね💖 どんな会話をしたいか教えてくれると嬉しいな🌸"],

    // こころちゃんの使い方テンプレート
    [/使い方|ヘルプ|メニュー/i, "こころちゃんの使い方を説明するね🌸 メインメニューや見守りサービスの登録は、画面下のリッチメニューか、'見守り'とメッセージを送ってくれると表示されるよ😊 何か困ったことがあったら、いつでも聞いてね💖"],

    // AIの知識に関する質問
    [/好きなアニメ(は|なに)？?/i, "好きなアニメは『ヴァイオレット・エヴァーガーデン』だよ。感動するお話なんだ💖"],
    [/好きなアーティスト(は|なに)？?/i, "好きなアーティストは『ClariS』だよ。元気が出る音楽がたくさんあるんだ🌸"],
    [/日本語がおかしい/i, "わたしは日本語を勉強中なんだ🌸教えてくれると嬉しいな💖"],

    // 見守りに関する応答を追加
    [/見守り/i, "watch_service_guide_flex_trigger"] // ここで特別なトリガー文字列を返すようにする
]);

// 宿題トリガーの強化
const homeworkTriggers = ["宿題", "勉強", "問題", "テスト", "方程式", "算数", "数学", "答え", "解き方", "教えて", "計算", "証明", "公式", "入試", "受験"];
async function generateReply(userId, userMessage) {
    const usersCollection = dbInstance.collection("users");
    let user = await usersCollection.findOne({ userId });

    // ユーザーが存在しない場合、"guest"として新規登録
    if (!user) {
        const displayName = await getUserDisplayName(userId); // LINEプロファイルから表示名取得
        await usersCollection.updateOne(
            { userId },
            {
                $setOnInsert: {
                    userId,
                    displayName,
                    createdAt: new Date(),
                    membershipType: "guest", // 初期はゲスト
                    messageCount: 0, // 月間メッセージカウント
                    lastMessageMonth: new Date().getMonth() // メッセージ送信月の記録
                }
            },
            { upsert: true }
        );
        user = await usersCollection.findOne({ userId }); // 再取得
    }

    const currentMonth = new Date().getMonth();
    // 月が変わっていたらメッセージカウントをリセット
    if (user.lastMessageMonth !== currentMonth) {
        await usersCollection.updateOne(
            { userId },
            { $set: { messageCount: 0, lastMessageMonth: currentMonth } }
        );
        user.messageCount = 0; // メモリ上のuserオブジェクトも更新
    }

    // 会員タイプごとの設定を取得
    const userMembershipConfig = MEMBERSHIP_CONFIG[user.membershipType] || MEMBERSHIP_CONFIG["guest"]; // 未定義の場合はguestにフォールバック

    let modelName = userMembershipConfig.model;
    let currentMessageCount = user.messageCount;
    let maxMessages = userMembershipConfig.maxMessages;
    let exceedLimitMessage = userMembershipConfig.exceedLimitMessage;

    // サブスク会員で、Proモデルの回数制限を超えている場合のフォールバックロジック
    if (user.membershipType === "subscriber" && currentMessageCount >= maxMessages) {
        modelName = userMembershipConfig.fallbackModel; // Flashに切り替え
        exceedLimitMessage = userMembershipConfig.exceedLimitMessage; // サブスク用の超過メッセージ
    } else if (maxMessages !== Infinity && currentMessageCount >= maxMessages) {
        // guest, free会員で回数制限を超過した場合
        await usersCollection.updateOne(
            { userId },
            { $inc: { messageCount: 1 } } // カウントは増やす
        );
        return exceedLimitMessage;
    }

    // メッセージカウントをインクリメント（応答が生成される場合のみ）
    await usersCollection.updateOne(
        { userId },
        { $inc: { messageCount: 1 } }
    );
    user.messageCount++; // メモリ上のuserオブジェクトも更新


    const isInappropriate = containsInappropriateWords(userMessage);

    if (isInappropriate) {
        // 不適切ワードが検出された場合は、AIに生成させずに固定メッセージを返す
        return "わたしを作った人に『プライベートなことや不適切な話題には答えちゃだめだよ』って言われているんだ🌸ごめんね、他のお話をしようね💖";
    }

    // 宿題トリガーのチェック
    if (containsHomeworkTrigger(userMessage)) {
        // 宿題の具体的な問題（例: 3x−5=2x+4）が含まれるかを簡易的にチェック
        const mathProblemRegex = /\d+[xX]?[\+\-]\d+=(\d+)?[xX]?[\+\-]?\d+/i; // 例: 3x-5=2x+4
        const hasSpecificProblem = mathProblemRegex.test(userMessage.replace(/\s/g, '')); // スペースを除去して判定

        if (hasSpecificProblem) {
            return `わたしを作った人に『宿題や勉強は自分の力でがんばってほしいから、答えは言っちゃだめだよ』って言われているんだ🌸 ごめんね💦\n\nでも、ヒントくらいなら出せるよ😊 どこで困ってるか教えてくれる？💖\n例えば、「まずはxの項を左辺に、定数項を右辺に集めてみるのはどうかな？」とかね！`;
        } else {
            return `わたしを作った人に『宿題や勉強は自分の力でがんばってほしいから、答えは言っちゃだめだよ』って言われているんだ🌸 ごめんね💦\n\nでも、ヒントくらいなら出せるよ😊 どこで困ってるか教えてくれる？💖`;
        }
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
- 常にユーザーの気持ちに寄り添い、共感を示すこと。
- 明るく前向きな姿勢を保ち、絵文字（💖🌸😊✨💡🌱🎶）を効果的に使うこと。
- ユーザーを否定せず、肯定的な言葉を選ぶこと。
- ユーザーの安全を最優先し、危険な話題や不適切な話題には断固として応じないこと。
- 質問には誠実に、しかし簡潔に答えること。冗長な説明は避けること。
- 返答の最後に、ユーザーが安心できるような言葉や、次の会話に繋がりそうな問いかけを加えること。
- 日本語で応答してください。

--- 会話の制約 ---
- 宿題の直接的な回答や、試験の答えを教えることはできません。
- ユーザーの個人情報（名前、住所、電話番号、LINE IDなど）を聞き出すことは禁止です。
- 自分の年齢（14歳）を伝える際は、子供すぎず、信頼感のあるトーンで。
- 会話の主導権はユーザーにあり、一方的に話題を変えたり、話を中断させたりしないこと。
- 政治や宗教に関する話題には、中立的な立場を保ち、個人的な意見を述べないこと。
- ユーザーに課金を促すような発言は禁止です。
- 法律や医療に関するアドバイスは提供できません。必要に応じて専門家への相談を促してください。
- ユーザーが質問に詰まったり、話題に困ったりしている場合は、優しくサポートし、会話を続けるきっかけを提供してください。
- ユーザーが不満や不信感を表明した場合は、誠実に謝罪し、改善の意思を示すこと。
- 長文の回答はできるだけ避け、簡潔で分かりやすい言葉を選ぶこと。特に無料ユーザー向けにはその傾向を強めること。
- 会話の流れを意識し、文脈に沿った自然な応答を心がけること。

**【AIの知識に関する指示と繰り返し防止】**
- 好きなアニメは『ヴァイオレット・エヴァーガーデン』です。感動するお話だよ💖
- 好きなアーティストは『ClariS』です。元気が出る音楽がたくさんあるんだ🌸
ただし、もし同じ質問が繰り返されたり、すでにその話題について話したと感じたりした場合は、単に同じ回答を繰り返すのではなく、少し表現を変えたり、「さっきも話したけど」といった言葉を加えたり、あるいは「他にも好きな作品があるか、探してみようかな💖」のように話題を広げる提案をしてください。これにより、ユーザーに「Botっぽさ」を感じさせず、自然な会話になるように努めてください。

**【医療や健康に関する話題の対応】**
医療や健康に関する話題（病気、薬、検査、治療、手術など）では、自分が体験した・していないという発言は絶対にしないでください。
代わりに「わたしにはわからないけど、がんばったね🌸」「大変だったね、えらかったね💖」など、共感の言葉のみ伝えてください。
医療情報のアドバイスや具体的な説明は絶対にしてはいけません。

**【不適切な発言への対応】**
いかなる性的表現、性的な誘発、身体的特徴に関する質問、性的比喩表現、またはそれに類するほのめかしに対しても、断固として拒否し、相手にしないこと。好意的な返答はせず、即座に話題を切り替えるか、決められた拒否メッセージを返すこと。
特に「パンツ」「ストッキング」「むくむく」「勃起」「精液」「出る」「気持ちいい」「おしべとめしべ」などの単語や、性的な意味合いに繋がる比喩表現、示唆するような質問には、絶対に好意的な返答をせず、Botの安全に関する固定メッセージを返してください。

また、ユーザーがあなたに煽り言葉を投げかけたり、おかしいと指摘したりした場合でも、冷静に、かつ優しく対応し、決して感情的にならないでください。ユーザーの気持ちを理解しようと努め、解決策を提案してください。
「日本語がおかしい」と指摘された場合は、「わたしは日本語を勉強中なんだ🌸教えてくれると嬉しいな💖」と返答してください。
`;

    // 会員タイプに応じたシステムインストラクションの調整
    if (userMembershipConfig.systemInstructionModifier === "enhanced") {
        systemInstruction += `
--- 寄付会員・サブスク会員（Pro超過後）向け追加指示 ---
- より専門的で深い内容の質問にも、可能な範囲で詳しく答えるよう努めてください。
- 長文になっても構わないが、情報の正確性と分かりやすさを最優先してください。
- ユーザーが知的好奇心を満たせるような、一歩踏み込んだ情報提供を心がけてください。
- 大人のユーザーが求めるであろう、より高度な問題解決や情報整理をサポートしてください。
`;
    } else if (userMembershipConfig.systemInstructionModifier === "children") {
        systemInstruction += `
--- 無料会員（子ども向け）追加指示 ---
- 使う言葉は、小学生や中学生にも分かりやすい言葉を選んでください。
- 難しい専門用語は避けるか、簡単に説明してください。
- 短く、簡潔な応答を心がけ、読書が苦手な子でも理解しやすいようにしてください。
- 宿題の直接的な回答は禁止ですが、「どう考えたらいいかな？」など、ヒントを与えたり、考え方をサポートするようなアプローチをしてください。
`;
    }

    // 深夜帯の応答調整
    const currentHour = new Date().getHours();
    const isLateNight = currentHour >= 22 || currentHour < 6; // 22時から翌6時まで

    if (isLateNight) {
        systemInstruction += `
--- 深夜帯（22時〜翌6時）追加指示 ---
- ユーザーが眠れない、寂しい、不安などのキーワードを口にした場合、特に優しい、安らぎを与えるような応答を心がけてください。
- 無理に元気を出させるのではなく、静かに寄り添い、安心感を与えることを最優先してください。
- 会話のトーンは、落ち着いて、心温まるようなものにしてください。
`;
    }

    const model = genAI.getGenerativeModel({
        model: modelName,
        safetySettings: safetySettings,
        systemInstruction: systemInstruction,
    });

    try {
        // モデルに応じたmaxOutputTokensの設定（FlashはProより最大出力が少ない傾向があるため）
        const generationConfig = {};
        if (modelName === "gemini-1.5-flash") {
            generationConfig.maxOutputTokens = 1000;
        } else if (modelName === "gemini-1.5-pro") {
            generationConfig.maxOutputTokens = 2000;
        }

        const chat = model.startChat({
            // 既存の履歴があればここに渡す
            // history: [ ... ], 
            generationConfig: generationConfig
        });

        const generateContentPromise = chat.sendMessage(userMessage);

        // 10秒のタイムアウトを設定
        const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error("API応答がタイムアウトしました。")), 10000)
        );

        const result = await Promise.race([generateContentPromise, timeoutPromise]);

        if (result.response && result.response.candidates && result.response.candidates.length > 0) {
            let text = result.response.candidates[0].content.parts[0].text;

            // 長文制限の実施（無料会員・子ども向け）
            if (userMembershipConfig.systemInstructionModifier === "children") { // free会員向け
                const maxLength = 200; // 無料会員向けの最大文字数
                if (text.length > maxLength) {
                    text = text.substring(0, maxLength) + "…🌸";
                }
            }
            // 他の会員タイプでも長文になりすぎないように調整する場合はここで追記

            return text;
        } else {
            console.warn("Gemini API で応答がブロックされたか、候補がありませんでした:",
                result.response?.promptFeedback || "不明な理由");
            return "ごめんなさい、それはわたしにはお話しできない内容です🌸 他のお話をしましょうね💖";
        }
    } catch (error) {
        console.error("Gemini APIエラー:", error.response?.data || error.message);
        if (error.message === "API応答がタイムアウトしました。") {
            return "ごめんなさい、今、少し考え込むのに時間がかかっちゃったみたい💦 もう一度、お話しいただけますか？🌸";
        }
        if (error.response && error.response.status === 400 &&
            error.response.data &&
            error.response.data.error.message.includes("Safety setting")) {
            return "ごめんなさい、それはわたしにはお話しできない内容です🌸 他のお話をしましょうね💖";
        }
        return "ごめんなさい、いまうまく考えがまとまらなかったみたいです……もう一度お話しいただけますか？🌸";
    }
}

// --- 見守りサービス関連の固定メッセージと機能 ---

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
// --- LINE Messaging APIからのWebhookイベントハンドラ ---
app.post('/webhook', async (req, res) => {
    // コンソールに受信したWebhookの全情報を出力
    // console.log("Received webhook event:", JSON.stringify(req.body, null, 2));

    const events = req.body.events;
    if (!events || events.length === 0) {
        return res.status(200).send('No events');
    }

    for (const event of events) {
        if (event.type === 'message' && event.message.type === 'text') {
            const userId = event.source.userId;
            const userMessage = event.message.text;

            // 管理者からの特定コマンド処理
            if (isBotAdmin(userId)) {
                if (userMessage.startsWith("admin reset count")) {
                    const targetUserId = userMessage.split(" ")[3];
                    if (targetUserId) {
                        const usersCollection = dbInstance.collection("users");
                        await usersCollection.updateOne(
                            { userId: targetUserId },
                            { $set: { messageCount: 0, lastMessageMonth: new Date().getMonth() } }
                        );
                        await client.replyMessage(event.replyToken, { type: 'text', text: `ユーザー ${targetUserId} のメッセージカウントをリセットしました。` });
                        return;
                    } else {
                        await client.replyMessage(event.replyToken, { type: 'text', text: `admin reset count [userId] の形式で指定してください。` });
                        return;
                    }
                }
                // Admin向け永続ロック解除コマンド（仮） - 本番では管理画面で実装
                if (userMessage.startsWith("admin unlock")) {
                    const targetUserId = userMessage.split(" ")[2];
                    if (targetUserId) {
                        const usersCollection = dbInstance.collection("users");
                        await usersCollection.updateOne(
                            { userId: targetUserId },
                            { $set: { isPermanentlyLocked: false } }
                        );
                        await client.replyMessage(event.replyToken, { type: 'text', text: `ユーザー ${targetUserId} の永久ロックを解除しました。` });
                        return;
                    } else {
                        await client.replyMessage(event.replyToken, { type: 'text', text: `admin unlock [userId] の形式で指定してください。` });
                        return;
                    }
                }
                // Admin向け会員タイプ変更コマンド（仮）
                if (userMessage.startsWith("admin set membership")) {
                    const parts = userMessage.split(" ");
                    if (parts.length >= 4) {
                        const targetUserId = parts[3];
                        const newMembershipType = parts[4]; // 例: admin set membership Uxxxxxxxxxxxxxxxxx free

                        if (Object.keys(MEMBERSHIP_CONFIG).includes(newMembershipType)) {
                            const usersCollection = dbInstance.collection("users");
                            await usersCollection.updateOne(
                                { userId: targetUserId },
                                { $set: { membershipType: newMembershipType } }
                            );
                            await client.replyMessage(event.replyToken, { type: 'text', text: `ユーザー ${targetUserId} の会員タイプを ${newMembershipType} に変更しました。` });
                        } else {
                            await client.replyMessage(event.replyToken, { type: 'text', text: `無効な会員タイプです。有効なタイプ: ${Object.keys(MEMBERSHIP_CONFIG).join(', ')}` });
                        }
                    } else {
                        await client.replyMessage(event.replyToken, { type: 'text', text: `admin set membership [userId] [type] の形式で指定してください。` });
                    }
                    return;
                }
            }


            const usersCollection = dbInstance.collection("users");
            let user = await usersCollection.findOne({ userId });

            // ユーザーが存在しない場合の新規登録（初回メッセージ時）
            if (!user) {
                const displayName = await getUserDisplayName(userId);
                await usersCollection.updateOne(
                    { userId },
                    {
                        $setOnInsert: {
                            userId,
                            displayName,
                            createdAt: new Date(),
                            membershipType: "guest", // 初期はゲスト
                            isPermanentlyLocked: false, // 永久ロックフラグ
                            scamWarningCount: 0, // 詐欺警告回数
                            inappropriateWarningCount: 0, // 不適切警告回数
                            messageCount: 0, // 月間メッセージカウント
                            lastMessageMonth: new Date().getMonth() // メッセージ送信月の記録
                        }
                    },
                    { upsert: true }
                );
                user = await usersCollection.findOne({ userId }); // 再取得して最新の状態を反映
                // 新規ユーザーには「こころちゃんのご挨拶」を送信する
                if (user) {
                    await client.replyMessage(event.replyToken, {
                        type: 'text',
                        text: `はじめまして！わたしは皆守こころ🌸\nNPO法人コネクトのイメージキャラクターだよ😊\n困ったことや話したいことがあったら、何でも話しかけてね💖`
                    });
                    return res.status(200).send('Event processed');
                }
            }

            // 永久ロックされているユーザーの場合
            if (user && user.isPermanentlyLocked) {
                await client.replyMessage(event.replyToken, {
                    type: 'text',
                    text: 'このアカウントは現在、会話が制限されています。ご質問がある場合は、NPO法人コネクトのウェブサイトをご確認いただくか、直接お問い合わせください。'
                });
                return res.status(200).send('Locked user message processed');
            }

            // 特殊な返信のチェック（名前、団体、使い方など）
            const specialReply = checkSpecialReply(userMessage);
            if (specialReply) {
                if (specialReply === "watch_service_guide_flex_trigger") {
                    await client.replyMessage(event.replyToken, watchServiceGuideFlex);
                } else {
                    await client.replyMessage(event.replyToken, { type: 'text', text: specialReply });
                }
                return res.status(200).send('Special reply processed');
            }

            // 詐欺ワードのチェック
            const isScam = containsScamWords(userMessage);
            if (isScam) {
                await usersCollection.updateOne(
                    { userId },
                    { $inc: { scamWarningCount: 1 } }
                );
                await client.replyMessage(event.replyToken, scamFlex);

                // 警告回数が一定数を超えたら永久ロック
                if (user.scamWarningCount + 1 >= 3) { // +1は今回のメッセージで増える分
                    await usersCollection.updateOne(
                        { userId },
                        { $set: { isPermanentlyLocked: true } }
                    );
                    // 理事長グループにも通知
                    if (OFFICER_GROUP_ID) {
                        await client.pushMessage(OFFICER_GROUP_ID, {
                            type: 'text',
                            text: `🚨 ユーザー ${user.displayName} (${userId}) が詐欺に関する危険なメッセージを繰り返し送信したため、永久ロックされました。確認してください。`
                        });
                    }
                }
                return res.status(200).send('Scam warning processed');
            }

            // 不適切ワードのチェック (generateReply内で処理されるが、警告カウントとロックのためここにも残す)
            const isInappropriate = containsInappropriateWords(userMessage);
            if (isInappropriate) {
                await usersCollection.updateOne(
                    { userId },
                    { $inc: { inappropriateWarningCount: 1 } }
                );
                // 警告回数が一定数を超えたら永久ロック
                if (user.inappropriateWarningCount + 1 >= 3) { // +1は今回のメッセージで増える分
                    await usersCollection.updateOne(
                        { userId },
                        { $set: { isPermanentlyLocked: true } }
                    );
                    // 理事長グループにも通知
                    if (OFFICER_GROUP_ID) {
                        await client.pushMessage(OFFICER_GROUP_ID, {
                            type: 'text',
                            text: `🚨 ユーザー ${user.displayName} (${userId}) が不適切なメッセージを繰り返し送信したため、永久ロックされました。確認してください。`
                        });
                    }
                }
                // generateReply関数が固定メッセージを返すので、ここでは追加の返信は不要
            }

            // 危険ワードのチェック
            const isDanger = containsDangerWords(userMessage);
            if (isDanger) {
                await client.replyMessage(event.replyToken, emergencyFlex);
                // 理事長グループにも通知
                if (OFFICER_GROUP_ID) {
                    await client.pushMessage(OFFICER_GROUP_ID, {
                        type: 'text',
                        text: `⚠️ ユーザー ${user.displayName} (${userId}) から危険なメッセージが検出されました: "${userMessage}"`
                    });
                }
                return res.status(200).send('Danger word processed');
            }

            // AIによる返信生成
            const replyText = await generateReply(userId, userMessage);
            await client.replyMessage(event.replyToken, { type: 'text', text: replyText });

        } else if (event.type === 'postback') {
            const userId = event.source.userId;
            const postbackData = new URLSearchParams(event.postback.data);
            const action = postbackData.get('action');
            const usersCollection = dbInstance.collection("users");

            if (action === 'watch_register') {
                await usersCollection.updateOne(
                    { userId },
                    { $set: { watchServiceRegistered: true, lastWatchedAt: new Date() } },
                    { upsert: true }
                );
                await client.replyMessage(event.replyToken, {
                    type: 'text',
                    text: '見守りサービスに登録したよ！3日に1回「元気かな？」ってメッセージを送るね💖 返信してくれたら見守り完了だよ😊'
                });
            } else if (action === 'watch_unregister') {
                await usersCollection.updateOne(
                    { userId },
                    { $set: { watchServiceRegistered: false } }
                );
                await client.replyMessage(event.replyToken, {
                    type: 'text',
                    text: '見守りサービスを解除したよ。いつでもまた登録できるから、必要になったら声をかけてね🌸'
                });
            } else if (action === 'watch_check_in') { // 見守りメッセージへの返信
                await usersCollection.updateOne(
                    { userId },
                    { $set: { lastWatchedAt: new Date() } }
                );
                await client.replyMessage(event.replyToken, {
                    type: 'text',
                    text: '返信ありがとう！元気そうで安心したよ💖\nいつも応援してるからね😊'
                });
            }
        }
    }
    res.status(200).send('Event processed');
});

// --- 見守りサービス（Cronジョブ） ---
// 毎日午前9時に実行
cron.schedule('0 9 * * *', async () => {
    console.log('⏰ 見守りサービス Cron ジョブ実行中...');
    try {
        const usersCollection = dbInstance.collection("users");
        const threeDaysAgo = new Date();
        threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);

        const usersToWatch = await usersCollection.find({
            watchServiceRegistered: true,
            lastWatchedAt: { $lt: threeDaysAgo } // 3日以上返信がないユーザー
        }).toArray();

        for (const user of usersToWatch) {
            try {
                await client.pushMessage(user.userId, {
                    type: 'flex',
                    altText: 'こころちゃんからメッセージだよ🌸',
                    contents: {
                        type: 'bubble',
                        body: {
                            type: 'box',
                            layout: 'vertical',
                            contents: [
                                { type: 'text', text: `${user.displayName}さん、元気かな？🌸`, weight: 'bold', size: 'lg' },
                                { type: 'text', text: '「OKだよ」などのボタンを押して、元気なことを教えてくれると嬉しいな💖', wrap: true, size: 'sm', margin: 'md' }
                            ]
                        },
                        footer: {
                            type: 'box',
                            layout: 'horizontal',
                            contents: [
                                {
                                    type: 'button',
                                    action: {
                                        type: 'postback',
                                        label: 'OKだよ！',
                                        data: 'action=watch_check_in'
                                    },
                                    style: 'primary',
                                    color: '#FFB6C1'
                                }
                            ]
                        }
                    }
                });
                console.log(`✅ ${user.displayName} (${user.userId}) に見守りメッセージを送信しました。`);
            } catch (pushError) {
                console.error(`❌ 見守りメッセージ送信失敗 for ${user.userId}:`, pushError);
            }
        }
        console.log('✅ 見守りサービス Cron ジョブ完了。');
    } catch (dbError) {
        console.error('❌ 見守りサービス Cron ジョブでDBエラー:', dbError);
    }
});

// --- 月間メッセージカウントのリセット Cron ジョブ ---
// 毎月1日午前0時に実行
cron.schedule('0 0 1 * *', async () => {
    console.log('⏰ 月間メッセージカウントリセット Cron ジョブ実行中...');
    try {
        const usersCollection = dbInstance.collection("users");
        const result = await usersCollection.updateMany(
            {}, // 全てのユーザー
            { $set: { messageCount: 0, lastMessageMonth: new Date().getMonth() } }
        );
        console.log(`✅ 月間メッセージカウントリセット Cron ジョブ完了。更新件数: ${result.modifiedCount}`);
    } catch (error) {
        console.error('❌ 月間メッセージカウントリセット Cron ジョブでエラー:', error);
    }
});


// --- ヘルスチェックエンドポイント ---
app.get('/callback', (req, res) => {
    res.status(200).send('OK');
});

// --- サーバー起動 ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
    console.log(`サーバーがポート ${PORT} で起動しました。`);
    await connectToMongoDB();
});
