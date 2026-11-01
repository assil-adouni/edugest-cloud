// Gestion des comptes (administrateur) : enseignants, parents, comptables, administrateurs
const router = require('express').Router();
const bcrypt = require('bcryptjs');
const pool = require('../db');
const { requireRole } = require('../middleware/auth');
const { wrap, clean, isInt, ROLES } = require('../lib/helpers');
router.use(requireRole('admin'));

const fields = [
  { name: 'role', label: 'Rôle', type: 'select', required: true, options: Object.entries(ROLES).map(([value, label]) => ({ value, label })) },
  { name: 'prenom', label: 'Prénom', required: true, maxlength: 100 },
  { name: 'nom', label: 'Nom', required: true, maxlength: 100 },
  { name: 'email', label: 'Email', type: 'email', required: true, maxlength: 150 },
  { name: 'password', label: 'Mot de passe (8 caractères min.)', type: 'password', required: true, minlength: 8 },
  { name: 'telephone', label: 'Téléphone', maxlength: 30 },
  { name: 'info', label: 'Spécialité (enseignant) ou adresse (parent)', maxlength: 255, col: 12 },
];
const form = (res, o) => res.render('crud-form', { title: 'Créer un compte', action: '/users', cancelUrl: '/users', fields, ...o });

router.get('/', wrap(async (req, res) => {
  const rows = (await pool.query('SELECT id, prenom, nom, email, role, created_at FROM users ORDER BY role, nom')).rows.map((r) => ({ ...r, roleLabel: ROLES[r.role] }));
  res.render('crud-list', { title: 'Utilisateurs', addUrl: '/users/new', addLabel: 'Créer un compte',
    columns: [{ label: 'Prénom', key: 'prenom' }, { label: 'Nom', key: 'nom' }, { label: 'Email', key: 'email' }, { label: 'Rôle', key: 'roleLabel' }],
    rows, deleteUrl: (r) => `/users/${r.id}/delete`, deleteMsg: (r) => `Supprimer le compte de ${r.prenom} ${r.nom} ?` });
}));
router.get('/new', (req, res) => form(res, { values: { role: 'enseignant' }, errors: [] }));
router.post('/', wrap(async (req, res) => {
  const b = req.body;
  const v = { role: clean(b.role), prenom: clean(b.prenom), nom: clean(b.nom), email: clean(b.email).toLowerCase(), telephone: clean(b.telephone), info: clean(b.info) };
  const pwd = String(b.password || ''); const e = [];
  if (!ROLES[v.role]) e.push('Rôle invalide.');
  if (!v.prenom || !v.nom || v.prenom.length > 100 || v.nom.length > 100) e.push('Nom et prénom sont obligatoires.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email) || v.email.length > 150) e.push('Email invalide.');
  if (pwd.length < 8 || pwd.length > 100) e.push('Le mot de passe doit contenir au moins 8 caractères.');
  if (v.telephone.length > 30 || v.info.length > 255) e.push('Téléphone ou information trop long.');
  if (!e.length) {
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      const id = (await c.query('INSERT INTO users (nom,prenom,email,password_hash,role) VALUES ($1,$2,$3,$4,$5) RETURNING id', [v.nom, v.prenom, v.email, await bcrypt.hash(pwd, 10), v.role])).rows[0].id;
      if (v.role === 'enseignant') await c.query('INSERT INTO teachers (user_id,telephone,specialite) VALUES ($1,$2,$3)', [id, v.telephone || null, v.info || null]);
      if (v.role === 'parent') await c.query('INSERT INTO parents (user_id,telephone,adresse) VALUES ($1,$2,$3)', [id, v.telephone || null, v.info || null]);
      await c.query('COMMIT');
      req.flash('success', `Compte créé pour ${v.prenom} ${v.nom}.`); return res.redirect('/users');
    } catch (err) {
      await c.query('ROLLBACK');
      if (err.code !== '23505') throw err; e.push('Un compte existe déjà avec cet email.');
    } finally { c.release(); }
  }
  form(res, { values: v, errors: e });
}));
router.post('/:id/delete', wrap(async (req, res) => {
  if (!isInt(req.params.id)) return res.redirect('/users');
  if (Number(req.params.id) === req.session.user.id) { req.flash('danger', 'Vous ne pouvez pas supprimer votre propre compte.'); return res.redirect('/users'); }
  try { await pool.query('DELETE FROM users WHERE id=$1', [req.params.id]); req.flash('success', 'Compte supprimé.'); }
  catch (err) { if (err.code !== '23503') throw err; req.flash('danger', 'Suppression impossible : ce parent a des élèves rattachés.'); }
  res.redirect('/users');
}));
module.exports = router;
