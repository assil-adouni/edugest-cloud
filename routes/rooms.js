const router = require('express').Router();
const pool = require('../db');
const { requireRole } = require('../middleware/auth');
const { wrap, clean, isInt } = require('../lib/helpers');
router.use(requireRole('admin'));

const fields = [
  { name: 'nom', label: 'Nom de la salle', required: true, maxlength: 60, placeholder: 'Salle 4' },
  { name: 'capacite', label: 'Capacité maximale (nombre d\'élèves)', type: 'number', required: true, min: 1, max: 200, step: '1' },
];
function validate(b) {
  const v = { nom: clean(b.nom), capacite: clean(b.capacite) }; const e = [];
  if (!v.nom || v.nom.length > 60) e.push('Le nom est obligatoire (60 caractères max).');
  if (!/^\d+$/.test(v.capacite) || Number(v.capacite) < 1 || Number(v.capacite) > 200) e.push('La capacité doit être un entier entre 1 et 200.');
  return { v, e };
}
const form = (res, o) => res.render('crud-form', { cancelUrl: '/rooms', fields, ...o });

router.get('/', wrap(async (req, res) => {
  const rows = (await pool.query(`SELECT r.*, (SELECT string_agg(c.niveau || ' ' || c.section, ', ') FROM classes c WHERE c.room_id = r.id) AS classes,
    (SELECT COALESCE(SUM((SELECT COUNT(*) FROM students s WHERE s.class_id = c.id)), 0)::int FROM classes c WHERE c.room_id = r.id) AS eleves
    FROM rooms r ORDER BY r.nom`)).rows;
  res.render('crud-list', { title: 'Salles', addUrl: '/rooms/new', addLabel: 'Ajouter une salle',
    columns: [{ label: 'Salle', key: 'nom' }, { label: 'Capacité', key: 'capacite' }, { label: 'Classe(s) affectée(s)', key: 'classes', fmt: (v) => v || '—' }, { label: 'Élèves', key: 'eleves' }],
    rows, editUrl: (r) => `/rooms/${r.id}/edit`, deleteUrl: (r) => `/rooms/${r.id}/delete`, deleteMsg: (r) => `Supprimer ${r.nom} ?` });
}));
router.get('/new', (req, res) => form(res, { title: 'Ajouter une salle', action: '/rooms', values: { capacite: 25 }, errors: [] }));
router.post('/', wrap(async (req, res) => {
  const { v, e } = validate(req.body);
  if (!e.length) {
    try { await pool.query('INSERT INTO rooms (nom,capacite) VALUES ($1,$2)', [v.nom, v.capacite]); req.flash('success', 'Salle ajoutée.'); return res.redirect('/rooms'); }
    catch (err) { if (err.code !== '23505') throw err; e.push('Une salle porte déjà ce nom.'); }
  }
  form(res, { title: 'Ajouter une salle', action: '/rooms', values: v, errors: e });
}));
router.get('/:id/edit', wrap(async (req, res) => {
  const r = isInt(req.params.id) && (await pool.query('SELECT * FROM rooms WHERE id=$1', [req.params.id])).rows[0];
  if (!r) { req.flash('danger', 'Salle introuvable.'); return res.redirect('/rooms'); }
  form(res, { title: 'Modifier une salle', action: `/rooms/${r.id}/edit`, values: r, errors: [] });
}));
router.post('/:id/edit', wrap(async (req, res) => {
  if (!isInt(req.params.id)) return res.redirect('/rooms');
  const { v, e } = validate(req.body);
  if (!e.length) {
    const max = (await pool.query('SELECT COALESCE(MAX((SELECT COUNT(*) FROM students s WHERE s.class_id = c.id)), 0)::int AS m FROM classes c WHERE c.room_id = $1', [req.params.id])).rows[0].m;
    if (Number(v.capacite) < max) e.push(`Capacité trop faible : une classe de cette salle compte déjà ${max} élèves.`);
  }
  if (!e.length) {
    try { await pool.query('UPDATE rooms SET nom=$1, capacite=$2 WHERE id=$3', [v.nom, v.capacite, req.params.id]); req.flash('success', 'Salle modifiée.'); return res.redirect('/rooms'); }
    catch (err) { if (err.code !== '23505') throw err; e.push('Une salle porte déjà ce nom.'); }
  }
  form(res, { title: 'Modifier une salle', action: `/rooms/${req.params.id}/edit`, values: v, errors: e });
}));
router.post('/:id/delete', wrap(async (req, res) => {
  if (!isInt(req.params.id)) return res.redirect('/rooms');
  try { await pool.query('DELETE FROM rooms WHERE id=$1', [req.params.id]); req.flash('success', 'Salle supprimée.'); }
  catch (err) { if (err.code !== '23503') throw err; req.flash('danger', 'Suppression impossible : cette salle est utilisée par une classe ou un emploi du temps.'); }
  res.redirect('/rooms');
}));
module.exports = router;
