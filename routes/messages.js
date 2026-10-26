const router = require('express').Router();
const pool = require('../db');
const { requireLogin } = require('../middleware/auth');
const { wrap, clean, isInt, ROLES } = require('../lib/helpers');
router.use(requireLogin);

// Un parent peut écrire au personnel de l'école, mais pas aux autres parents
async function recipients(user) {
  const rows = (await pool.query(`SELECT id, prenom, nom, role FROM users WHERE id <> $1 ${user.role === 'parent' ? "AND role <> 'parent'" : ''} ORDER BY role, nom`, [user.id])).rows;
  return rows.map((r) => ({ value: r.id, label: `${r.prenom} ${r.nom} (${ROLES[r.role]})` }));
}
router.get('/', wrap(async (req, res) => {
  const box = req.query.box === 'sent' ? 'sent' : 'inbox'; const uid = req.session.user.id;
  const rows = (await pool.query(`SELECT m.id, m.objet, m.created_at, m.is_read, us.prenom || ' ' || us.nom AS expediteur, ur.prenom || ' ' || ur.nom AS destinataire
    FROM messages m JOIN users us ON us.id=m.sender_id JOIN users ur ON ur.id=m.recipient_id
    WHERE ${box === 'sent' ? 'm.sender_id' : 'm.recipient_id'} = $1 ORDER BY m.created_at DESC`, [uid])).rows;
  res.render('messages', { title: 'Messagerie', rows, box });
}));
router.get('/new', wrap(async (req, res) => {
  const v = { recipient_id: isInt(req.query.to) ? req.query.to : '', objet: clean(req.query.objet).slice(0, 150), contenu: '' };
  res.render('message-form', { title: 'Nouveau message', recipients: await recipients(req.session.user), errors: [], v });
}));
router.post('/', wrap(async (req, res) => {
  const v = { recipient_id: clean(req.body.recipient_id), objet: clean(req.body.objet), contenu: clean(req.body.contenu) }; const e = [];
  const list = await recipients(req.session.user);
  if (!list.some((r) => String(r.value) === v.recipient_id)) e.push("Destinataire invalide ou non autorisé.");
  if (!v.objet || v.objet.length > 150) e.push("L'objet est obligatoire (150 caractères max).");
  if (!v.contenu || v.contenu.length > 5000) e.push('Le message est obligatoire (5000 caractères max).');
  if (e.length) return res.status(400).render('message-form', { title: 'Nouveau message', recipients: list, errors: e, v });
  await pool.query('INSERT INTO messages (sender_id,recipient_id,objet,contenu) VALUES ($1,$2,$3,$4)', [req.session.user.id, v.recipient_id, v.objet, v.contenu]);
  req.flash('success', 'Message envoyé.'); res.redirect('/messages?box=sent');
}));
router.get('/:id', wrap(async (req, res) => {
  const uid = req.session.user.id;
  const m = isInt(req.params.id) && (await pool.query(`SELECT m.*, us.prenom || ' ' || us.nom AS expediteur, ur.prenom || ' ' || ur.nom AS destinataire
    FROM messages m JOIN users us ON us.id=m.sender_id JOIN users ur ON ur.id=m.recipient_id WHERE m.id=$1 AND (m.sender_id=$2 OR m.recipient_id=$2)`, [req.params.id, uid])).rows[0];
  if (!m) return res.status(404).render('error', { title: 'Message introuvable', message: "Ce message n'existe pas ou ne vous est pas destiné." });
  if (m.recipient_id === uid && !m.is_read) await pool.query('UPDATE messages SET is_read=TRUE WHERE id=$1', [m.id]);
  res.render('message-show', { title: m.objet, m });
}));
module.exports = router;
