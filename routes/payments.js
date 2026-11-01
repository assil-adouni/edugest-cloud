const router = require('express').Router();
const pool = require('../db');
const { requireRole } = require('../middleware/auth');
const { wrap, clean, isInt, isDate, toNum, money, ANNEE, MODES } = require('../lib/helpers');
const { BALANCES, notifyParentOfStudent } = require('../lib/queries');
router.use(requireRole('admin', 'comptable'));

router.get('/', wrap(async (req, res) => {
  const q = clean(req.query.q).slice(0, 50); const statut = ['paye', 'en_attente'].includes(req.query.statut) ? req.query.statut : '';
  const payments = (await pool.query(`SELECT p.*, s.nom, s.prenom, c.niveau || ' ' || c.section AS classe FROM payments p JOIN students s ON s.id=p.student_id JOIN classes c ON c.id=s.class_id
    WHERE ($1::text='' OR (s.prenom || ' ' || s.nom) ILIKE $2 OR (s.nom || ' ' || s.prenom) ILIKE $2) AND ($3::text='' OR p.statut=$3)
    ORDER BY p.date_paiement DESC, p.id DESC`, [q, `%${q}%`, statut])).rows;
  const t = (await pool.query(`SELECT
    (SELECT COALESCE(SUM(montant),0) FROM payments WHERE statut='paye' AND annee_scolaire=$1) AS paye,
    (SELECT COALESCE(SUM(montant),0) FROM payments WHERE statut='en_attente' AND annee_scolaire=$1) AS attente,
    (SELECT COALESCE(SUM(solde),0) FROM (${BALANCES}) b) AS solde`, [ANNEE])).rows[0];
  res.render('payments', { title: 'Paiements', payments, totals: t, q, statut });
}));

router.get('/new', wrap(async (req, res) => {
  const students = (await pool.query(`${BALANCES} ORDER BY s.nom, s.prenom`, [ANNEE])).rows;
  res.render('payment-form', { title: 'Enregistrer un paiement', students, errors: [], v: { statut: 'paye', mode: 'especes', date_paiement: new Date().toISOString().slice(0, 10), student_id: req.query.student_id || '' } });
}));

router.post('/', wrap(async (req, res) => {
  const b = req.body;
  const v = { student_id: clean(b.student_id), montant: clean(b.montant), mode: clean(b.mode), motif: clean(b.motif), statut: clean(b.statut), date_paiement: clean(b.date_paiement) };
  const e = []; const m = toNum(v.montant);
  const students = (await pool.query(`${BALANCES} ORDER BY s.nom, s.prenom`, [ANNEE])).rows;
  const st = isInt(v.student_id) ? students.find((s) => String(s.id) === v.student_id) : null;
  if (!st) e.push('Choisissez un élève.');
  if (v.montant === '' || isNaN(m) || m <= 0 || m > 99999999) e.push('Le montant doit être un nombre supérieur à 0.');
  if (!MODES[v.mode]) e.push('Mode de paiement invalide.');
  if (!['paye', 'en_attente'].includes(v.statut)) e.push('Statut invalide.');
  if (!isDate(v.date_paiement)) e.push('Date invalide.');
  if (v.motif.length > 150) e.push('Motif trop long (150 caractères max).');
  if (!e.length && v.statut === 'paye' && m > st.solde + 0.001) e.push(`Le montant (${money(m)}) dépasse le solde restant de l'élève (${money(st.solde)}).`);
  if (e.length) return res.status(400).render('payment-form', { title: 'Enregistrer un paiement', students, errors: e, v });
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query('INSERT INTO payments (student_id,montant,date_paiement,mode,motif,statut,annee_scolaire,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [st.id, m, v.date_paiement, v.mode, v.motif || null, v.statut, ANNEE, req.session.user.id]);
    if (v.statut === 'paye') await notifyParentOfStudent(c, st.id, `Paiement de ${money(m)} reçu pour ${st.prenom} ${st.nom} (${MODES[v.mode]}). Merci !`);
    await c.query('COMMIT');
  } catch (err) { await c.query('ROLLBACK'); throw err; } finally { c.release(); }
  req.flash('success', v.statut === 'paye'
    ? `Paiement de ${money(m)} enregistré pour ${st.prenom} ${st.nom}. Notification interne créée pour le parent (simulation : aucun e-mail envoyé).`
    : `Paiement de ${money(m)} enregistré avec le statut « en attente ».`);
  res.redirect('/payments');
}));

router.get('/pending', wrap(async (req, res) => {
  const pending = (await pool.query(`SELECT p.*, s.nom, s.prenom, c.niveau || ' ' || c.section AS classe FROM payments p JOIN students s ON s.id=p.student_id JOIN classes c ON c.id=s.class_id
    WHERE p.statut='en_attente' ORDER BY p.date_paiement`)).rows;
  const balances = (await pool.query(`SELECT * FROM (${BALANCES}) b WHERE b.solde > 0 ORDER BY b.solde DESC, b.nom`, [ANNEE])).rows;
  res.render('payments-pending', { title: 'Paiements en attente', pending, balances });
}));

router.post('/:id/validate', wrap(async (req, res) => {
  if (!isInt(req.params.id)) return res.redirect('/payments/pending');
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const p = (await c.query(`UPDATE payments SET statut='paye', date_paiement=CURRENT_DATE WHERE id=$1 AND statut='en_attente' RETURNING *`, [req.params.id])).rows[0];
    if (p) {
      const s = (await c.query('SELECT prenom, nom FROM students WHERE id=$1', [p.student_id])).rows[0];
      await notifyParentOfStudent(c, p.student_id, `Paiement de ${money(p.montant)} validé pour ${s.prenom} ${s.nom}. Merci !`);
    }
    await c.query('COMMIT');
    req.flash(p ? 'success' : 'danger', p ? 'Paiement validé. Le parent a été notifié (notification interne).' : 'Paiement introuvable ou déjà validé.');
  } catch (err) { await c.query('ROLLBACK'); throw err; } finally { c.release(); }
  res.redirect('/payments/pending');
}));
module.exports = router;
