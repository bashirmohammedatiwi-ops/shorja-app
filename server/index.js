require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

require('./db');

const authRoutes = require('./routes/auth');
const branchRoutes = require('./routes/branch');
const adminRoutes = require('./routes/admin');
const syncRoutes = require('./routes/sync');

const app = express();
const PORT = Number(process.env.PORT || 5007);
const HOST = process.env.HOST || '0.0.0.0';

app.use(cors({ origin: true }));
app.use(express.json({ limit: '20mb' }));

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'shorja-sales-hub',
    port: PORT,
    time: new Date().toISOString()
  });
});

app.use('/api/auth', authRoutes);
app.use('/api/branch', branchRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/sync', syncRoutes);

app.use('/branch', express.static(path.join(__dirname, '..', 'public', 'branch')));
app.get('/branch/*', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'branch', 'index.html'));
});

app.use('/admin', express.static(path.join(__dirname, '..', 'public', 'admin')));
app.get('/admin/*', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'admin', 'index.html'));
});

app.get('/', (_req, res) => {
  res.redirect('/branch/');
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ ok: false, error: err.message || 'خطأ في السيرفر' });
});

app.listen(PORT, HOST, () => {
  console.log(`Shorja Sales Hub: http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  console.log(`  Branch POS:  http://localhost:${PORT}/branch/`);
  console.log(`  Admin:       http://localhost:${PORT}/admin/`);
});
