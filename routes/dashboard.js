const router = require('express').Router();
const pool = require('../db');
const { wrap, ANNEE } = require('../lib/helpers');
const { BALANCES, studentReport, getTeacherId, getParentId } = require('../lib/queries');

router.get('/', wrap(async (req, res) => {
  const u = req.session.user; const d = {};
  d.announcements = (await pool.query(`SELECT a.*, u.prenom || ' ' || u.nom AS auteur FROM announcements a LEFT JOIN users u ON u.id = a.author_id ORDER BY a.created_at DESC LIMIT 3`)).rows;
  if (u.role === 'admin' || u.role === 'comptable') {
    d.stats = (await pool.query(`SELECT
      (SELECT COUNT(*)::int FROM students WHERE annee_scolaire=$1) AS eleves,
      (SELECT COUNT(*)::int FROM classes WHERE annee_scolaire=$1) AS classes,
      (SELECT COUNT(*)::int FROM teachers) AS enseignants,
      (SELECT COALESCE(SUM(montant),0) FROM payments WHERE statut='paye' AND annee_scolaire=$1) AS total_paye,
      (SELECT COALESCE(SUM(montant),0) FROM payments WHERE statut='en_attente' AND annee_scolaire=$1) AS total_attente,
      (SELECT COUNT(*)::int FROM payments WHERE statut='en_attente' AND annee_scolaire=$1) AS nb_attente`, [ANNEE])).rows[0];
    d.solde = (await pool.query(`SELECT COALESCE(SUM(solde),0) AS solde FROM (${BALANCES}) b`, [ANNEE])).rows[0].solde;
  }
  if (u.role === 'admin') {
    d.activities = (await pool.query(`
      (SELECT 'Paiement' AS type, s.prenom || ' ' || s.nom || ' : ' || p.montant || ' TND (' || CASE p.statut WHEN 'paye' THEN 'payé' ELSE 'en attente' END || ')' AS texte, p.created_at AS date FROM payments p JOIN students s ON s.id = p.student_id)
      UNION ALL (SELECT 'Note', s.prenom || ' ' || s.nom || ' : ' || g.valeur || '/20 en ' || sub.nom, g.updated_at FROM grades g JOIN students s ON s.id = g.student_id JOIN subjects sub ON sub.id = g.subject_id)
      UNION ALL (SELECT 'Devoir', h.titre || ' (' || c.niveau || ' ' || c.section || ')', h.created_at FROM homework h JOIN classes c ON c.id = h.class_id)
      UNION ALL (SELECT 'Élève', 'Inscription de ' || s.prenom || ' ' || s.nom, s.created_at FROM students s)
      ORDER BY date DESC LIMIT 8`)).rows;
  }
  if (u.role === 'enseignant') {
    const tid = await getTeacherId(u.id);
    d.classes = (await pool.query(`SELECT c.id, c.niveau || ' ' || c.section AS nom, (SELECT COUNT(*)::int FROM students s WHERE s.class_id = c.id) AS nb FROM classes c WHERE c.teacher_id=$1 AND c.annee_scolaire=$2 ORDER BY c.niveau`, [tid, ANNEE])).rows;
    d.homework = (await pool.query(`SELECT h.*, c.niveau || ' ' || c.section AS classe, sub.nom AS matiere FROM homework h JOIN classes c ON c.id=h.class_id JOIN subjects sub ON sub.id=h.subject_id WHERE c.teacher_id=$1 AND h.date_limite >= CURRENT_DATE ORDER BY h.date_limite LIMIT 5`, [tid])).rows;
  }
  if (u.role === 'parent') {
    const pid = await getParentId(u.id);
    const kids = (await pool.query(`SELECT s.id, s.prenom, s.nom, c.niveau || ' ' || c.section AS classe, c.id AS class_id FROM students s JOIN classes c ON c.id=s.class_id WHERE s.parent_id=$1 AND s.annee_scolaire=$2`, [pid, ANNEE])).rows;
    for (const k of kids) {
      k.generale = (await studentReport(k.id, ANNEE)).generale;
      k.solde = ((await pool.query(`${BALANCES} AND s.id=$2`, [ANNEE, k.id])).rows[0] || {}).solde || 0;
    }
    d.kids = kids;
    d.notifications = (await pool.query('SELECT * FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 5', [u.id])).rows;
    d.homework = (await pool.query(`SELECT h.*, c.niveau || ' ' || c.section AS classe, sub.nom AS matiere FROM homework h JOIN classes c ON c.id=h.class_id JOIN subjects sub ON sub.id=h.subject_id WHERE h.class_id IN (SELECT class_id FROM students WHERE parent_id=$1) AND h.date_limite >= CURRENT_DATE ORDER BY h.date_limite LIMIT 5`, [pid])).rows;
  }
  if (u.role === 'comptable') {
    d.payments = (await pool.query(`SELECT p.*, s.prenom, s.nom FROM payments p JOIN students s ON s.id=p.student_id ORDER BY p.created_at DESC LIMIT 6`)).rows;
  }
  res.render('dashboard', { title: 'Tableau de bord', d });
}));
module.exports = router;
