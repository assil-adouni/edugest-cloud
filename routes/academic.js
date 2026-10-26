// Classes et matières (administrateur)
const router = require('express').Router();
const pool = require('../db');
const { requireRole } = require('../middleware/auth');
const { wrap, clean, isInt, isAnnee, toNum, ANNEE, NIVEAUX, money } = require('../lib/helpers');
const admin = requireRole('admin');

// ---------- Classes ----------
async function classFields() {
  const t = (await pool.query(`SELECT t.id, u.prenom, u.nom FROM teachers t JOIN users u ON u.id=t.user_id ORDER BY u.nom`)).rows.map((x) => ({ value: x.id, label: `${x.prenom} ${x.nom}` }));
  return [
    { name: 'niveau', label: 'Niveau', type: 'select', options: NIVEAUX.map((n) => ({ value: n, label: n })), required: true },
    { name: 'section', label: 'Section', required: true, maxlength: 10, placeholder: 'A' },
    { name: 'annee_scolaire', label: 'Année scolaire', required: true, maxlength: 9, placeholder: '2026-2027' },
    { name: 'teacher_id', label: 'Enseignant responsable', type: 'select', options: t },
    { name: 'frais_scolarite', label: 'Frais de scolarité (TND)', type: 'number', required: true, min: 0, step: '0.01' },
  ];
}
function validateClass(b) {
  const v = { niveau: clean(b.niveau), section: clean(b.section).toUpperCase(), annee_scolaire: clean(b.annee_scolaire), teacher_id: clean(b.teacher_id), frais_scolarite: clean(b.frais_scolarite) };
  const e = [];
  if (!NIVEAUX.includes(v.niveau)) e.push('Niveau invalide.');
  if (!v.section || v.section.length > 10) e.push('La section est obligatoire (10 caractères max).');
  if (!isAnnee(v.annee_scolaire)) e.push("L'année scolaire doit ressembler à 2026-2027.");
  if (v.teacher_id && !isInt(v.teacher_id)) e.push('Enseignant invalide.');
  const f = toNum(v.frais_scolarite);
  if (v.frais_scolarite === '' || isNaN(f) || f < 0 || f > 99999999) e.push('Les frais doivent être un nombre positif.');
  return { v, e };
}
const classForm = async (res, o) => res.render('crud-form', { cancelUrl: '/classes', fields: await classFields(), ...o });

router.get('/classes', admin, wrap(async (req, res) => {
  const rows = (await pool.query(`SELECT c.*, u.prenom || ' ' || u.nom AS enseignant, (SELECT COUNT(*)::int FROM students s WHERE s.class_id=c.id) AS nb
    FROM classes c LEFT JOIN teachers t ON t.id=c.teacher_id LEFT JOIN users u ON u.id=t.user_id ORDER BY c.annee_scolaire DESC, c.niveau, c.section`)).rows;
  res.render('crud-list', { title: 'Classes', addUrl: '/classes/new', addLabel: 'Créer une classe',
    columns: [{ label: 'Niveau', key: 'niveau' }, { label: 'Section', key: 'section' }, { label: 'Année', key: 'annee_scolaire' }, { label: 'Enseignant', key: 'enseignant' },
      { label: 'Élèves', key: 'nb' }, { label: 'Frais', key: 'frais_scolarite', fmt: money }],
    rows, editUrl: (r) => `/classes/${r.id}/edit`, deleteUrl: (r) => `/classes/${r.id}/delete`, deleteMsg: (r) => `Supprimer la classe ${r.niveau} ${r.section} ?` });
}));
router.get('/classes/new', admin, wrap((req, res) => classForm(res, { title: 'Créer une classe', action: '/classes', values: { annee_scolaire: ANNEE, frais_scolarite: 0 }, errors: [] })));
router.post('/classes', admin, wrap(async (req, res) => {
  const { v, e } = validateClass(req.body);
  if (!e.length) {
    try {
      await pool.query('INSERT INTO classes (niveau,section,annee_scolaire,teacher_id,frais_scolarite) VALUES ($1,$2,$3,$4,$5)', [v.niveau, v.section, v.annee_scolaire, v.teacher_id || null, toNum(v.frais_scolarite)]);
      req.flash('success', 'Classe créée.'); return res.redirect('/classes');
    } catch (err) { if (err.code === '23505') e.push('Cette classe existe déjà pour cette année scolaire.'); else if (err.code === '23503') e.push('Enseignant introuvable.'); else throw err; }
  }
  classForm(res, { title: 'Créer une classe', action: '/classes', values: v, errors: e });
}));
router.get('/classes/:id/edit', admin, wrap(async (req, res) => {
  const c = isInt(req.params.id) && (await pool.query('SELECT * FROM classes WHERE id=$1', [req.params.id])).rows[0];
  if (!c) { req.flash('danger', 'Classe introuvable.'); return res.redirect('/classes'); }
  classForm(res, { title: 'Modifier une classe', action: `/classes/${c.id}/edit`, values: c, errors: [] });
}));
router.post('/classes/:id/edit', admin, wrap(async (req, res) => {
  if (!isInt(req.params.id)) return res.redirect('/classes');
  const { v, e } = validateClass(req.body);
  if (!e.length) {
    try {
      await pool.query('UPDATE classes SET niveau=$1, section=$2, annee_scolaire=$3, teacher_id=$4, frais_scolarite=$5 WHERE id=$6', [v.niveau, v.section, v.annee_scolaire, v.teacher_id || null, toNum(v.frais_scolarite), req.params.id]);
      req.flash('success', 'Classe modifiée.'); return res.redirect('/classes');
    } catch (err) { if (err.code === '23505') e.push('Cette classe existe déjà pour cette année scolaire.'); else if (err.code === '23503') e.push('Enseignant introuvable.'); else throw err; }
  }
  classForm(res, { title: 'Modifier une classe', action: `/classes/${req.params.id}/edit`, values: v, errors: e });
}));
router.post('/classes/:id/delete', admin, wrap(async (req, res) => {
  if (!isInt(req.params.id)) return res.redirect('/classes');
  try { await pool.query('DELETE FROM classes WHERE id=$1', [req.params.id]); req.flash('success', 'Classe supprimée.'); }
  catch (err) { if (err.code !== '23503') throw err; req.flash('danger', 'Suppression impossible : la classe contient des élèves ou des devoirs.'); }
  res.redirect('/classes');
}));

// ---------- Matières ----------
const subjectFields = [
  { name: 'nom', label: 'Nom de la matière', required: true, maxlength: 100 },
  { name: 'coefficient', label: 'Coefficient', type: 'number', required: true, min: 0.5, max: 10, step: '0.5' },
];
function validateSubject(b) {
  const v = { nom: clean(b.nom), coefficient: clean(b.coefficient) }; const e = []; const c = toNum(v.coefficient);
  if (!v.nom || v.nom.length > 100) e.push('Le nom est obligatoire (100 caractères max).');
  if (v.coefficient === '' || isNaN(c) || c <= 0 || c > 10) e.push('Le coefficient doit être compris entre 0,5 et 10.');
  return { v, e };
}
const subjForm = (res, o) => res.render('crud-form', { cancelUrl: '/subjects', fields: subjectFields, ...o });

router.get('/subjects', admin, wrap(async (req, res) => {
  const rows = (await pool.query('SELECT s.*, (SELECT COUNT(*)::int FROM grades g WHERE g.subject_id=s.id) AS nb_notes FROM subjects s ORDER BY s.nom')).rows;
  res.render('crud-list', { title: 'Matières', addUrl: '/subjects/new', addLabel: 'Ajouter une matière',
    columns: [{ label: 'Matière', key: 'nom' }, { label: 'Coefficient', key: 'coefficient' }, { label: 'Notes saisies', key: 'nb_notes' }],
    rows, editUrl: (r) => `/subjects/${r.id}/edit`, deleteUrl: (r) => `/subjects/${r.id}/delete`, deleteMsg: (r) => `Supprimer la matière ${r.nom} ?` });
}));
router.get('/subjects/new', admin, (req, res) => subjForm(res, { title: 'Ajouter une matière', action: '/subjects', values: { coefficient: 1 }, errors: [] }));
router.post('/subjects', admin, wrap(async (req, res) => {
  const { v, e } = validateSubject(req.body);
  if (!e.length) {
    try { await pool.query('INSERT INTO subjects (nom,coefficient) VALUES ($1,$2)', [v.nom, toNum(v.coefficient)]); req.flash('success', 'Matière ajoutée.'); return res.redirect('/subjects'); }
    catch (err) { if (err.code !== '23505') throw err; e.push('Cette matière existe déjà.'); }
  }
  subjForm(res, { title: 'Ajouter une matière', action: '/subjects', values: v, errors: e });
}));
router.get('/subjects/:id/edit', admin, wrap(async (req, res) => {
  const s = isInt(req.params.id) && (await pool.query('SELECT * FROM subjects WHERE id=$1', [req.params.id])).rows[0];
  if (!s) { req.flash('danger', 'Matière introuvable.'); return res.redirect('/subjects'); }
  subjForm(res, { title: 'Modifier une matière', action: `/subjects/${s.id}/edit`, values: s, errors: [] });
}));
router.post('/subjects/:id/edit', admin, wrap(async (req, res) => {
  if (!isInt(req.params.id)) return res.redirect('/subjects');
  const { v, e } = validateSubject(req.body);
  if (!e.length) {
    try { await pool.query('UPDATE subjects SET nom=$1, coefficient=$2 WHERE id=$3', [v.nom, toNum(v.coefficient), req.params.id]); req.flash('success', 'Matière modifiée (les moyennes sont recalculées automatiquement).'); return res.redirect('/subjects'); }
    catch (err) { if (err.code !== '23505') throw err; e.push('Cette matière existe déjà.'); }
  }
  subjForm(res, { title: 'Modifier une matière', action: `/subjects/${req.params.id}/edit`, values: v, errors: e });
}));
router.post('/subjects/:id/delete', admin, wrap(async (req, res) => {
  if (!isInt(req.params.id)) return res.redirect('/subjects');
  try { await pool.query('DELETE FROM subjects WHERE id=$1', [req.params.id]); req.flash('success', 'Matière supprimée.'); }
  catch (err) { if (err.code !== '23503') throw err; req.flash('danger', 'Suppression impossible : des notes ou des devoirs utilisent cette matière.'); }
  res.redirect('/subjects');
}));
module.exports = router;
