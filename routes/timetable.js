const router = require('express').Router();
const pool = require('../db');
const { requireRole } = require('../middleware/auth');
const { wrap, clean, isInt, isTime, ANNEE, JOURS } = require('../lib/helpers');
const { getTeacherId } = require('../lib/queries');
router.use(requireRole('admin', 'enseignant', 'parent', 'eleve'));

async function allowedClasses(u) {
  const base = `SELECT c.id, c.niveau || ' ' || c.section AS nom, c.teacher_id, c.room_id FROM classes c`;
  if (u.role === 'admin') return (await pool.query(`${base} WHERE c.annee_scolaire=$1 ORDER BY c.niveau, c.section`, [ANNEE])).rows;
  if (u.role === 'enseignant') return (await pool.query(`${base} WHERE c.teacher_id=$1 ORDER BY c.niveau, c.section`, [await getTeacherId(u.id)])).rows;
  if (u.role === 'parent') return (await pool.query(`${base} WHERE c.id IN (SELECT s.class_id FROM students s JOIN parents p ON p.id=s.parent_id WHERE p.user_id=$1) ORDER BY c.niveau`, [u.id])).rows;
  return (await pool.query(`${base} WHERE c.id IN (SELECT class_id FROM students WHERE user_id=$1)`, [u.id])).rows;
}
async function page(req, res, extra = {}) {
  const u = req.session.user; const classes = await allowedClasses(u);
  const wanted = clean(req.query.class_id || extra.classId || '');
  const cls = classes.find((c) => String(c.id) === wanted) || classes[0] || null;
  let slots = [], subjects = [], rooms = [];
  if (cls) {
    slots = (await pool.query(`SELECT t.*, sub.nom AS matiere, r.nom AS salle, u.prenom || ' ' || u.nom AS enseignant
      FROM timetable t JOIN subjects sub ON sub.id=t.subject_id LEFT JOIN rooms r ON r.id=t.room_id
      LEFT JOIN teachers te ON te.id=t.teacher_id LEFT JOIN users u ON u.id=te.user_id WHERE t.class_id=$1 ORDER BY t.jour, t.heure_debut`, [cls.id])).rows;
    if (u.role === 'admin') {
      subjects = (await pool.query('SELECT id, nom FROM subjects ORDER BY nom')).rows;
      rooms = (await pool.query('SELECT id, nom, capacite FROM rooms ORDER BY nom')).rows;
    }
  }
  res.status(extra.errors && extra.errors.length ? 400 : 200).render('timetable', { title: 'Emploi du temps', classes, cls, slots, subjects, rooms, JOURS, canEdit: u.role === 'admin', errors: [], v: {}, ...extra });
}
router.get('/', wrap((req, res) => page(req, res)));

router.post('/', requireRole('admin'), wrap(async (req, res) => {
  const b = req.body; const v = { class_id: clean(b.class_id), subject_id: clean(b.subject_id), room_id: clean(b.room_id), jour: clean(b.jour), heure_debut: clean(b.heure_debut), heure_fin: clean(b.heure_fin) };
  const e = []; const cls = isInt(v.class_id) ? (await pool.query('SELECT id, teacher_id, room_id FROM classes WHERE id=$1', [v.class_id])).rows[0] : null;
  if (!cls) e.push('Classe introuvable.');
  if (!isInt(v.subject_id)) e.push('Choisissez une matière.');
  if (!/^[1-6]$/.test(v.jour)) e.push('Choisissez un jour.');
  if (!isTime(v.heure_debut) || !isTime(v.heure_fin)) e.push('Heures invalides (format HH:MM).');
  else if (v.heure_fin <= v.heure_debut) e.push("L'heure de fin doit être après l'heure de début.");
  if (v.room_id && !isInt(v.room_id)) e.push('Salle invalide.');
  if (!e.length) {
    const room = v.room_id || cls.room_id || null;
    const c = (await pool.query(`SELECT BOOL_OR(t.class_id=$4) AS c, BOOL_OR($5::int IS NOT NULL AND t.room_id=$5) AS r, BOOL_OR($6::int IS NOT NULL AND t.teacher_id=$6) AS e
      FROM timetable t WHERE t.jour=$1 AND t.heure_debut < $3::time AND t.heure_fin > $2::time AND (t.class_id=$4 OR ($5::int IS NOT NULL AND t.room_id=$5) OR ($6::int IS NOT NULL AND t.teacher_id=$6))`,
      [v.jour, v.heure_debut, v.heure_fin, cls.id, room, cls.teacher_id])).rows[0];
    if (c.c) e.push('Conflit : cette classe a déjà un cours sur ce créneau.');
    if (c.r) e.push('Conflit : cette salle est déjà occupée sur ce créneau.');
    if (c.e) e.push("Conflit : l'enseignant a déjà un cours sur ce créneau.");
    if (!e.length) {
      try {
        await pool.query('INSERT INTO timetable (class_id,subject_id,teacher_id,room_id,jour,heure_debut,heure_fin) VALUES ($1,$2,$3,$4,$5,$6,$7)', [cls.id, v.subject_id, cls.teacher_id, room, v.jour, v.heure_debut, v.heure_fin]);
        req.flash('success', 'Cours ajouté à l\'emploi du temps.'); return res.redirect(`/timetable?class_id=${cls.id}`);
      } catch (err) { if (err.code !== '23503') throw err; e.push('Matière ou salle introuvable.'); }
    }
  }
  req.query.class_id = v.class_id; await page(req, res, { errors: e, v });
}));
router.post('/:id/delete', requireRole('admin'), wrap(async (req, res) => {
  const cid = isInt(req.params.id) ? (await pool.query('DELETE FROM timetable WHERE id=$1 RETURNING class_id', [req.params.id])).rows[0] : null;
  req.flash(cid ? 'success' : 'danger', cid ? 'Cours supprimé.' : 'Cours introuvable.');
  res.redirect(cid ? `/timetable?class_id=${cid.class_id}` : '/timetable');
}));
module.exports = router;
