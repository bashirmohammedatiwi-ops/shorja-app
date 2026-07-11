const express = require('express');
const { login, authRequired, getMe } = require('../lib/auth');

const router = express.Router();

router.get('/me', authRequired(), (req, res) => {
  const user = getMe(req.user.id);
  if (!user) return res.status(401).json({ ok: false, error: 'المستخدم غير موجود' });
  res.json({ ok: true, user });
});

router.post('/login', (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ ok: false, error: 'أدخل اسم المستخدم وكلمة المرور' });
    }
    const result = login(username, password);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(401).json({ ok: false, error: err.message });
  }
});

module.exports = router;
