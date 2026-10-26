// Notifications (tous) et espace "Mes enfants" (parent)
const router = require('express').Router();
const pool = require('../db');
const { requireLogin, requireRole } = require('../middleware/auth');
const { wrap, ANNEE } = require('../lib/helpers');
const { BALANCES, studentReport, getParentId } = require('../lib/queries');

router.get('/notifications', requireLogin, wrap(async (req, res) => {
  const rows = (await pool.query('SELECT * FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100', [req.session.user.id])).rows;
  await pool.query('UPDATE notifications SET is_read=TRUE WHERE user_id=$1 AND NOT is_read', [req.session.user.id]);
  res.render('notifications', { title: 'Notifications', rows });
}));

router.get('/children', requireRole('parent'), wrap(async (req, res) => {
  const pid = await getParentId(req.session.user.id);
  const kids = (await pool.query(`SELECT s.*, c.niveau || ' ' || c.section AS classe FROM students s JOIN classes c ON c.id=s.class_id WHERE s.parent_id=$1 ORDER BY s.prenom`, [pid])).rows;
  for (const k of kids) {
    k.report = await studentReport(k.id, k.annee_scolaire);
    k.balance = (await pool.query(`${BALANCES} AND s.id=$2`, [k.annee_scolaire, k.id])).rows[0];
    k.payments = (await pool.query('SELECT * FROM payments WHERE student_id=$1 ORDER BY date_paiement DESC, id DESC', [k.id])).rows;
    k.homework = (await pool.query(`SELECT h.*, sub.nom AS matiere FROM homework h JOIN subjects sub ON sub.id=h.subject_id WHERE h.class_id=$1 ORDER BY h.date_limite DESC LIMIT 5`, [k.class_id])).rows;
  }
  res.render('children', { title: 'Mes enfants', kids });
}));
module.exports = router;
