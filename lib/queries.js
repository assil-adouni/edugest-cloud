const pool = require('../db');
const { round2 } = require('./helpers');

// Soldes par élève pour l'année $1 (frais de la classe - paiements validés)
const BALANCES = `SELECT s.id, s.nom, s.prenom, s.parent_id, c.niveau || ' ' || c.section AS classe,
  c.frais_scolarite AS frais, COALESCE(p.paye, 0) AS paye,
  GREATEST(c.frais_scolarite - COALESCE(p.paye, 0), 0) AS solde
FROM students s JOIN classes c ON c.id = s.class_id
LEFT JOIN (SELECT student_id, annee_scolaire, SUM(montant) AS paye FROM payments
           WHERE statut = 'paye' GROUP BY student_id, annee_scolaire) p
  ON p.student_id = s.id AND p.annee_scolaire = s.annee_scolaire
WHERE s.annee_scolaire = $1`;

// Bulletin : moyenne pondérée par les coefficients, par trimestre puis générale
async function studentReport(studentId, annee) {
  const { rows } = await pool.query(
    `SELECT g.trimestre, g.valeur, sub.nom AS matiere, sub.coefficient
     FROM grades g JOIN subjects sub ON sub.id = g.subject_id
     WHERE g.student_id = $1 AND g.annee_scolaire = $2 ORDER BY g.trimestre, sub.nom`, [studentId, annee]);
  const t = { 1: { notes: [], s: 0, c: 0 }, 2: { notes: [], s: 0, c: 0 }, 3: { notes: [], s: 0, c: 0 } };
  for (const r of rows) { const x = t[r.trimestre]; x.notes.push(r); x.s += r.valeur * r.coefficient; x.c += r.coefficient; }
  const moys = [];
  for (const k of [1, 2, 3]) { t[k].moyenne = t[k].c ? round2(t[k].s / t[k].c) : null; if (t[k].moyenne !== null) moys.push(t[k].moyenne); }
  return { trimestres: t, generale: moys.length ? round2(moys.reduce((a, b) => a + b, 0) / moys.length) : null };
}

const getTeacherId = async (userId) => (await pool.query('SELECT id FROM teachers WHERE user_id=$1', [userId])).rows[0]?.id || null;
const getParentId = async (userId) => (await pool.query('SELECT id FROM parents WHERE user_id=$1', [userId])).rows[0]?.id || null;

async function notifyParentOfStudent(db, studentId, message) {
  await db.query(`INSERT INTO notifications (user_id, message)
    SELECT p.user_id, $2 FROM students s JOIN parents p ON p.id = s.parent_id WHERE s.id = $1`, [studentId, message]);
}
// La salle de la classe est-elle pleine ? (renvoie un message d'erreur ou null)
async function classFull(classId, excludeStudentId) {
  const r = (await pool.query(`SELECT r.nom, r.capacite, (SELECT COUNT(*)::int FROM students s WHERE s.class_id = c.id AND ($2::int IS NULL OR s.id <> $2)) AS nb
    FROM classes c LEFT JOIN rooms r ON r.id = c.room_id WHERE c.id = $1`, [classId, excludeStudentId || null])).rows[0];
  if (r && r.capacite && r.nb >= r.capacite) return `La salle ${r.nom} est pleine (capacité : ${r.capacite} élèves). Choisissez une autre classe ou augmentez la capacité.`;
  return null;
}
// L'utilisateur peut-il voir les devoirs / fichiers de cette classe ?
async function canSeeClass(user, classId) {
  const q = {
    enseignant: 'SELECT 1 FROM classes c JOIN teachers t ON t.id = c.teacher_id WHERE c.id = $1 AND t.user_id = $2',
    parent: 'SELECT 1 FROM students s JOIN parents p ON p.id = s.parent_id WHERE s.class_id = $1 AND p.user_id = $2',
    eleve: 'SELECT 1 FROM students WHERE class_id = $1 AND user_id = $2',
  };
  if (user.role === 'admin') return true;
  if (!q[user.role]) return false;
  return (await pool.query(q[user.role], [classId, user.id])).rowCount > 0;
}
module.exports = { classFull, canSeeClass, BALANCES, studentReport, getTeacherId, getParentId, notifyParentOfStudent };
