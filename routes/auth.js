const router = require('express').Router();
const bcrypt = require('bcryptjs');
const pool = require('../db');
const { wrap } = require('../lib/helpers');

router.get('/', (req, res) => res.redirect(req.session.user ? '/dashboard' : '/login'));
router.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/dashboard');
  res.render('login', { title: 'Connexion', error: null, email: '' });
});
router.post('/login', wrap(async (req, res, next) => {
  const email = String(req.body.email || '').trim().toLowerCase().slice(0, 150);
  const password = String(req.body.password || '').slice(0, 200);
  const u = (await pool.query('SELECT * FROM users WHERE LOWER(email) = $1', [email])).rows[0];
  const ok = u && await bcrypt.compare(password, u.password_hash);
  if (!ok) return res.status(401).render('login', { title: 'Connexion', error: 'Email ou mot de passe incorrect.', email });
  req.session.regenerate((err) => {
    if (err) return next(err);
    req.session.user = { id: u.id, nom: u.nom, prenom: u.prenom, email: u.email, role: u.role };
    req.session.save(() => res.redirect('/dashboard'));
  });
}));
router.post('/logout', (req, res) => req.session.destroy(() => res.redirect('/login')));
module.exports = router;
