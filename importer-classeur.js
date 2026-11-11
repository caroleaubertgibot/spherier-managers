require('dotenv').config({ quiet: true });

const fs = require('fs');
const { Client } = require('@notionhq/client');
const { DIMENSIONS, DIFFICULTES, VERSION_REFERENTIEL,
        NOTION_PAR_NOM, NOM_PAR_NOTION } = require('./club.config.js');

// ===========================================================================
// Import du référentiel Manager-Coach dans les bases Notion de l'instance.
// ===========================================================================
//
// Source : referentiel-managers.json, produit par extraire-classeur.py depuis le
// classeur de Thomas, et déjà passé par ses propres contrôles d'intégrité.
//
// PRINCIPE : les relations sont résolues PAR IDENTIFIANT DE PAGE, à partir des
// codes de l'export. Jamais par correspondance de titre — un collage de noms dans
// une colonne de relation crée SILENCIEUSEMENT une page en double à la moindre
// différence d'accent ou d'espace, et la compétence qui la vise disparaît du ciel
// sans aucun message.
//
// L'ORDRE DES PHASES EST CONTRAINT. Une relation ne peut pas viser une page qui
// n'existe pas encore :
//   1. les options du select Dimension
//   2. les thématiques, SANS filiation
//   3. les filiations, une fois toutes les thématiques créées
//   4. les compétences, avec leurs énoncés et leur rattachement
//   5. vérification PAR RELECTURE de Notion, et non sur les retours d'écriture
//
//   SIMULATION=1 node importer-classeur.js   -> ne rien écrire
//   node importer-classeur.js

const SOURCE = process.env.SOURCE || 'referentiel-managers.json';
const PAUSE_MS = 340; // l'API Notion plafonne à ~3 requêtes/seconde

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const SIMULATION = process.env.SIMULATION === '1';

// Teintes des options dans Notion. Purement cosmétique de ce côté — l'interface
// du sphérier tient ses couleurs de club.config.js — mais une base lisible aide.
const COULEURS = ['orange', 'blue', 'green', 'purple', 'yellow', 'pink'];

async function avecReprise(action, essais = 5) {
  for (let i = 1; i <= essais; i++) {
    try { return await action(); } catch (err) {
      const recuperable = err.code === 'rate_limited' || err.status === 429 || err.status >= 500;
      if (!recuperable || i === essais) throw err;
      await dormir(1000 * i);
    }
  }
}

const rt = (v) => ({ rich_text: v ? [{ type: 'text', text: { content: String(v).slice(0, 2000) } }] : [] });
const ti = (v) => ({ title: [{ type: 'text', text: { content: String(v ?? '') } }] });
const txt = (page, nom) => {
  const p = page.properties[nom];
  return ((p?.rich_text ?? p?.title ?? []).map((s) => s.plain_text).join('')).trim();
};

async function dsDe(variable) {
  if (!process.env[variable]) throw new Error(`${variable} manquant`);
  const db = await avecReprise(() => notion.databases.retrieve({ database_id: process.env[variable] }));
  return db.data_sources[0].id;
}

async function toutes(dsId) {
  let cursor, pages = [];
  do {
    const r = await avecReprise(() => notion.dataSources.query({ data_source_id: dsId, start_cursor: cursor, page_size: 100 }));
    pages.push(...r.results);
    cursor = r.has_more ? r.next_cursor : null;
  } while (cursor);
  return pages;
}

async function principal() {
  const x = JSON.parse(fs.readFileSync(SOURCE, 'utf8'));

  console.log(SIMULATION ? '=== SIMULATION — aucune écriture ===\n' : '=== IMPORT ===\n');
  console.log(`source : ${SOURCE}  (extrait de « ${x.source} » le ${x.extrait_le})`);

  // --- Garde-fous, avant toute écriture ------------------------------------------
  //
  // Le référentiel et la configuration doivent parler de la même chose. Une
  // dimension présente dans l'un et pas dans l'autre ne provoque aucune erreur :
  // Notion crée l'option à la volée et la thématique devient invisible dans le ciel.
  if (x.referentiel_version !== VERSION_REFERENTIEL) {
    throw new Error(`l'export se dit en v${x.referentiel_version} alors que club.config.js déclare v${VERSION_REFERENTIEL}`);
  }
  const dimsConfig = DIMENSIONS.map((d) => d.name);
  const dimsExport = [...new Set(x.themes.map((t) => t.dimension))];
  const inconnues = dimsExport.filter((d) => !dimsConfig.includes(d));
  if (inconnues.length) {
    throw new Error(`dimensions absentes de club.config.js : ${inconnues.join(' · ')}`);
  }
  const diffsConfig = DIFFICULTES.map((d) => d.nom);
  const diffsInconnues = [...new Set(x.competences.map((c) => c.difficulte))].filter((d) => !diffsConfig.includes(d));
  if (diffsInconnues.length) {
    throw new Error(`difficultés absentes de club.config.js : ${diffsInconnues.join(' · ')}`);
  }
  console.log(`  ${x.themes.length} thématiques · ${x.themes.reduce((n, t) => n + t.nourrit.length, 0)} filiations · ${x.competences.length} compétences`);
  // Ce qui part dans Notion n'est pas le libellé affiché : Notion interdit la
  // virgule dans une option de select.
  const dimsNotion = dimsConfig.map((d) => NOTION_PAR_NOM.get(d));
  console.log(`  dimensions affichées : ${dimsConfig.join(' · ')}`);
  console.log(`  dimensions stockées  : ${dimsNotion.join(' · ')}`);
  console.log(`  difficultés : ${diffsConfig.join(' / ')}`);

  const [dsT, dsC, dsR] = await Promise.all([
    dsDe('DB_THEMES'), dsDe('DB_COMPETENCES'), dsDe('DB_RESSOURCES'),
  ]);

  // Cet import CRÉE, il ne réconcilie pas. Deux passages produiraient deux jeux de
  // pages, et rien ne le signalerait avant que le ciel n'affiche tout en double.
  const [dejaT, dejaC] = await Promise.all([toutes(dsT), toutes(dsC)]);
  if (dejaT.length || dejaC.length) {
    throw new Error(`les bases ne sont pas vides (${dejaT.length} thématiques, ${dejaC.length} compétences) — cet import ne sait que remplir un espace neuf`);
  }
  console.log('  bases cibles : vides, prêtes à recevoir\n');

  if (SIMULATION) {
    console.log(`[simulation] options de Dimension posées dans Notion : ${dimsNotion.join(' | ')}`);
    console.log(`[simulation] ${x.themes.length} thématiques, avec Position X/Y, Ordre et Actif coché`);
    console.log(`[simulation] ${x.themes.reduce((n, t) => n + t.nourrit.length, 0)} filiations résolues par identifiant de page`);
    console.log(`[simulation] ${x.competences.length} compétences, énoncés et Ordre compris`);
    console.log(`[simulation] 0 ressource — la base démarre vide`);
    console.log('\nRien n\'a été écrit.');
    return;
  }

  // --- 1. Les options du select Dimension, AVANT les thématiques ------------------
  //
  // Notion les créerait à la volée en écrivant les thématiques, mais on veut
  // maîtriser leur ORDRE et leur couleur, et surtout vérifier qu'il n'en apparaît
  // pas une quatrième — signature d'une faute de frappe.
  await avecReprise(() => notion.dataSources.update({
    data_source_id: dsT,
    properties: {
      Dimension: { select: { options: dimsNotion.map((d, i) => ({ name: d, color: COULEURS[i % COULEURS.length] })) } },
    },
  }));
  const reluT = await avecReprise(() => notion.dataSources.retrieve({ data_source_id: dsT }));
  const posees = reluT.properties.Dimension.select.options.map((o) => o.name);
  const absentes = dimsNotion.filter((d) => !posees.includes(d));
  if (absentes.length) throw new Error(`options de Dimension non posées : ${absentes.join(', ')}`);
  console.log(`  options de Dimension posées : ${posees.join(' · ')}`);

  // --- 2. Les thématiques, sans filiation ----------------------------------------
  const idParCode = new Map();
  let n = 0;
  for (const t of x.themes) {
    const page = await avecReprise(() => notion.pages.create({
      parent: { type: 'data_source_id', data_source_id: dsT },
      properties: {
        Name: ti(t.name),
        Code: rt(t.code),
        DefinitionThematique: rt(t.definition),
        Dimension: { select: { name: NOTION_PAR_NOM.get(t.dimension) } },
        'Position X': { number: t.position_x },
        'Position Y': { number: t.position_y },
        Ordre: { number: t.ordre },
        Actif: { checkbox: t.actif === true },
        ...(t.seuil != null ? { Seuil: { number: t.seuil } } : {}),
      },
    }));
    idParCode.set(t.code, page.id);
    await dormir(PAUSE_MS);
    if (++n % 6 === 0) console.log(`  ${n} / ${x.themes.length} thématiques…`);
  }
  console.log(`  ${n} thématiques créées`);

  // --- 3. Les filiations, résolues par identifiant de page -----------------------
  let f = 0;
  for (const t of x.themes) {
    if (!t.nourrit.length) continue;
    const cibles = t.nourrit.map((code) => {
      const id = idParCode.get(code);
      if (!id) throw new Error(`filiation ${t.code} -> ${code} : code introuvable`);
      return { id };
    });
    await avecReprise(() => notion.pages.update({
      page_id: idParCode.get(t.code), properties: { Nourrit: { relation: cibles } },
    }));
    f += cibles.length;
    await dormir(PAUSE_MS);
  }
  console.log(`  ${f} filiations posées`);

  // --- 4. Les compétences, énoncés compris ---------------------------------------
  //
  // Une compétence sans ses trois énoncés est inévaluable : autant ne jamais la
  // créer incomplète. L'extraction a déjà garanti qu'ils sont tous là.
  let c = 0;
  for (const comp of x.competences) {
    const idTheme = idParCode.get(comp.theme);
    if (!idTheme) throw new Error(`compétence ${comp.code} : thématique ${comp.theme} introuvable`);
    await avecReprise(() => notion.pages.create({
      parent: { type: 'data_source_id', data_source_id: dsC },
      properties: {
        Name: ti(comp.name),
        Code: rt(comp.code),
        Description: rt(comp.description),
        'Difficulté': { select: { name: comp.difficulte } },
        Ordre: { number: comp.ordre },
        Actif: { checkbox: comp.actif === true },
        '📚 Thèmes': { relation: [{ id: idTheme }] },
        'Énoncé N1': rt(comp.enonces['1']),
        'Énoncé N2': rt(comp.enonces['2']),
        'Énoncé N3': rt(comp.enonces['3']),
      },
    }));
    await dormir(PAUSE_MS);
    if (++c % 12 === 0) console.log(`  ${c} / ${x.competences.length} compétences…`);
  }
  console.log(`  ${c} compétences créées, énoncés compris`);

  // --- 5. Vérification PAR RELECTURE ---------------------------------------------
  //
  // On ne se fie pas aux retours d'écriture : on relit la base comme le ferait
  // l'application, et on compte.
  console.log('\n=== Vérification, par relecture de Notion ===');
  const A = [];
  const chk = (libelle, condition, detail = '') => {
    A.push(condition);
    console.log('  ' + (condition ? 'OK    ' : 'ÉCART ') + libelle + (detail ? `  [${detail}]` : ''));
  };

  const [pagesT, pagesC] = await Promise.all([toutes(dsT), toutes(dsC)]);
  const actifsT = pagesT.filter((p) => p.properties.Actif?.checkbox === true);
  const actifsC = pagesC.filter((p) => p.properties.Actif?.checkbox === true);

  chk(`${x.themes.length} thématiques, toutes Actif`, actifsT.length === x.themes.length && pagesT.length === x.themes.length, `${actifsT.length} / ${pagesT.length}`);
  chk(`${x.competences.length} compétences, toutes Actif`, actifsC.length === x.competences.length && pagesC.length === x.competences.length, `${actifsC.length} / ${pagesC.length}`);

  const sansTheme = actifsC.filter((p) => (p.properties['📚 Thèmes']?.relation ?? []).length === 0);
  chk('aucune compétence sans thématique', sansTheme.length === 0, sansTheme.map((p) => txt(p, 'Code')).slice(0, 5).join(' '));

  const sansEnonce = actifsC.filter((p) => ['Énoncé N1', 'Énoncé N2', 'Énoncé N3'].some((k) => !txt(p, k)));
  chk('trois énoncés non vides partout', sansEnonce.length === 0, sansEnonce.map((p) => txt(p, 'Code')).slice(0, 5).join(' '));

  const filRelues = actifsT.reduce((s, p) => s + (p.properties.Nourrit?.relation ?? []).length, 0);
  chk(`${f} filiations relues`, filRelues === f, String(filRelues));

  const parDim = {};
  // On retraduit vers le libellé canonique pour comparer à l'export.
  actifsT.forEach((p) => {
    const brut = p.properties.Dimension?.select?.name ?? '(vide)';
    const d = NOM_PAR_NOTION.get(brut) ?? brut;
    parDim[d] = (parDim[d] ?? 0) + 1;
  });
  const attenduParDim = {};
  x.themes.forEach((t) => { attenduParDim[t.dimension] = (attenduParDim[t.dimension] ?? 0) + 1; });
  // Comparaison INDÉPENDANTE DE L ORDRE DES CLÉS : Notion ne rend pas les pages dans
  // l ordre de création, et un JSON.stringify sur deux objets aux mêmes paires mais
  // rangées autrement donne deux chaînes différentes. Le contrôle criait au loup.
  const memeRepartition = Object.keys(attenduParDim).length === Object.keys(parDim).length
    && Object.entries(attenduParDim).every(([d, n]) => parDim[d] === n);
  chk('répartition par dimension conforme', memeRepartition, JSON.stringify(parDim));

  const optionsFinales = (await avecReprise(() => notion.dataSources.retrieve({ data_source_id: dsT }))).properties.Dimension.select.options.map((o) => o.name);
  chk('exactement 3 options de Dimension, pas une de plus', optionsFinales.length === 3, optionsFinales.join(' · '));

  const codesDbl = actifsC.map((p) => txt(p, 'Code')).filter((v, i, a) => a.indexOf(v) !== i);
  chk('aucun code de compétence en double', codesDbl.length === 0, codesDbl.slice(0, 5).join(' '));

  const pagesR = await toutes(dsR);
  chk('base Ressources vide, comme prévu', pagesR.length === 0, String(pagesR.length));

  console.log('');
  if (A.every(Boolean)) console.log('Tous les contrôles passent.');
  else { console.log('DES ÉCARTS SUBSISTENT — ne pas activer, corriger d\'abord.'); process.exitCode = 1; }
}

// Ce script ÉCRIT dans Notion : il ne doit partir que lancé explicitement, jamais
// parce qu'un outil l'a chargé.
if (require.main === module) {
  principal().catch((err) => { console.error('ÉCHEC :', err.message); process.exit(1); });
} else {
  console.error('importer-classeur.js chargé sans être lancé : rien n\'est exécuté.');
}

module.exports = { principal };
