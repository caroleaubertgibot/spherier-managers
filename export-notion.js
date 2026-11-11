require('dotenv').config({ quiet: true });

const fs = require('fs');
const { Client } = require('@notionhq/client');

// ===========================================================================
// Export complet du référentiel Notion — gel de l'état avant migration Pyxis.
// ===========================================================================
//
// PRINCIPE : toutes les relations sont exprimées par `Code`, JAMAIS par identifiant de
// page. Un identifiant Notion n'a de sens que dans l'espace qui l'a créé ; un export
// qui en contiendrait serait illisible ailleurs, donc inutilisable pour une migration.
// Les codes, eux, sont les identifiants permanents du référentiel : ils traversent.
//
// La base Clients fait exception à ce principe puisqu'elle ne porte aucune relation.
//
// Lecture seule : ce script n'écrit rien dans Notion.
//
//   node export-notion.js                 -> sauvegardes/export-notion-<date>.json
//   SORTIE=chemin.json node export-notion.js

const { VERSION_REFERENTIEL, NOM_PAR_NOTION } = require('./club.config.js');

const notion = new Client({ auth: process.env.NOTION_TOKEN });

// La base Clients n'est pas dans le .env : elle n'est lue par aucune fonction de
// l'application, seul le pilote du club s'en sert. Elle est retrouvée par recherche,
// pour ne pas ajouter une variable d'environnement à poser sur deux instances.
const NOM_CLIENTS = /client/i;

const txt = (page, nom) => {
  const p = page.properties[nom];
  return ((p?.rich_text ?? p?.title ?? []).map((s) => s.plain_text).join('')).trim();
};
const nombre = (page, nom) => page.properties[nom]?.number ?? null;
const coche = (page, nom) => page.properties[nom]?.checkbox === true;
const selection = (page, nom) => page.properties[nom]?.select?.name ?? null;
const multi = (page, nom) => (page.properties[nom]?.multi_select ?? []).map((o) => o.name);
const liens = (page, nom) => (page.properties[nom]?.relation ?? []).map((r) => r.id);

// L'URL est repérée par son TYPE et non par son nom : c'est ainsi que le référentiel la
// lit déjà, le nom de la propriété ayant varié.
const url = (page) => {
  const cle = Object.keys(page.properties).find((k) => page.properties[k].type === 'url');
  return cle ? (page.properties[cle].url ?? null) : null;
};

async function toutes(dsId) {
  let cursor, pages = [];
  do {
    const r = await notion.dataSources.query({ data_source_id: dsId, start_cursor: cursor, page_size: 100 });
    pages.push(...r.results);
    cursor = r.has_more ? r.next_cursor : null;
  } while (cursor);
  return pages;
}

async function dsDe(env) {
  const db = await notion.databases.retrieve({ database_id: process.env[env] });
  return db.data_sources[0].id;
}

async function dsClients() {
  const r = await notion.search({ filter: { property: 'object', value: 'data_source' }, page_size: 100 });
  const trouve = r.results.find((x) => NOM_CLIENTS.test((x.title ?? []).map((s) => s.plain_text).join('') || x.name || ''));
  if (!trouve) throw new Error('base Clients introuvable dans l\'espace Notion');
  return trouve.id;
}

async function exporter() {
  const [dsT, dsC, dsR, dsCli] = await Promise.all([
    dsDe('DB_THEMES'), dsDe('DB_COMPETENCES'), dsDe('DB_RESSOURCES'), dsClients(),
  ]);
  const [pT, pC, pR, pCli] = await Promise.all([toutes(dsT), toutes(dsC), toutes(dsR), toutes(dsCli)]);

  // Tables de correspondance identifiant -> code. C'est par elles que passent TOUTES
  // les relations de l'export.
  const codeTheme = new Map(pT.map((p) => [p.id, txt(p, 'Code')]));
  const codeComp = new Map(pC.map((p) => [p.id, txt(p, 'Code')]));

  // Une relation dont le code est introuvable ne doit pas disparaître en silence : on
  // la conserve, marquée, pour que la vérification la voie.
  const versCodes = (ids, table) => ids.map((id) => table.get(id) ?? `!INTROUVABLE:${id}`);

  const themes = pT.map((p) => ({
    name: txt(p, 'Name'),
    code: txt(p, 'Code'),
    definition: txt(p, 'DefinitionThematique'),
    // Traduit vers le libellé canonique, sinon l'export ne serait pas réimportable :
    // le garde-fou de l'import rejetterait une dimension qu'il ne connaît pas.
    dimension: NOM_PAR_NOTION.get(selection(p, 'Dimension')) ?? selection(p, 'Dimension'),
    ordre: nombre(p, 'Ordre'),
    position_x: nombre(p, 'Position X'),
    position_y: nombre(p, 'Position Y'),
    seuil: nombre(p, 'Seuil'),
    actif: coche(p, 'Actif'),
    nourrit: versCodes(liens(p, 'Nourrit'), codeTheme),
  })).sort((a, b) => (a.ordre ?? 1e9) - (b.ordre ?? 1e9) || a.code.localeCompare(b.code, 'fr'));

  const competences = pC.map((p) => ({
    name: txt(p, 'Name'),
    code: txt(p, 'Code'),
    description: txt(p, 'Description'),
    enonces: { 1: txt(p, 'Énoncé N1'), 2: txt(p, 'Énoncé N2'), 3: txt(p, 'Énoncé N3') },
    difficulte: selection(p, 'Difficulté'),
    ordre: nombre(p, 'Ordre'),
    actif: coche(p, 'Actif'),
    theme: versCodes(liens(p, '📚 Thèmes'), codeTheme)[0] ?? null,
  })).sort((a, b) => a.code.localeCompare(b.code, 'fr'));

  // Le rattachement ressource -> compétence n'existe QUE du côté Compétences : la
  // relation y est déclarée `single_property`, la base Ressources n'en porte pas le
  // pendant. On le reconstitue donc en inversant.
  const compsParRessource = new Map();
  pC.forEach((p) => {
    const code = txt(p, 'Code');
    liens(p, '📋 Ressources').forEach((idR) => {
      if (!compsParRessource.has(idR)) compsParRessource.set(idR, []);
      compsParRessource.get(idR).push(code);
    });
  });

  const ressources = pR.map((p) => ({
    name: txt(p, 'Name'),
    type: multi(p, 'Type'),
    url: url(p),
    actif: coche(p, 'Actif'),
    themes: versCodes(liens(p, '📚 Thèmes'), codeTheme),
    competences: (compsParRessource.get(p.id) ?? []).sort(),
  })).sort((a, b) => a.name.localeCompare(b.name, 'fr'));

  // Clients : la base ne porte que Name et UUID. Aucune propriété d'URL d'espace n'y
  // existe — le champ est donc présent et vide plutôt qu'absent, pour que la migration
  // sache qu'il est à créer et non qu'on l'a oublié.
  const clients = pCli.map((p) => ({
    name: txt(p, 'Name'),
    uuid: txt(p, 'UUID'),
    url_espace: url(p),
  })).sort((a, b) => a.name.localeCompare(b.name, 'fr'));

  return {
    exporte_le: new Date().toISOString(),
    source: 'Espace Notion du club managers (Pyxis, Manager-Coach)',
    principe: 'Toutes les relations sont exprimées par Code, jamais par identifiant de page.',
    // Lue depuis club.config.js plutôt que recopiée : un littéral qui dérive de la
    // configuration produit un export qui se dit d'une version qu'il n'est pas.
    referentiel_version: VERSION_REFERENTIEL,
    themes, competences, ressources, clients,
  };
}

// --- Contrôles, sur le fichier produit et non sur ce qu'on croit avoir lu -----
function verifier(x) {
  const A = [];
  const chk = (n, c, d = '') => A.push((c ? '  OK   ' : '  ÉCART ') + n + (d ? `  [${d}]` : ''));

  const tActifs = x.themes.filter((t) => t.actif);
  const cActifs = x.competences.filter((c) => c.actif);
  // Comptes attendus du référentiel Manager-Coach V2 (classeur de Thomas) :
  // 18 thématiques réparties 5 / 8 / 5, et 54 compétences réparties 15 / 24 / 15.
  chk('18 thématiques actives', tActifs.length === 18, String(tActifs.length));
  chk('54 compétences actives', cActifs.length === 54, String(cActifs.length));

  const mauvais = cActifs.filter((c) => {
    const e = c.enonces;
    return [1, 2, 3].some((n) => !e[n] || !String(e[n]).trim());
  });
  chk('exactement 3 énoncés non vides par compétence', mauvais.length === 0,
    mauvais.slice(0, 5).map((c) => c.code).join(' '));

  const d = {};
  cActifs.forEach((c) => { d[c.difficulte ?? '(vide)'] = (d[c.difficulte ?? '(vide)'] ?? 0) + 1; });
  chk('28 Accessible / 26 Exigeant', d.Accessible === 28 && d.Exigeant === 26, JSON.stringify(d));

  const fil = tActifs.reduce((n, t) => n + t.nourrit.length, 0);
  chk('16 filiations', fil === 16, String(fil));

  const codesT = new Set(x.themes.map((t) => t.code));
  const cassees = tActifs.flatMap((t) => t.nourrit.filter((n) => !codesT.has(n)).map((n) => `${t.code}->${n}`));
  chk('aucune filiation vers un code inexistant', cassees.length === 0, cassees.slice(0, 4).join(' '));

  const dblT = x.themes.map((t) => t.code).filter((c, i, a) => a.indexOf(c) !== i);
  const dblC = x.competences.map((c) => c.code).filter((c, i, a) => a.indexOf(c) !== i);
  chk('aucun code de thématique en double', dblT.length === 0, dblT.join(' '));
  chk('aucun code de compétence en double', dblC.length === 0, dblC.join(' '));

  const sansOrdreT = tActifs.filter((t) => t.ordre == null).map((t) => t.code);
  const sansOrdreC = cActifs.filter((c) => c.ordre == null).map((c) => c.code);
  chk('Ordre renseigné sur toutes les thématiques', sansOrdreT.length === 0, sansOrdreT.join(' '));
  chk('Ordre renseigné sur toutes les compétences', sansOrdreC.length === 0, sansOrdreC.join(' '));

  const avecSeuil = tActifs.filter((t) => t.seuil != null).map((t) => `${t.name}=${t.seuil}`);
  chk('Seuil = 4 sur Gestions des conflits et vide ailleurs',
    avecSeuil.length === 1 && avecSeuil[0] === 'Gestions des conflits=4', avecSeuil.join(', ') || 'aucun');

  // Garde-fou du principe même de l'export.
  const brut = JSON.stringify(x);
  const idsRestants = (brut.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g) ?? [])
    .filter((id) => !x.clients.some((c) => c.uuid === id));
  chk('aucun identifiant de page Notion dans l\'export', idsRestants.length === 0,
    `${idsRestants.length} trouvé(s)`);

  const orphelines = cActifs.filter((c) => !c.theme || !codesT.has(c.theme)).map((c) => c.code);
  chk('chaque compétence pointe vers une thématique existante', orphelines.length === 0, orphelines.slice(0, 5).join(' '));

  return A;
}

async function principal() {
  console.log('lecture de Notion…');
  const x = await exporter();

  const sortie = process.env.SORTIE
    || `sauvegardes/export-notion-${new Date().toISOString().slice(0, 10)}.json`;
  fs.writeFileSync(sortie, JSON.stringify(x, null, 1));
  console.log(`écrit : ${sortie}  (${Math.round(fs.statSync(sortie).size / 1024)} Ko)\n`);

  // On relit le fichier pour vérifier, pas l'objet en mémoire.
  const relu = JSON.parse(fs.readFileSync(sortie, 'utf8'));
  const A = verifier(relu);
  console.log(A.join('\n'));

  console.log('\nCOMPTES');
  console.log(`  thématiques : ${relu.themes.length} (dont ${relu.themes.filter((t) => t.actif).length} actives)`);
  console.log(`  compétences : ${relu.competences.length} (dont ${relu.competences.filter((c) => c.actif).length} actives)`);
  console.log(`  énoncés     : ${relu.competences.length * 3}`);
  console.log(`  filiations  : ${relu.themes.reduce((n, t) => n + t.nourrit.length, 0)}`);
  console.log(`  ressources  : ${relu.ressources.length}`);
  console.log(`  clients     : ${relu.clients.length}`);

  process.exitCode = A.some((l) => l.startsWith('  ÉCART')) ? 1 : 0;
}

if (require.main === module) {
  principal().catch((err) => { console.error('ÉCHEC :', err.message); process.exit(1); });
} else {
  console.error('export-notion.js chargé sans être lancé : rien n\'est exécuté.');
}

module.exports = { exporter, verifier };
