// Données fictives v1.1 : salles, emploi du temps, compte élève. Idempotent, compatible avec une base existante.
const bcrypt = require('bcryptjs');

module.exports = async function seedExtras(pool) {
  if (!(await pool.query("SELECT 1 FROM users WHERE LOWER(email)='admin@edugest.demo'")).rowCount) return;
  if (!(await pool.query('SELECT 1 FROM rooms LIMIT 1')).rowCount) {
    for (const [nom, cap] of [['Salle 1', 25], ['Salle 2', 25], ['Salle 3', 20]]) await pool.query('INSERT INTO rooms (nom,capacite) VALUES ($1,$2)', [nom, cap]);
    const cls = (await pool.query('SELECT id FROM classes ORDER BY niveau, section')).rows;
    const rooms = (await pool.query('SELECT id FROM rooms ORDER BY nom')).rows;
    for (const [i, c] of cls.entries()) if (rooms[i]) await pool.query('UPDATE classes SET room_id=$1 WHERE id=$2 AND room_id IS NULL', [rooms[i].id, c.id]);
    console.log('[seed] Salles créées.');
  }
  if (!(await pool.query('SELECT 1 FROM timetable LIMIT 1')).rowCount) {
    const subj = Object.fromEntries((await pool.query('SELECT id, nom FROM subjects')).rows.map((s) => [s.nom, s.id]));
    const cls = (await pool.query('SELECT id, teacher_id, room_id FROM classes ORDER BY niveau, section')).rows;
    // Horaires décalés par classe pour qu'un même enseignant ne soit jamais à deux endroits à la fois
    const horaires = [['08:00', '09:00', '09:15', '10:15'], ['10:30', '11:30', '11:45', '12:45'], ['13:30', '14:30', '14:45', '15:45']];
    const plan = [[1, 0, 'Arabe'], [1, 1, 'Mathématiques'], [2, 0, 'Français'], [2, 1, 'Éveil scientifique'], [3, 0, 'Mathématiques'],
      [4, 0, 'Éducation islamique'], [4, 1, 'Arabe'], [5, 0, 'Français']];
    for (const [i, c] of cls.entries()) {
      const h = horaires[i % 3];
      for (const [jour, slot, nom] of plan) if (subj[nom]) await pool.query(
        'INSERT INTO timetable (class_id,subject_id,teacher_id,room_id,jour,heure_debut,heure_fin) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [c.id, subj[nom], c.teacher_id, c.room_id, jour, h[slot * 2], h[slot * 2 + 1]]);
    }
    console.log('[seed] Emploi du temps créé.');
  }
  if (!(await pool.query("SELECT 1 FROM users WHERE LOWER(email)='eleve1@edugest.demo'")).rowCount) {
    const s = (await pool.query("SELECT id FROM students WHERE nom='Khelifi' AND prenom='Yassine' AND user_id IS NULL")).rows[0];
    if (s) {
      const uid = (await pool.query("INSERT INTO users (nom,prenom,email,password_hash,role) VALUES ('Khelifi','Yassine','eleve1@edugest.demo',$1,'eleve') RETURNING id", [bcrypt.hashSync('Eleve123!', 10)])).rows[0].id;
      await pool.query('UPDATE students SET user_id=$1 WHERE id=$2', [uid, s.id]);
      console.log('[seed] Compte élève créé.');
    }
  }
};
