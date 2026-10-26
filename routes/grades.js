// Saisie des notes (enseignant), consultation (admin) et bulletins avec moyennes pondérées
const router = require('express').Router();
const pool = require('../db');
const { requireRole } = require('../middleware/auth');
const { wrap, isInt, toNum, ANNEE } = require('../lib/helpers');
const { studentReport, getTeacherId, getParentId } = require('../lib/queries');

async function myClasses(user) {
  if (user.role === 'admin') return (await pool.query(`SELECT id, niveau || ' ' || section AS nom FROM classes WHERE annee_scolaire=$1 ORDER BY niveau, section`, [ANNEE])).rows;
  const tid = await getTeacherId(user.id);
  return (await pool.query(`SELECT id, niveau || ' ' || section AS nom FROM classes WHERE teacher_id=$1 AND annee_scolaire=$2 ORDER BY niveau, section`, [tid, ANNEE])).rows;
}

router.get('/grades', requireRole('enseignant', 'admin'), wrap(async (req, res) => {
  const classes = await myClasses(req.session.user);
  const subjects = (await pool.query('SELECT id, nom, coefficient FROM subjects ORDER BY nom')).rows;
  const q = { class_id: req.query.class_id || '', subject_id: req.query.subject_id || '', trimestre: ['1', '2', '3'].includes(req.query.trimestre) ? req.query.trimestre : '1' };
  let students = null;
  if (isInt(q.class_id) && isInt(q.subject_id) && classes.some((c) => String(c.id) === q.class_id)) {
    students = (await pool.query(`SELECT s.id, s.nom, s.prenom, g.valeur,
      (SELECT ROUND(SUM(g2.valeur * sub.coefficient) / NULLIF(SUM(sub.coefficient), 0), 2) FROM grades g2 JOIN subjects sub ON sub.id = g2.subject_id
        WHERE g2.student_id = s.id AND g2.trimestre = $3 AND g2.annee_scolaire = $4) AS moyenne
      FROM students s LEFT JOIN grades g ON g.student_id = s.id AND g.subject_id = $2 AND g.trimestre = $3 AND g.annee_scolaire = $4
      WHERE s.class_id = $1 ORDER BY s.nom, s.prenom`, [q.class_id, q.subject_id, q.trimestre, ANNEE])).rows;
  }
  res.render('grades', { title: 'Notes', classes, subjects, q, students, canEdit: req.session.user.role === 'enseignant' });
}));

router.post('/grades', requireRole('enseignant'), wrap(async (req, res) => {
  const { class_id, subject_id, trimestre } = req.body;
  const back = `/grades?class_id=${encodeURIComponent(class_id || '')}&subject_id=${encodeURIComponent(subject_id || '')}&trimestre=${encodeURIComponent(trimestre || '1')}`;
  if (!isInt(class_id) || !isInt(subject_id) || !['1', '2', '3'].includes(trimestre)) { req.flash('danger', 'Sélection invalide.'); return res.redirect('/grades'); }
  const tid = await getTeacherId(req.session.user.id);
  const own = await pool.query('SELECT 1 FROM classes WHERE id=$1 AND teacher_id=$2', [class_id, tid]);
  if (!own.rowCount) { req.flash('danger', "Cette classe ne vous est pas affectée."); return res.redirect('/grades'); }
  const ids = new Set((await pool.query('SELECT id FROM students WHERE class_id=$1', [class_id])).rows.map((r) => String(r.id)));
  const toSave = []; const errors = [];
  for (const [k, raw] of Object.entries(req.body)) {
    if (!k.startsWith('note_')) continue;
    const sid = k.slice(5); if (!ids.has(sid)) continue;
    const txt = String(raw).trim();
    if (txt === '') { toSave.push([sid, null]); continue; }
    const n = toNum(txt);
    if (isNaN(n) || n < 0 || n > 20) { errors.push(`Note invalide : « ${txt.slice(0, 10)} » (0 à 20).`); continue; }
    toSave.push([sid, Math.round(n * 100) / 100]);
  }
  if (errors.length) { req.flash('danger', errors[0] + ' Aucune note enregistrée.'); return res.redirect(back); }
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    for (const [sid, val] of toSave) {
      if (val === null) await c.query('DELETE FROM grades WHERE student_id=$1 AND subject_id=$2 AND trimestre=$3 AND annee_scolaire=$4', [sid, subject_id, trimestre, ANNEE]);
      else await c.query(`INSERT INTO grades (student_id, subject_id, teacher_id, valeur, trimestre, annee_scolaire) VALUES ($1,$2,$3,$4,$5,$6)
        ON CONFLICT (student_id, subject_id, trimestre, annee_scolaire) DO UPDATE SET valeur = EXCLUDED.valeur, teacher_id = EXCLUDED.teacher_id, updated_at = NOW()`, [sid, subject_id, tid, val, trimestre, ANNEE]);
    }
    await c.query('COMMIT');
  } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
  req.flash('success', 'Notes enregistrées. Les moyennes ont été recalculées.');
  res.redirect(back);
}));

router.get('/bulletin/:id', requireRole('admin', 'enseignant', 'parent'), wrap(async (req, res) => {
  const denied = () => res.status(403).render('error', { title: 'Accès refusé', message: "Vous n'avez pas accès à ce bulletin." });
  if (!isInt(req.params.id)) return denied();
  const s = (await pool.query(`SELECT s.*, c.niveau || ' ' || c.section AS classe, c.teacher_id, p.user_id AS parent_user_id, u.prenom || ' ' || u.nom AS parent
    FROM students s JOIN classes c ON c.id = s.class_id JOIN parents p ON p.id = s.parent_id JOIN users u ON u.id = p.user_id WHERE s.id = $1`, [req.params.id])).rows[0];
  if (!s) return denied();
  const u = req.session.user;
  if (u.role === 'enseignant' && s.teacher_id !== await getTeacherId(u.id)) return denied();
  if (u.role === 'parent' && s.parent_user_id !== u.id) return denied();
  res.render('bulletin', { title: `Bulletin de ${s.prenom} ${s.nom}`, s, report: await studentReport(s.id, s.annee_scolaire) });
}));
module.exports = router;
