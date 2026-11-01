const router = require('express').Router();
const bcrypt = require('bcryptjs');
const pool = require('../db');
const { requireRole } = require('../middleware/auth');
const { classFull } = require('../lib/queries');
const { wrap, clean, isInt, isDate, isAnnee, isEmail, ANNEE, fmtDate } = require('../lib/helpers');
router.use(requireRole('admin'));

async function options() {
  const classes = (await pool.query(`SELECT c.id, c.niveau, c.section, c.annee_scolaire, r.nom AS salle, r.capacite,
      (SELECT COUNT(*)::int FROM students s WHERE s.class_id = c.id) AS nb
    FROM classes c LEFT JOIN rooms r ON r.id = c.room_id ORDER BY c.annee_scolaire DESC, c.niveau, c.section`)).rows
    .map((c) => ({ value: c.id, label: `${c.niveau} ${c.section} (${c.annee_scolaire})` + (c.capacite ? ` — ${c.nb}/${c.capacite} places` : '') }));
  const parents = (await pool.query(`SELECT p.id, u.prenom, u.nom, p.telephone FROM parents p JOIN users u ON u.id=p.user_id ORDER BY u.nom, u.prenom`)).rows
    .map((p) => ({ value: p.id, label: `${p.prenom} ${p.nom} — ${p.telephone || 'sans téléphone'}` }));
  return { classes, parents };
}
const fields = (o, creating) => [
  { name: 'nom', label: 'Nom', required: true, maxlength: 100 },
  { name: 'prenom', label: 'Prénom', required: true, maxlength: 100 },
  { name: 'date_naissance', label: 'Date de naissance', type: 'date', required: true },
  { name: 'annee_scolaire', label: 'Année scolaire', required: true, placeholder: '2026-2027', maxlength: 9 },
  { name: 'class_id', label: 'Classe', type: 'select', options: o.classes, required: true },
  { name: 'parent_id', label: creating ? 'Parent existant' : 'Parent (contact)', type: 'select', options: o.parents, required: !creating },
  ...(creating ? [
    { type: 'heading', label: 'Ou créer un nouveau parent (laisser vide si vous choisissez un parent existant)' },
    { name: 'np_prenom', label: 'Prénom du parent', maxlength: 100 }, { name: 'np_nom', label: 'Nom du parent', maxlength: 100 },
    { name: 'np_email', label: 'Email du parent (identifiant de connexion)', type: 'email', maxlength: 150 },
    { name: 'np_telephone', label: 'Téléphone du parent', maxlength: 30 },
    { name: 'np_password', label: 'Mot de passe du parent (8 caractères min.)', type: 'password', minlength: 8 },
    { type: 'heading', label: 'Optionnel : compte de connexion pour l\'élève (pour consulter ses devoirs et notes)' },
    { name: 'es_email', label: 'Email de l\'élève', type: 'email', maxlength: 150 },
    { name: 'es_password', label: 'Mot de passe de l\'élève (8 caractères min.)', type: 'password', minlength: 8 },
  ] : []),
];
const KEYS = ['nom', 'prenom', 'date_naissance', 'annee_scolaire', 'class_id', 'parent_id', 'np_prenom', 'np_nom', 'np_email', 'np_telephone', 'es_email'];
function validate(b, creating) {
  const v = {}; KEYS.forEach((k) => { v[k] = clean(b[k]); }); v.np_email = v.np_email.toLowerCase(); v.es_email = v.es_email.toLowerCase();
  const np_password = String(b.np_password || ''); const es_password = String(b.es_password || '');
  const e = [];
  if (!v.nom || v.nom.length > 100) e.push('Le nom est obligatoire (100 caractères max).');
  if (!v.prenom || v.prenom.length > 100) e.push('Le prénom est obligatoire (100 caractères max).');
  if (!isDate(v.date_naissance) || v.date_naissance >= new Date().toISOString().slice(0, 10)) e.push('La date de naissance est invalide.');
  if (!isAnnee(v.annee_scolaire)) e.push("L'année scolaire doit ressembler à 2026-2027.");
  if (!isInt(v.class_id)) e.push('Choisissez une classe.');
  const newParent = creating && (v.np_prenom || v.np_nom || v.np_email || np_password);
  if (!isInt(v.parent_id) && !newParent) e.push('Choisissez un parent existant ou saisissez les informations d\'un nouveau parent.');
  if (isInt(v.parent_id) && newParent) e.push('Choisissez soit un parent existant, soit un nouveau parent (pas les deux).');
  if (newParent && !isInt(v.parent_id) && (!v.np_prenom || !v.np_nom || !isEmail(v.np_email) || np_password.length < 8)) e.push('Nouveau parent : prénom, nom, email valide et mot de passe (8 caractères min.) sont obligatoires.');
  if (v.np_telephone.length > 30) e.push('Téléphone trop long.');
  const stuAcc = creating && (v.es_email || es_password);
  if (stuAcc && (!isEmail(v.es_email) || es_password.length < 8)) e.push('Compte élève : email valide et mot de passe (8 caractères min.) obligatoires.');
  return { v, e, newParent: !!newParent && !isInt(v.parent_id), stuAcc: !!stuAcc, np_password, es_password };
}
const form = (res, o) => res.render('crud-form', { cancelUrl: '/students', ...o });

router.get('/', wrap(async (req, res) => {
  const q = clean(req.query.q).slice(0, 50);
  const rows = (await pool.query(`SELECT s.id, s.nom, s.prenom, s.date_naissance, s.annee_scolaire, c.niveau || ' ' || c.section AS classe,
      u.prenom || ' ' || u.nom AS parent, p.telephone AS contact
    FROM students s JOIN classes c ON c.id=s.class_id JOIN parents p ON p.id=s.parent_id JOIN users u ON u.id=p.user_id
    WHERE $1::text = '' OR (s.prenom || ' ' || s.nom) ILIKE $2 OR (s.nom || ' ' || s.prenom) ILIKE $2 OR c.niveau ILIKE $2
    ORDER BY s.nom, s.prenom`, [q, `%${q}%`])).rows;
  res.render('crud-list', { title: 'Élèves', q, search: true, addUrl: '/students/new', addLabel: 'Ajouter un élève',
    columns: [{ label: 'Nom', key: 'nom' }, { label: 'Prénom', key: 'prenom' }, { label: 'Naissance', key: 'date_naissance', fmt: fmtDate },
      { label: 'Classe', key: 'classe' }, { label: 'Année', key: 'annee_scolaire' }, { label: 'Parent', key: 'parent' }, { label: 'Contact', key: 'contact' }],
    rows, editUrl: (r) => `/students/${r.id}/edit`, deleteUrl: (r) => `/students/${r.id}/delete`,
    deleteMsg: (r) => `Supprimer l'élève ${r.prenom} ${r.nom} ?`, extra: [{ label: 'Bulletin', icon: 'journal-text', href: (r) => `/bulletin/${r.id}` }] });
}));
router.get('/new', wrap(async (req, res) => {
  form(res, { title: 'Ajouter un élève', action: '/students', fields: fields(await options(), true), values: { annee_scolaire: ANNEE }, errors: [] });
}));
router.post('/', wrap(async (req, res) => {
  const r = validate(req.body, true); const { v, e } = r;
  if (!e.length) { const full = await classFull(v.class_id); if (full) e.push(full); }
  if (!e.length) {
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      let parentId = v.parent_id;
      if (r.newParent) {
        const uid = (await c.query("INSERT INTO users (nom,prenom,email,password_hash,role) VALUES ($1,$2,$3,$4,'parent') RETURNING id", [v.np_nom, v.np_prenom, v.np_email, await bcrypt.hash(r.np_password, 10)])).rows[0].id;
        parentId = (await c.query('INSERT INTO parents (user_id,telephone) VALUES ($1,$2) RETURNING id', [uid, v.np_telephone || null])).rows[0].id;
      }
      const sid = (await c.query('INSERT INTO students (nom,prenom,date_naissance,class_id,parent_id,annee_scolaire) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id', [v.nom, v.prenom, v.date_naissance, v.class_id, parentId, v.annee_scolaire])).rows[0].id;
      if (r.stuAcc) {
        const uid = (await c.query("INSERT INTO users (nom,prenom,email,password_hash,role) VALUES ($1,$2,$3,$4,'eleve') RETURNING id", [v.nom, v.prenom, v.es_email, await bcrypt.hash(r.es_password, 10)])).rows[0].id;
        await c.query('UPDATE students SET user_id=$1 WHERE id=$2', [uid, sid]);
      }
      await c.query('COMMIT');
      req.flash('success', `Élève ${v.prenom} ${v.nom} ajouté` + (r.newParent ? ' avec son nouveau parent.' : '.')); return res.redirect('/students');
    } catch (err) {
      await c.query('ROLLBACK');
      if (err.code === '23505') e.push('Un compte existe déjà avec cet email (parent ou élève).');
      else if (err.code === '23503') e.push('Classe ou parent introuvable.'); else throw err;
    } finally { c.release(); }
  }
  form(res, { title: 'Ajouter un élève', action: '/students', fields: fields(await options(), true), values: v, errors: e });
}));
router.get('/:id/edit', wrap(async (req, res) => {
  if (!isInt(req.params.id)) return res.redirect('/students');
  const s = (await pool.query('SELECT * FROM students WHERE id=$1', [req.params.id])).rows[0];
  if (!s) { req.flash('danger', 'Élève introuvable.'); return res.redirect('/students'); }
  form(res, { title: 'Modifier un élève', action: `/students/${s.id}/edit`, fields: fields(await options(), false), values: s, errors: [] });
}));
router.post('/:id/edit', wrap(async (req, res) => {
  if (!isInt(req.params.id)) return res.redirect('/students');
  const { v, e } = validate(req.body, false);
  if (!e.length) {
    const cur = (await pool.query('SELECT class_id FROM students WHERE id=$1', [req.params.id])).rows[0];
    if (cur && String(cur.class_id) !== v.class_id) { const full = await classFull(v.class_id, req.params.id); if (full) e.push(full); }
  }
  if (!e.length) {
    try {
      const r = await pool.query('UPDATE students SET nom=$1, prenom=$2, date_naissance=$3, class_id=$4, parent_id=$5, annee_scolaire=$6 WHERE id=$7', [v.nom, v.prenom, v.date_naissance, v.class_id, v.parent_id, v.annee_scolaire, req.params.id]);
      req.flash(r.rowCount ? 'success' : 'danger', r.rowCount ? 'Dossier modifié.' : 'Élève introuvable.'); return res.redirect('/students');
    } catch (err) { if (err.code !== '23503') throw err; e.push('Classe ou parent introuvable.'); }
  }
  form(res, { title: 'Modifier un élève', action: `/students/${req.params.id}/edit`, fields: fields(await options(), false), values: v, errors: e });
}));
router.post('/:id/delete', wrap(async (req, res) => {
  if (!isInt(req.params.id)) return res.redirect('/students');
  try {
    const r = await pool.query('DELETE FROM students WHERE id=$1 RETURNING user_id', [req.params.id]);
    if (r.rowCount && r.rows[0].user_id) await pool.query('DELETE FROM users WHERE id=$1', [r.rows[0].user_id]);
    req.flash(r.rowCount ? 'success' : 'danger', r.rowCount ? 'Élève supprimé (ses notes ont été supprimées avec lui).' : 'Élève introuvable.');
  } catch (err) {
    if (err.code !== '23503') throw err;
    req.flash('danger', "Suppression impossible : cet élève a des paiements enregistrés.");
  }
  res.redirect('/students');
}));
module.exports = router;
