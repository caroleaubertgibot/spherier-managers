require('dotenv').config({ quiet: true });

const { Client } = require('@notionhq/client');
const { estUuidV4 } = require('./snapshot-v2.js');

// ===========================================================================
// Attribue un UUID et son lien aux fiches Clients qui n'en ont pas encore.
// ===========================================================================
//
// Un UUID de membre est le SEUL secret protégeant ses données : il n'y a ni compte
// ni mot de passe, le lien fait foi. Il doit donc être aléatoire et engendré par
// script — jamais saisi à la main, jamais dérivé d'un nom ou d'un numéro.
//
// Le script ne touche QUE les fiches sans UUID : relancer après avoir ajouté deux
// noms ne réattribue rien à ceux qui en ont déjà un. Un UUID réattribué couperait
// le membre de son historique.
//
// Chaque écriture est RELUE depuis Notion : on ne se fie pas au retour d'écriture.
//
//   SIMULATION=1 node uuid-clients.js   -> lister sans rien écrire
//   node uuid-clients.js

// AUCUN repli codé en dur, volontairement : dans le dépôt d'origine ces deux valeurs
// retombaient sur la base Clients et le site du club de dev. Lancé par mégarde sans
// environnement, le script y écrivait des UUID et fabriquait des liens vers le mauvais
// club. Ici elles sont obligatoires, et vérifiées au début de principal().
const DS_CLIENTS = process.env.DS_CLIENTS;
const SITE = process.env.SITE_SPHERIER;
const PAUSE_MS = 340;

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const SIMULATION = process.env.SIMULATION === '1';

const txt = (page, nom) => {
  const p = page.properties[nom];
  return ((p?.rich_text ?? p?.title ?? []).map((s) => s.plain_text).join('')).trim();
};

async function principal() {
  if (!process.env.NOTION_TOKEN) throw new Error('NOTION_TOKEN manquant');
  if (!DS_CLIENTS) throw new Error("DS_CLIENTS manquant (data source de la base Clients de l'instance managers)");
  if (!SITE) throw new Error('SITE_SPHERIER manquant (URL publique du sphérier managers)');

  let cursor, pages = [];
  do {
    const r = await notion.dataSources.query({ data_source_id: DS_CLIENTS, start_cursor: cursor, page_size: 100 });
    pages.push(...r.results);
    cursor = r.has_more ? r.next_cursor : null;
  } while (cursor);

  const aFaire = pages.filter((p) => !txt(p, 'UUID'));
  console.log(`base Clients : ${pages.length} fiche(s) · ${aFaire.length} sans UUID`);
  if (aFaire.length === 0) { console.log('  rien à faire'); return; }

  if (SIMULATION) {
    aFaire.forEach((p) => console.log(`  [simulation] ${txt(p, 'Name') || '(sans nom)'}`));
    return;
  }

  const faits = [];
  for (const page of aFaire) {
    const nom = txt(page, 'Name') || '(sans nom)';
    const uuid = require('crypto').randomUUID();
    // Garde-fou : le serveur refuse tout ce qui n'est pas un v4, autant le voir ici.
    if (!estUuidV4(uuid)) throw new Error('UUID engendré non conforme');
    const lien = `${SITE}/?c=${uuid}`;

    await notion.pages.update({
      page_id: page.id,
      properties: {
        UUID: { rich_text: [{ type: 'text', text: { content: uuid } }] },
        'Lien du sphérier': { url: lien },
      },
    });
    await dormir(PAUSE_MS);

    const relu = await notion.pages.retrieve({ page_id: page.id });
    const conforme = txt(relu, 'UUID') === uuid && relu.properties['Lien du sphérier']?.url === lien;
    if (!conforme) throw new Error(`${nom} : écriture non conforme à la relecture`);
    faits.push({ nom, uuid, lien });
    console.log(`  ${nom.padEnd(24)} écrit et relu, conforme`);
  }

  // Un doublon d'UUID ferait partager un sphérier à deux personnes.
  const tous = pages.map((p) => txt(p, 'UUID')).filter(Boolean).concat(faits.map((f) => f.uuid));
  const distincts = new Set(tous).size;
  console.log(`\n  ${tous.length} UUID en base · ${distincts} distincts` + (tous.length === distincts ? '  (aucun doublon)' : '  DOUBLON !'));
  if (tous.length !== distincts) process.exitCode = 1;

  // Vérification de bout en bout : chaque lien doit répondre sur un profil vierge.
  console.log('\n  contrôle des liens :');
  for (const f of faits) {
    let etat = null;
    for (let essai = 1; essai <= 3 && !etat; essai++) {
      const r = await fetch(`${SITE}/api/state?uuid=${f.uuid}`);
      if (r.status === 200) etat = await r.json();
      // Un 502 au premier appel est un démarrage à froid de la fonction, pas un défaut.
      else await dormir(2500);
    }
    if (!etat) { console.log(`  ${f.nom.padEnd(24)} INJOIGNABLE`); process.exitCode = 1; continue; }
    const niveaux = Object.values(etat.computed?.levels ?? {}).filter((v) => v > 0).length;
    const themes = Object.values(etat.computed?.themes ?? {});
    const eteintes = themes.filter((v) => v.illumination === 0).length;
    const ok = etat.snapshot === null && niveaux === 0 && themes.length > 0 && eteintes === themes.length;
    if (!ok) process.exitCode = 1;
    console.log(`  ${f.nom.padEnd(24)}${ok ? 'profil vierge' : 'ÉCART'} · ${themes.length} thématiques, toutes éteintes`);
  }

  console.log('\nLIENS\n');
  faits.forEach((f) => console.log(`${f.nom}\n  ${f.lien}\n`));
}

if (require.main === module) {
  principal().catch((err) => { console.error('ÉCHEC :', err.message); process.exit(1); });
} else {
  console.error('uuid-clients.js chargé sans être lancé : rien n\'est exécuté.');
}

module.exports = { principal };
