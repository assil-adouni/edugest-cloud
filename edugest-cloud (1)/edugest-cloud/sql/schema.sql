-- EduGest Cloud : schéma PostgreSQL (idempotent : peut être rejoué sans erreur)
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  nom VARCHAR(100) NOT NULL,
  prenom VARCHAR(100) NOT NULL,
  email VARCHAR(150) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(20) NOT NULL CHECK (role IN ('admin','enseignant','parent','comptable')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_idx ON users (LOWER(email));

CREATE TABLE IF NOT EXISTS teachers (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  telephone VARCHAR(30),
  specialite VARCHAR(100)
);

CREATE TABLE IF NOT EXISTS parents (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  telephone VARCHAR(30),
  adresse VARCHAR(255)
);

CREATE TABLE IF NOT EXISTS classes (
  id SERIAL PRIMARY KEY,
  niveau VARCHAR(30) NOT NULL,
  section VARCHAR(10) NOT NULL,
  annee_scolaire VARCHAR(9) NOT NULL CHECK (annee_scolaire ~ '^[0-9]{4}-[0-9]{4}$'),
  teacher_id INT REFERENCES teachers(id) ON DELETE SET NULL,
  frais_scolarite NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (frais_scolarite >= 0),
  UNIQUE (niveau, section, annee_scolaire)
);

CREATE TABLE IF NOT EXISTS subjects (
  id SERIAL PRIMARY KEY,
  nom VARCHAR(100) NOT NULL UNIQUE,
  coefficient NUMERIC(4,2) NOT NULL CHECK (coefficient > 0)
);

CREATE TABLE IF NOT EXISTS students (
  id SERIAL PRIMARY KEY,
  nom VARCHAR(100) NOT NULL,
  prenom VARCHAR(100) NOT NULL,
  date_naissance DATE NOT NULL,
  class_id INT NOT NULL REFERENCES classes(id) ON DELETE RESTRICT,
  parent_id INT NOT NULL REFERENCES parents(id) ON DELETE RESTRICT,
  annee_scolaire VARCHAR(9) NOT NULL CHECK (annee_scolaire ~ '^[0-9]{4}-[0-9]{4}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS students_class_idx ON students(class_id);
CREATE INDEX IF NOT EXISTS students_parent_idx ON students(parent_id);

CREATE TABLE IF NOT EXISTS grades (
  id SERIAL PRIMARY KEY,
  student_id INT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  subject_id INT NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT,
  teacher_id INT REFERENCES teachers(id) ON DELETE SET NULL,
  valeur NUMERIC(4,2) NOT NULL CHECK (valeur >= 0 AND valeur <= 20),
  trimestre SMALLINT NOT NULL CHECK (trimestre BETWEEN 1 AND 3),
  annee_scolaire VARCHAR(9) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (student_id, subject_id, trimestre, annee_scolaire)
);

CREATE TABLE IF NOT EXISTS payments (
  id SERIAL PRIMARY KEY,
  student_id INT NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  montant NUMERIC(10,2) NOT NULL CHECK (montant > 0),
  date_paiement DATE NOT NULL DEFAULT CURRENT_DATE,
  mode VARCHAR(20) NOT NULL CHECK (mode IN ('especes','cheque','virement','carte')),
  motif VARCHAR(150),
  statut VARCHAR(15) NOT NULL CHECK (statut IN ('paye','en_attente')),
  annee_scolaire VARCHAR(9) NOT NULL,
  created_by INT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS payments_student_idx ON payments(student_id);

CREATE TABLE IF NOT EXISTS homework (
  id SERIAL PRIMARY KEY,
  class_id INT NOT NULL REFERENCES classes(id) ON DELETE RESTRICT,
  subject_id INT NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT,
  teacher_id INT REFERENCES teachers(id) ON DELETE SET NULL,
  titre VARCHAR(150) NOT NULL,
  description TEXT NOT NULL,
  date_limite DATE NOT NULL,
  annee_scolaire VARCHAR(9) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS announcements (
  id SERIAL PRIMARY KEY,
  titre VARCHAR(150) NOT NULL,
  contenu TEXT NOT NULL,
  author_id INT REFERENCES users(id) ON DELETE SET NULL,
  annee_scolaire VARCHAR(9) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS messages (
  id SERIAL PRIMARY KEY,
  sender_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  objet VARCHAR(150) NOT NULL,
  contenu TEXT NOT NULL,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS messages_recipient_idx ON messages(recipient_id);

CREATE TABLE IF NOT EXISTS notifications (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message TEXT NOT NULL,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications(user_id);
