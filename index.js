const express = require('express');
const app = express();

app.get('/', (req, res) => {
  res.send('✅ Server is running!');
});

const port = process.env.PORT || 10000;
app.listen(port, () => {
  console.log(`✅ Listening on port ${port}`);
});
