# شورجة — نظام مبيعات الفروع

مشروع مستقل تماماً يربط بين:
- **تطبيق الفرع** (نقطة بيع + باركود + offline)
- **تطبيق الإدارة** (مبيعات يومية + أسعار + حسابات)

## التشغيل

```bash
cd "C:\Users\Future of Technology\Documents\shorja_app"
copy .env.example .env
npm install
npm start
```

السيرفر يعمل على **المنفذ 5007**:
- نقطة البيع: http://localhost:5007/branch/
- الإدارة: http://localhost:5007/admin/
- API: http://localhost:5007/api/health

## حسابات افتراضية

| التطبيق | المستخدم | كلمة المرور |
|---------|----------|-------------|
| الإدارة | admin | admin123 |
| الفرع | branch | branch123 |

## المميزات

### تطبيق الفرع
- إنشاء فاتورة بيع سريعة
- مسح/إدخال باركود — Enter يضيف فوراً
- قارئ باركود USB يعمل تلقائياً
- عمل بدون إنترنت (منتجات محفوظة + فواتير في قائمة انتظار)
- رفع تلقائي عند عودة الاتصال
- إشعار تحديث أسعار من الإدارة
- تسديد حسابات وديون
- بيع نقدي / آجل / جزئي

### تطبيق الإدارة
- لوحة مبيعات اليوم
- عرض فواتير الفروع
- زر **رفع تحديث أسعار** للفروع
- إدارة حسابات العملاء
- تسديد ديون وتسجيل قيود

## البنية

```
shorja_app/
├── server/              # Backend Express + SQLite (منفذ 5007)
├── public/
│   ├── branch/          # واجهة نقطة البيع
│   └── admin/           # واجهة الإدارة
├── desktop-branch/      # تطبيق سطح مكتب للفرع (Electron)
├── desktop-admin/       # تطبيق سطح مكتب للإدارة (Electron)
└── data/                # قاعدة البيانات
```

## تطبيق سطح المكتب

```bash
# شغّل السيرفر أولاً
npm start

# الفرع
cd desktop-branch && npm install && npm start

# الإدارة
cd desktop-admin && npm install && npm start
```

للاتصال بسيرفر بعيد:
```bash
set SHORJA_SERVER=http://187.124.23.65:5007
npm start
```

## ميزات إضافية (التحديث الأخير)

- **مرتجع مبيعات** — كامل أو جزئي من تبويب «مرتجع»
- **طباعة فاتورة** — تلقائياً بعد البيع + من تفاصيل الفاتورة
- **تطبيق تحديث أسعار** — من الإدارة مع إشعار في الفرع
- **استيراد منتجات CSV** — من الإدارة
- **تطبيق سطح مكتب** — Electron للفرع والإدارة

## النشر على السيرفر (Docker — VPS)

السيرفر الافتراضي: **http://187.124.23.65:5007**

### على VPS (Linux)

```bash
git clone https://github.com/bashirmohammedatiwi-ops/shorja-app.git
cd shorja-app
cp .env.example .env
# عدّل JWT_SECRET و ADMIN_PASS و SYNC_KEY في .env
chmod +x deploy.sh
./deploy.sh
```

أو يدوياً:

```bash
docker compose build
docker compose up -d
docker compose logs -f
```

### الروابط بعد النشر

| الخدمة | الرابط |
|--------|--------|
| نقطة البيع | http://187.124.23.65:5007/branch/ |
| الإدارة | http://187.124.23.65:5007/admin/ |
| API | http://187.124.23.65:5007/api/health |

> تأكد من فتح المنفذ **5007** في جدار الحماية (ufw / firewall).

### بدون Docker

```bash
PORT=5007 HOST=0.0.0.0 npm start
```

## بناء تطبيقات Windows (EXE)

التطبيقات تتصل تلقائياً بـ `http://187.124.23.65:5007`  
يمكن تغيير العنوان عبر ملف `server.json` بجانب البرنامج:

```json
{ "server": "http://187.124.23.65:5007" }
```

### بناء سريع (Windows)

```bat
build-desktop.bat
```

### يدوياً

```bash
cd desktop-admin && npm install && npm run build
cd ../desktop-branch && npm install && npm run build
```

الملفات الناتجة:
- `desktop-admin/dist/Shorja-Admin-Setup-1.0.0.exe`
- `desktop-branch/dist/Shorja-Branch-Setup-1.0.0.exe`

## باركود تجريبي

| الباركود | المنتج |
|----------|--------|
| 6281000001001 | كريم مرطب |
| 6281000001002 | شامبو |
| 6281000001003 | عطر رجالي |
