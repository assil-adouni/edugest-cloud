// Données fictives de démonstration (aucune donnée réelle). Idempotent : ne fait rien si déjà présentes.
const bcrypt = require('bcryptjs');
const { ANNEE } = require('../lib/helpers');

module.exports = async function seed(pool) {
  const exists = await pool.query("SELECT 1 FROM users WHERE LOWER(email) = 'admin@edugest.demo'");
  if (exists.rowCount) { console.log('[seed] Données de démonstration déjà présentes : rien à faire.'); return; }
  const c = await pool.connect();
  const hash = (p) => bcrypt.hashSync(p, 10);
  const user = async (nom, prenom, email, pwd, role) =>
    (await c.query('INSERT INTO users (nom,prenom,email,password_hash,role) VALUES ($1,$2,$3,$4,$5) RETURNING id', [nom, prenom, email, hash(pwd), role])).rows[0].id;
  try {
    await c.query('BEGIN');
    const adminId = await user('Trabelsi', 'Karima', 'admin@edugest.demo', 'Admin123!', 'admin');
    const compta = await user('Jebali', 'Nabil', 'compta@edugest.demo', 'Compta123!', 'comptable');
    const t1u = await user('Gharbi', 'Mohamed', 'prof1@edugest.demo', 'Prof123!', 'enseignant');
    const t2u = await user('Mansouri', 'Leila', 'prof2@edugest.demo', 'Prof123!', 'enseignant');
    const t1 = (await c.query('INSERT INTO teachers (user_id,telephone,specialite) VALUES ($1,$2,$3) RETURNING id', [t1u, '20 111 222', 'Mathématiques'])).rows[0].id;
    const t2 = (await c.query('INSERT INTO teachers (user_id,telephone,specialite) VALUES ($1,$2,$3) RETURNING id', [t2u, '20 333 444', 'Langues'])).rows[0].id;
    const par = [];
    for (const [nom, prenom, email, tel, adr] of [
      ['Khelifi', 'Hichem', 'parent1@edugest.demo', '22 100 100', '12 rue des Oliviers, Sousse'],
      ['Dridi', 'Amel', 'parent2@edugest.demo', '22 200 200', '5 avenue Habib Bourguiba, Sousse'],
      ['Bouazizi', 'Sami', 'parent3@edugest.demo', '22 300 300', '27 rue de la Corniche, Sousse']]) {
      const uid = await user(nom, prenom, email, 'Parent123!', 'parent');
      par.push((await c.query('INSERT INTO parents (user_id,telephone,adresse) VALUES ($1,$2,$3) RETURNING id', [uid, tel, adr])).rows[0].id);
    }
    const cls = [];
    for (const [niv, sec, tid, frais] of [['1ère année', 'A', t1, 900], ['2ème année', 'A', t2, 950], ['3ème année', 'A', t1, 1000]]) {
      cls.push((await c.query('INSERT INTO classes (niveau,section,annee_scolaire,teacher_id,frais_scolarite) VALUES ($1,$2,$3,$4,$5) RETURNING id', [niv, sec, ANNEE, tid, frais])).rows[0].id);
    }
    const subj = [];
    for (const [nom, coef] of [['Arabe', 2], ['Français', 2], ['Mathématiques', 2], ['Éveil scientifique', 1], ['Éducation islamique', 1]]) {
      subj.push((await c.query('INSERT INTO subjects (nom,coefficient) VALUES ($1,$2) RETURNING id', [nom, coef])).rows[0].id);
    }
    const stu = [];
    const eleves = [['Khelifi', 'Yassine', '2019-03-14', 0, 0], ['Khelifi', 'Nour', '2017-09-02', 1, 0], ['Dridi', 'Sarra', '2019-06-21', 0, 1],
      ['Dridi', 'Adam', '2016-01-30', 2, 1], ['Bouazizi', 'Ines', '2017-11-08', 1, 2], ['Bouazizi', 'Rayan', '2016-05-17', 2, 2],
      ['Ben Salah', 'Maram', '2019-12-05', 0, 0], ['Chaabane', 'Omar', '2017-02-25', 1, 1]];
    for (const [nom, prenom, dn, ci, pi] of eleves) {
      stu.push({ id: (await c.query('INSERT INTO students (nom,prenom,date_naissance,class_id,parent_id,annee_scolaire) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id', [nom, prenom, dn, cls[ci], par[pi], ANNEE])).rows[0].id, ci });
    }
    // Notes du 1er trimestre (valeurs déterministes entre 9 et 19)
    for (const [i, s] of stu.entries()) {
      for (const [j, sid] of subj.entries()) {
        const v = 9 + ((i * 7 + j * 5) % 11) + ((i + j) % 2 ? 0.5 : 0);
        await c.query('INSERT INTO grades (student_id,subject_id,teacher_id,valeur,trimestre,annee_scolaire) VALUES ($1,$2,$3,$4,1,$5)', [s.id, sid, s.ci === 1 ? t2 : t1, v, ANNEE]);
      }
    }
    // Paiements : une tranche payée par élève + quelques paiements en attente
    for (const [i, s] of stu.entries()) {
      await c.query("INSERT INTO payments (student_id,montant,date_paiement,mode,motif,statut,annee_scolaire,created_by) VALUES ($1,$2,CURRENT_DATE - $3::int,$4,'Frais de scolarité - 1ère tranche','paye',$5,$6)",
        [s.id, 300 + (i % 3) * 100, 20 + i, ['especes', 'cheque', 'virement'][i % 3], ANNEE, compta]);
      if (i % 2 === 0) await c.query("INSERT INTO payments (student_id,montant,date_paiement,mode,motif,statut,annee_scolaire,created_by) VALUES ($1,300,CURRENT_DATE + 15,'virement','Frais de scolarité - 2ème tranche','en_attente',$2,$3)", [s.id, ANNEE, compta]);
    }
    await c.query(`INSERT INTO homework (class_id,subject_id,teacher_id,titre,description,date_limite,annee_scolaire) VALUES
      ($1,$2,$3,'Exercices de calcul','Faire les exercices 1 à 5 page 42 du manuel.',CURRENT_DATE + 5,$4),
      ($5,$6,$7,'Dictée préparée','Apprendre le texte « Le petit jardin » pour la dictée.',CURRENT_DATE + 3,$4),
      ($8,$2,$3,'Problèmes de géométrie','Résoudre les problèmes 3 et 4 du cahier d''activités.',CURRENT_DATE + 7,$4)`,
      [cls[0], subj[2], t1, ANNEE, cls[1], subj[1], t2, cls[2]]);
    await c.query(`INSERT INTO announcements (titre,contenu,author_id,annee_scolaire) VALUES
      ('Bienvenue sur EduGest Cloud','Cette plateforme permet de suivre les notes, devoirs et paiements de votre enfant.',$1,$2),
      ('Réunion parents-enseignants','Une réunion aura lieu le samedi prochain à 10h dans la salle polyvalente.',$1,$2)`, [adminId, ANNEE]);
    await c.query(`INSERT INTO messages (sender_id,recipient_id,objet,contenu) VALUES
      ($1,$2,'Résultats du 1er trimestre','Bonjour, les notes du premier trimestre sont disponibles dans votre espace.'),
      ($3,$4,'Question sur la scolarité','Bonjour, pouvez-vous me confirmer la date de la 2ème tranche ?'),
      ($5,$3,'Re: Question sur la scolarité','Bonjour, la 2ème tranche est à régler avant la fin du mois.')`,
      [t1u, (await c.query("SELECT user_id FROM parents WHERE id=$1", [par[0]])).rows[0].user_id, (await c.query("SELECT user_id FROM parents WHERE id=$1", [par[1]])).rows[0].user_id, compta, compta]);
    await c.query("INSERT INTO notifications (user_id,message) SELECT user_id, 'Bienvenue sur EduGest Cloud : votre espace parent est prêt.' FROM parents");
    await c.query('COMMIT');
    console.log('[seed] Données de démonstration insérées.');
  } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
};
