const express = require('express');
const app = express();
const port = process.env.PORT || 10000;

app.post('/webhook', (req, res) => {
  console.log('✅ Webhook POST 受信しました！');
  res.status(200).send('OK');
});

app.listen(port, () => {
  console.log(`🚀 最小テストサーバーがポート ${port} で起動しました`);
});
