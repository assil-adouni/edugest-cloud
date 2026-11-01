const router = require('express').Router();
const pool = require('../db');
const { requireLogin, requireRole } = require('../middleware/auth');
const { wrap, clean, isInt, ANNEE } = require('../lib/helpers');
router.use(requireLogin);

const list = async () => (await pool.query(`SELECT a.*, u.prenom || ' ' || u.nom AS auteur FROM announcements a LEFT JOIN users u ON u.id=a.author_id ORDER BY a.created_at DESC`)).rows;
router.get('/', wrap(async (req, res) => res.render('announcements', { title: 'Annonces', rows: await list(), errors: [], v: {} })));
router.post('/', requireRole('admin'), wrap(async (req, res) => {
  const v = { titre: clean(req.body.titre), contenu: clean(req.body.contenu) }; const e = [];
  if (!v.titre || v.titre.length > 150) e.push('Le titre est obligatoire (150 caractères max).');
  if (!v.contenu || v.contenu.length > 3000) e.push('Le contenu est obligatoire (3000 caractères max).');
  if (e.length) return res.status(400).render('announcements', { title: 'Annonces', rows: await list(), errors: e, v });
  await pool.query('INSERT INTO announcements (titre,contenu,author_id,annee_scolaire) VALUES ($1,$2,$3,$4)', [v.titre, v.contenu, req.session.user.id, ANNEE]);
  req.flash('success', 'Annonce publiée sur le tableau de bord.'); res.redirect('/announcements');
}));
router.post('/:id/delete', requireRole('admin'), wrap(async (req, res) => {
  if (isInt(req.params.id)) { await pool.query('DELETE FROM announcements WHERE id=$1', [req.params.id]); req.flash('success', 'Annonce supprimée.'); }
  res.redirect('/announcements');
}));
module.exports = router;
