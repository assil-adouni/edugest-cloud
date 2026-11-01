const router = require('express').Router();
const multer = require('multer');
const path = require('path');
const pool = require('../db');
const { requireRole } = require('../middleware/auth');
const { wrap, clean, isInt, isDate, ANNEE } = require('../lib/helpers');
const { getTeacherId, getParentId, canSeeClass } = require('../lib/queries');
router.use(requireRole('admin', 'enseignant', 'parent', 'eleve'));

// Fichiers : types autorisés, 5 Mo max, 3 par devoir. Stockés dans PostgreSQL (disque du PaaS éphémère).
const TYPES = { '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.txt': 'text/plain',
  '.doc': 'application/msword', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint', '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation' };
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 3 },
  fileFilter: (req, f, cb) => (TYPES[path.extname(f.originalname).toLowerCase()] ? cb(null, true) : cb(new Error('TYPE'))) }).array('files', 3);
const handleUpload = (req, res, next) => upload(req, res, (err) => {
  if (err) req.uploadError = err.code === 'LIMIT_FILE_SIZE' ? 'Un fichier dépasse 5 Mo.' : err.code === 'LIMIT_UNEXPECTED_FILE' || err.code === 'LIMIT_FILE_COUNT' ? '3 fichiers maximum par devoir.'
    : err.message === 'TYPE' ? 'Type de fichier non autorisé (PDF, images, Word, Excel, PowerPoint, texte).' : 'Erreur lors de l\'envoi des fichiers.';
  next();
});

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
  } else if (u.role === 'parent') {
    rows = (await pool.query(`${BASE} WHERE h.class_id IN (SELECT class_id FROM students WHERE parent_id=$1) ORDER BY h.date_limite DESC`, [await getParentId(u.id)])).rows;
  } else rows = (await pool.query(`${BASE} WHERE h.class_id IN (SELECT class_id FROM students WHERE user_id=$1) ORDER BY h.date_limite DESC`, [u.id])).rows;
  const files = rows.length ? (await pool.query('SELECT id, homework_id, filename, size FROM homework_files WHERE homework_id = ANY($1::int[]) ORDER BY id', [rows.map((r) => r.id)])).rows : [];
  rows.forEach((r) => { r.files = files.filter((f) => f.homework_id === r.id); });
  const subjects = (await pool.query('SELECT id, nom FROM subjects ORDER BY nom')).rows;
  res.status(extra.errors && extra.errors.length ? 400 : 200).render('homework', { title: 'Devoirs', rows, classes, subjects, errors: [], v: {}, ...extra });
}
router.get('/', wrap((req, res) => page(req, res)));

router.get('/files/:id', wrap(async (req, res) => {
  const f = isInt(req.params.id) && (await pool.query('SELECT f.*, h.class_id FROM homework_files f JOIN homework h ON h.id=f.homework_id WHERE f.id=$1', [req.params.id])).rows[0];
  if (!f || !(await canSeeClass(req.session.user, f.class_id))) return res.status(404).render('error', { title: 'Fichier introuvable', message: "Ce fichier n'existe pas ou vous n'y avez pas accès." });
  res.set({ 'Content-Type': f.mimetype, 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(f.filename)}`, 'X-Content-Type-Options': 'nosniff', 'Content-Length': f.size });
  res.send(f.data);
}));

router.post('/', requireRole('enseignant'), handleUpload, wrap(async (req, res) => {
  const b = req.body; const v = { class_id: clean(b.class_id), subject_id: clean(b.subject_id), titre: clean(b.titre), description: clean(b.description), date_limite: clean(b.date_limite) };
  const e = req.uploadError ? [req.uploadError] : []; const tid = await getTeacherId(req.session.user.id);
  if (!isInt(v.class_id) || !(await pool.query('SELECT 1 FROM classes WHERE id=$1 AND teacher_id=$2', [v.class_id, tid])).rowCount) e.push("Choisissez l'une de vos classes.");
  if (!isInt(v.subject_id)) e.push('Choisissez une matière.');
  if (!v.titre || v.titre.length > 150) e.push('Le titre est obligatoire (150 caractères max).');
  if (!v.description || v.description.length > 3000) e.push('La description est obligatoire (3000 caractères max).');
  if (!isDate(v.date_limite)) e.push('La date limite est invalide.');
  if (e.length) return page(req, res, { errors: e, v });
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const id = (await c.query('INSERT INTO homework (class_id,subject_id,teacher_id,titre,description,date_limite,annee_scolaire) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id', [v.class_id, v.subject_id, tid, v.titre, v.description, v.date_limite, ANNEE])).rows[0].id;
    for (const f of req.files || []) {
      const name = path.basename(Buffer.from(f.originalname, 'latin1').toString('utf8')).replace(/[\r\n"]/g, '').slice(0, 150) || 'fichier';
      await c.query('INSERT INTO homework_files (homework_id,filename,mimetype,size,data) VALUES ($1,$2,$3,$4,$5)', [id, name, TYPES[path.extname(name).toLowerCase()] || 'application/octet-stream', f.size, f.buffer]);
    }
    await c.query('COMMIT');
  } catch (err) {
    await c.query('ROLLBACK');
    if (err.code !== '23503') throw err;
    return page(req, res, { errors: ['Matière introuvable.'], v });
  } finally { c.release(); }
  req.flash('success', `Devoir publié${req.files && req.files.length ? ` avec ${req.files.length} fichier(s)` : ''}.`); res.redirect('/homework');
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
