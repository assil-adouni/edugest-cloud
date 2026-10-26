const router = require('express').Router();
const pool = require('../db');
const { requireRole } = require('../middleware/auth');
const { wrap, clean, isInt, isDate, isAnnee, ANNEE, fmtDate } = require('../lib/helpers');
router.use(requireRole('admin'));

async function options() {
  const classes = (await pool.query('SELECT id, niveau, section, annee_scolaire FROM classes ORDER BY annee_scolaire DESC, niveau, section')).rows
    .map((c) => ({ value: c.id, label: `${c.niveau} ${c.section} (${c.annee_scolaire})` }));
  const parents = (await pool.query(`SELECT p.id, u.prenom, u.nom, p.telephone FROM parents p JOIN users u ON u.id=p.user_id ORDER BY u.nom, u.prenom`)).rows
    .map((p) => ({ value: p.id, label: `${p.prenom} ${p.nom} — ${p.telephone || 'sans téléphone'}` }));
  return { classes, parents };
}
const fields = (o) => [
  { name: 'nom', label: 'Nom', required: true, maxlength: 100 },
  { name: 'prenom', label: 'Prénom', required: true, maxlength: 100 },
  { name: 'date_naissance', label: 'Date de naissance', type: 'date', required: true },
  { name: 'annee_scolaire', label: 'Année scolaire', required: true, placeholder: '2026-2027', maxlength: 9 },
  { name: 'class_id', label: 'Classe', type: 'select', options: o.classes, required: true },
  { name: 'parent_id', label: 'Parent (contact)', type: 'select', options: o.parents, required: true },
];
function validate(b) {
  const v = { nom: clean(b.nom), prenom: clean(b.prenom), date_naissance: clean(b.date_naissance), annee_scolaire: clean(b.annee_scolaire), class_id: clean(b.class_id), parent_id: clean(b.parent_id) };
  const e = [];
  if (!v.nom || v.nom.length > 100) e.push('Le nom est obligatoire (100 caractères max).');
  if (!v.prenom || v.prenom.length > 100) e.push('Le prénom est obligatoire (100 caractères max).');
  if (!isDate(v.date_naissance) || v.date_naissance >= new Date().toISOString().slice(0, 10)) e.push('La date de naissance est invalide.');
  if (!isAnnee(v.annee_scolaire)) e.push("L'année scolaire doit ressembler à 2026-2027.");
  if (!isInt(v.class_id)) e.push('Choisissez une classe.');
  if (!isInt(v.parent_id)) e.push('Choisissez un parent.');
  return { v, e };
}
const form = async (res, o) => res.render('crud-form', { cancelUrl: '/students', ...o });

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
  const o = await options();
  form(res, { title: 'Ajouter un élève', action: '/students', fields: fields(o), values: { annee_scolaire: ANNEE }, errors: [] });
}));
router.post('/', wrap(async (req, res) => {
  const { v, e } = validate(req.body);
  if (!e.length) {
    try {
      await pool.query('INSERT INTO students (nom,prenom,date_naissance,class_id,parent_id,annee_scolaire) VALUES ($1,$2,$3,$4,$5,$6)', [v.nom, v.prenom, v.date_naissance, v.class_id, v.parent_id, v.annee_scolaire]);
      req.flash('success', `Élève ${v.prenom} ${v.nom} ajouté.`); return res.redirect('/students');
    } catch (err) { if (err.code !== '23503') throw err; e.push('Classe ou parent introuvable.'); }
  }
  form(res, { title: 'Ajouter un élève', action: '/students', fields: fields(await options()), values: v, errors: e });
}));
router.get('/:id/edit', wrap(async (req, res) => {
  if (!isInt(req.params.id)) return res.redirect('/students');
  const s = (await pool.query('SELECT * FROM students WHERE id=$1', [req.params.id])).rows[0];
  if (!s) { req.flash('danger', 'Élève introuvable.'); return res.redirect('/students'); }
  form(res, { title: 'Modifier un élève', action: `/students/${s.id}/edit`, fields: fields(await options()), values: s, errors: [] });
}));
router.post('/:id/edit', wrap(async (req, res) => {
  if (!isInt(req.params.id)) return res.redirect('/students');
  const { v, e } = validate(req.body);
  if (!e.length) {
    try {
      const r = await pool.query('UPDATE students SET nom=$1, prenom=$2, date_naissance=$3, class_id=$4, parent_id=$5, annee_scolaire=$6 WHERE id=$7', [v.nom, v.prenom, v.date_naissance, v.class_id, v.parent_id, v.annee_scolaire, req.params.id]);
      req.flash(r.rowCount ? 'success' : 'danger', r.rowCount ? 'Dossier modifié.' : 'Élève introuvable.'); return res.redirect('/students');
    } catch (err) { if (err.code !== '23503') throw err; e.push('Classe ou parent introuvable.'); }
  }
  form(res, { title: 'Modifier un élève', action: `/students/${req.params.id}/edit`, fields: fields(await options()), values: v, errors: e });
}));
router.post('/:id/delete', wrap(async (req, res) => {
  if (!isInt(req.params.id)) return res.redirect('/students');
  try {
    const r = await pool.query('DELETE FROM students WHERE id=$1', [req.params.id]);
    req.flash(r.rowCount ? 'success' : 'danger', r.rowCount ? 'Élève supprimé (ses notes ont été supprimées avec lui).' : 'Élève introuvable.');
  } catch (err) {
    if (err.code !== '23503') throw err;
    req.flash('danger', "Suppression impossible : cet élève a des paiements enregistrés.");
  }
  res.redirect('/students');
}));
module.exports = router;
