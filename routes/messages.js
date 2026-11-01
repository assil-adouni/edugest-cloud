const router = require('express').Router();
const pool = require('../db');
const { requireLogin } = require('../middleware/auth');
const { wrap, clean, isInt, ROLES } = require('../lib/helpers');
const { getTeacherId } = require('../lib/queries');
router.use(requireLogin);

// Destinataires autorisés : envois groupés (parents, classes, enseignants) + personnes
async function recipients(user) {
  const groups = []; const special = new Set();
  const own = [];
  if (['admin', 'comptable', 'enseignant'].includes(user.role)) own.push({ value: 'all_parents', label: user.role === 'enseignant' ? 'Tous les parents de mes classes' : 'Tous les parents' });
  if (user.role === 'admin') own.push({ value: 'all_teachers', label: 'Tous les enseignants' });
  if (user.role === 'admin' || user.role === 'enseignant') {
    const cls = user.role === 'admin'
      ? (await pool.query(`SELECT id, niveau || ' ' || section AS nom FROM classes ORDER BY niveau, section`)).rows
      : (await pool.query(`SELECT id, niveau || ' ' || section AS nom FROM classes WHERE teacher_id=$1 ORDER BY niveau`, [await getTeacherId(user.id)])).rows;
    cls.forEach((c) => own.push({ value: `class_${c.id}`, label: `Parents de la classe ${c.nom}` }));
  }
  if (own.length) { groups.push({ label: 'Envoi groupé', options: own }); own.forEach((o) => special.add(o.value)); }
  const staffOnly = user.role === 'parent' || user.role === 'eleve';
  const rows = (await pool.query(`SELECT id, prenom, nom, role FROM users WHERE id <> $1 ${staffOnly ? "AND role NOT IN ('parent','eleve')" : ''} ORDER BY role, nom`, [user.id])).rows;
  groups.push({ label: 'Personnes', options: rows.map((r) => ({ value: String(r.id), label: `${r.prenom} ${r.nom} (${ROLES[r.role]})` })) });
  return { groups, special, ids: new Set(rows.map((r) => String(r.id))) };
}
async function resolve(user, value) {
  if (value === 'all_parents') {
    if (user.role === 'enseignant') return (await pool.query('SELECT DISTINCT p.user_id AS id FROM students s JOIN parents p ON p.id=s.parent_id JOIN classes c ON c.id=s.class_id WHERE c.teacher_id=$1', [await getTeacherId(user.id)])).rows.map((r) => r.id);
    return (await pool.query('SELECT user_id AS id FROM parents')).rows.map((r) => r.id);
  }
  if (value === 'all_teachers') return (await pool.query('SELECT user_id AS id FROM teachers')).rows.map((r) => r.id);
  if (value.startsWith('class_')) {
    const cid = value.slice(6);
    if (user.role === 'enseignant' && !(await pool.query('SELECT 1 FROM classes WHERE id=$1 AND teacher_id=$2', [cid, await getTeacherId(user.id)])).rowCount) return [];
    return (await pool.query('SELECT DISTINCT p.user_id AS id FROM students s JOIN parents p ON p.id=s.parent_id WHERE s.class_id=$1', [cid])).rows.map((r) => r.id);
  }
  return [Number(value)];
}
const MSG = `SELECT m.*, us.prenom || ' ' || us.nom AS expediteur, ur.prenom || ' ' || ur.nom AS destinataire
  FROM messages m JOIN users us ON us.id=m.sender_id JOIN users ur ON ur.id=m.recipient_id`;
const visible = `((m.sender_id=$2 AND NOT m.deleted_sender) OR (m.recipient_id=$2 AND NOT m.deleted_recipient))`;

router.get('/', wrap(async (req, res) => {
  const box = req.query.box === 'sent' ? 'sent' : 'inbox'; const uid = req.session.user.id;
  const rows = (await pool.query(`${MSG} WHERE ${box === 'sent' ? 'm.sender_id=$1 AND NOT m.deleted_sender' : 'm.recipient_id=$1 AND NOT m.deleted_recipient'} ORDER BY m.created_at DESC`, [uid])).rows;
  res.render('messages', { title: 'Messagerie', rows, box });
}));
router.get('/new', wrap(async (req, res) => {
  const v = { recipient_id: clean(req.query.to).slice(0, 20), objet: clean(req.query.objet).slice(0, 150), contenu: '' };
  res.render('message-form', { title: 'Nouveau message', groups: (await recipients(req.session.user)).groups, errors: [], v, editMode: false });
}));
router.post('/', wrap(async (req, res) => {
  const u = req.session.user; const v = { recipient_id: clean(req.body.recipient_id), objet: clean(req.body.objet), contenu: clean(req.body.contenu) }; const e = [];
  const r = await recipients(u);
  if (!r.special.has(v.recipient_id) && !r.ids.has(v.recipient_id)) e.push('Destinataire invalide ou non autorisé.');
  if (!v.objet || v.objet.length > 150) e.push("L'objet est obligatoire (150 caractères max).");
  if (!v.contenu || v.contenu.length > 5000) e.push('Le message est obligatoire (5000 caractères max).');
  let ids = [];
  if (!e.length) { ids = await resolve(u, v.recipient_id); if (!ids.length) e.push('Aucun destinataire trouvé pour cet envoi.'); }
  if (e.length) return res.status(400).render('message-form', { title: 'Nouveau message', groups: r.groups, errors: e, v, editMode: false });
  await pool.query('INSERT INTO messages (sender_id,recipient_id,objet,contenu) SELECT $1, x, $2, $3 FROM unnest($4::int[]) AS x', [u.id, v.objet, v.contenu, ids]);
  req.flash('success', ids.length > 1 ? `Message envoyé à ${ids.length} destinataires.` : 'Message envoyé.'); res.redirect('/messages?box=sent');
}));
async function mine(req) { return isInt(req.params.id) ? (await pool.query(`${MSG} WHERE m.id=$1 AND ${visible}`, [req.params.id, req.session.user.id])).rows[0] : null; }
const notFound = (res) => res.status(404).render('error', { title: 'Message introuvable', message: "Ce message n'existe pas ou ne vous est pas destiné." });

router.get('/:id/edit', wrap(async (req, res) => {
  const m = await mine(req);
  if (!m || m.sender_id !== req.session.user.id) return notFound(res);
  res.render('message-form', { title: 'Modifier le message', groups: [], errors: [], v: m, editMode: true, m });
}));
router.post('/:id/edit', wrap(async (req, res) => {
  const m = await mine(req);
  if (!m || m.sender_id !== req.session.user.id) return notFound(res);
  const v = { ...m, objet: clean(req.body.objet), contenu: clean(req.body.contenu) }; const e = [];
  if (!v.objet || v.objet.length > 150) e.push("L'objet est obligatoire (150 caractères max).");
  if (!v.contenu || v.contenu.length > 5000) e.push('Le message est obligatoire (5000 caractères max).');
  if (e.length) return res.status(400).render('message-form', { title: 'Modifier le message', groups: [], errors: e, v, editMode: true, m });
  await pool.query('UPDATE messages SET objet=$1, contenu=$2, edited_at=NOW(), is_read=FALSE WHERE id=$3', [v.objet, v.contenu, m.id]);
  req.flash('success', 'Message modifié.'); res.redirect(`/messages/${m.id}`);
}));
router.post('/:id/delete', wrap(async (req, res) => {
  const m = await mine(req); if (!m) return notFound(res);
  const mineSent = m.sender_id === req.session.user.id;
  await pool.query(`UPDATE messages SET ${mineSent ? 'deleted_sender' : 'deleted_recipient'}=TRUE WHERE id=$1`, [m.id]);
  await pool.query('DELETE FROM messages WHERE id=$1 AND deleted_sender AND deleted_recipient', [m.id]);
  req.flash('success', 'Message supprimé.'); res.redirect(`/messages${mineSent ? '?box=sent' : ''}`);
}));
router.get('/:id', wrap(async (req, res) => {
  const m = await mine(req); if (!m) return notFound(res);
  if (m.recipient_id === req.session.user.id && !m.is_read) await pool.query('UPDATE messages SET is_read=TRUE WHERE id=$1', [m.id]);
  res.render('message-show', { title: m.objet, m });
}));
module.exports = router;
