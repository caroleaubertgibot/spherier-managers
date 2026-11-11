require('dotenv').config({ quiet: true });

const fs = require('fs');
const path = require('path');
const { creerClientServeur, TABLE_SNAPSHOTS } = require('./supabase-client.js');

const COLONNES = ['id', 'client_id', 'libelle', 'cree_le', 'blob'];

// Le blob est du JSON : il contient des virgules, des guillemets et des accolades.
// Un simple join(',') produirait un fichier décalé et illisible.
function cellule(valeur) {
  if (valeur === null || valeur === undefined) return '';
  const s = typeof valeur === 'object' ? JSON.stringify(valeur) : String(valeur);
  return /["\,\n\r;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

async function exporter() {
  const supabase = creerClientServeur();
  const { data, error } = await supabase
    .from(TABLE_SNAPSHOTS)
    .select(COLONNES.join(','))
    .order('cree_le', { ascending: true });

  if (error) throw new Error(`Lecture de la table impossible : ${error.message}`);

  const lignes = [COLONNES.join(',')];
  data.forEach((r) => lignes.push(COLONNES.map((c) => cellule(r[c])).join(',')));

  // BOM en tête : sans lui, Excel affiche les accents de travers.
  const csv = '﻿' + lignes.join('\r\n') + '\r\n';

  const dossier = path.join(__dirname, 'sauvegardes');
  fs.mkdirSync(dossier, { recursive: true });
  const nom = `snapshots-${new Date().toISOString().slice(0, 10)}.csv`;
  const chemin = path.join(dossier, nom);
  fs.writeFileSync(chemin, csv);

  const v1 = data.filter((r) => r.blob?.version_schema === 1).length;
  const v2 = data.filter((r) => r.blob?.referential_version === 2).length;
  console.log(`Export écrit : sauvegardes/${nom}`);
  console.log(`  ${data.length} ligne(s) · v1 : ${v1} · v2 : ${v2} · ${new Set(data.map((r) => r.client_id)).size} client(s)`);
}

exporter().catch((err) => {
  console.error("Erreur lors de l'export :", err.message ?? err);
  process.exit(1);
});
