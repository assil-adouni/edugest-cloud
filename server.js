require('dotenv').config();
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const pool = require('./db');
const H = require('./lib/helpers');
const { requireLogin } = require('./middleware/auth');
const { initDb } = require('./scripts/init-db');

const app = express();
const isProd = process.env.NODE_ENV === 'production';
if (isProd && !process.env.SESSION_SECRET) { console.error('SESSION_SECRET est obligatoire en production.'); process.exit(1); }

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('trust proxy', 1);           // l'application est derrière le proxy HTTPS du PaaS
app.disable('x-powered-by');
Object.assign(app.locals, { money: H.money, fmtDate: H.fmtDate, fmtDateTime: H.fmtDateTime, ROLES: H.ROLES, MODES: H.MODES, ANNEE: H.ANNEE });

app.use(express.urlencoded({ extended: false, limit: '100kb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Vérification de santé (avant la session : aucune écriture en base)
app.get('/health', async (req, res) => {
  try { await pool.query('SELECT 1'); res.json({ status: 'ok', database: 'ok', time: new Date().toISOString() }); }
  catch (e) { res.status(503).json({ status: 'error', database: 'indisponible' }); }
});

app.use(session({
  store: new pgSession({ pool, createTableIfMissing: true }), // sessions persistantes en base
  secret: process.env.SESSION_SECRET || 'dev-secret-a-changer',
  resave: false, saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: isProd, maxAge: 8 * 3600 * 1000 }
}));

// Protection CSRF + variables communes aux vues
app.use(H.wrap(async (req, res, next) => {
  if (!req.session.csrf) req.session.csrf = crypto.randomBytes(24).toString('hex');
  if (req.method === 'POST' && req.body._csrf !== req.session.csrf) {
    return res.status(403).render('error', { title: 'Erreur', message: 'Jeton de sécurité invalide. Rechargez la page puis réessayez.', user: req.session.user, csrf: req.session.csrf, flash: null, currentPath: req.path, unreadNotif: 0, unreadMsg: 0 });
  }
  req.flash = (type, msg) => { req.session.flash = { type, msg }; };
  res.locals.csrf = req.session.csrf;
  res.locals.flash = req.session.flash || null; delete req.session.flash;
  res.locals.user = req.session.user || null;
  res.locals.currentPath = req.path;
  res.locals.unreadNotif = 0; res.locals.unreadMsg = 0;
  if (req.session.user) {
    const r = await pool.query(`SELECT (SELECT COUNT(*)::int FROM notifications WHERE user_id=$1 AND NOT is_read) AS n,
      (SELECT COUNT(*)::int FROM messages WHERE recipient_id=$1 AND NOT is_read) AS m`, [req.session.user.id]);
    res.locals.unreadNotif = r.rows[0].n; res.locals.unreadMsg = r.rows[0].m;
  }
  next();
}));

app.use('/', require('./routes/auth'));
app.use('/dashboard', requireLogin, require('./routes/dashboard'));
app.use('/students', require('./routes/students'));
app.use('/', require('./routes/academic'));       // /classes et /subjects
app.use('/users', require('./routes/users'));
app.use('/', require('./routes/grades'));         // /grades et /bulletin/:id
app.use('/payments', require('./routes/payments'));
app.use('/homework', require('./routes/homework'));
app.use('/announcements', require('./routes/announcements'));
app.use('/messages', require('./routes/messages'));
app.use('/', require('./routes/misc'));           // /notifications et /children

app.use((req, res) => res.status(404).render('error', { title: 'Page introuvable', message: "Cette page n'existe pas." }));
app.use((err, req, res, next) => {
  console.error(err); // détail uniquement dans les logs serveur
  if (res.headersSent) return next(err);
  res.status(500).render('error', { title: 'Erreur', message: 'Une erreur est survenue. Réessayez ou contactez l\'administrateur.' });
});

const PORT = process.env.PORT || 3000;
(async () => {
  try {
    if (process.env.AUTO_INIT_DB !== 'false') await initDb({ withSeed: process.env.SEED_DEMO_DATA !== 'false' });
    app.listen(PORT, () => console.log(`EduGest Cloud démarré sur le port ${PORT}`));
  } catch (e) { console.error('Démarrage impossible :', e.message); process.exit(1); }
})();
