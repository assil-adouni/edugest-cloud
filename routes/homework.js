const router = require('express').Router();
const pool = require('../db');
const { requireRole } = require('../middleware/auth');
const { wrap, clean, isInt, isDate, ANNEE } = require('../lib/helpers');
const { getTeacherId, getParentId } = require('../lib/queries');
router.use(requireRole('admin', 'enseignant', 'parent'));

const BASE = `SELECT h.*, c.niveau || ' ' || c.section AS classe, sub.nom AS matiere, u.prenom || ' ' || u.nom AS enseignant
  FROM homework h JOIN classes c ON c.id=h.class_id JOIN subjects sub ON sub.id=h.subject_id
  LEFT JOIN teachers t ON t.id=h.teacher_id LEFT JOIN users u ON u.id=t.user_id`;

async function page(req, res, extra = {}) {
  const u = req.session.user; let rows; let classes = [];
  if (u.role === 'admin') rows = (await pool.query(`${BASE} ORDER BY h.date_limite DESC`)).rows;
  else if (u.role === 'enseignant') {
    const tid = await getTeacherId(u.id);
    rows = (await pool.query(`${BASE} WHERE c.teacher_id=$1 ORDER BY h.date_limite DESC`, [tid])).rows;
    classes = (await pool.query(`SELECT id, niveau || ' ' || section AS nom FROM classes WHERE teacher_id=$1 AND annee_scolaire=$2`, [tid, ANNEE])).rows;
  } else {
    const pid = await getParentId(u.id);
    rows = (await pool.query(`${BASE} WHERE h.class_id IN (SELECT class_id FROM students WHERE parent_id=$1) ORDER BY h.date_limite DESC`, [pid])).rows;
  }
  const subjects = (await pool.query('SELECT id, nom FROM subjects ORDER BY nom')).rows;
  res.render('homework', { title: 'Devoirs', rows, classes, subjects, errors: [], v: {}, ...extra });
}
router.get('/', wrap((req, res) => page(req, res)));

router.post('/', requireRole('enseignant'), wrap(async (req, res) => {
  const b = req.body; const v = { class_id: clean(b.class_id), subject_id: clean(b.subject_id), titre: clean(b.titre), description: clean(b.description), date_limite: clean(b.date_limite) };
  const e = []; const tid = await getTeacherId(req.session.user.id);
  if (!isInt(v.class_id) || !(await pool.query('SELECT 1 FROM classes WHERE id=$1 AND teacher_id=$2', [v.class_id, tid])).rowCount) e.push("Choisissez l'une de vos classes.");
  if (!isInt(v.subject_id)) e.push('Choisissez une matière.');
  if (!v.titre || v.titre.length > 150) e.push('Le titre est obligatoire (150 caractères max).');
  if (!v.description || v.description.length > 3000) e.push('La description est obligatoire (3000 caractères max).');
  if (!isDate(v.date_limite)) e.push('La date limite est invalide.');
  if (e.length) return res.status(400), page(req, res, { errors: e, v });
  try {
    await pool.query('INSERT INTO homework (class_id,subject_id,teacher_id,titre,description,date_limite,annee_scolaire) VALUES ($1,$2,$3,$4,$5,$6,$7)', [v.class_id, v.subject_id, tid, v.titre, v.description, v.date_limite, ANNEE]);
  } catch (err) { if (err.code !== '23503') throw err; return page(req, res, { errors: ['Matière introuvable.'], v }); }
  req.flash('success', 'Devoir publié.'); res.redirect('/homework');
}));

router.post('/:id/delete', requireRole('enseignant', 'admin'), wrap(async (req, res) => {
  if (!isInt(req.params.id)) return res.redirect('/homework');
  const u = req.session.user; let r;
  if (u.role === 'admin') r = await pool.query('DELETE FROM homework WHERE id=$1', [req.params.id]);
  else r = await pool.query('DELETE FROM homework WHERE id=$1 AND class_id IN (SELECT id FROM classes WHERE teacher_id=$2)', [req.params.id, await getTeacherId(u.id)]);
  req.flash(r.rowCount ? 'success' : 'danger', r.rowCount ? 'Devoir supprimé.' : 'Suppression non autorisée.');
  res.redirect('/homework');
}));
module.exports = router;
