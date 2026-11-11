require('dotenv').config({ quiet: true });

const { Client } = require('@notionhq/client');

// ===========================================================================
// Création des quatre bases Notion du sphérier.
// ===========================================================================
//
// À lancer UNE FOIS, sur un espace Notion vierge. Il crée Thèmes, Compétences,
// Ressources et Clients avec les noms de propriétés exacts que le code cherche —
// une faute de frappe sur un nom de propriété vide silencieusement le champ
// correspondant, sans message d'erreur.
//
// Utilisation :
//   1. Créer une intégration Notion dans votre espace, récupérer son jeton.
//   2. Créer une page vide qui accueillera les bases, et la PARTAGER avec
//      l'intégration (menu ••• > Connexions).
//   3. NOTION_TOKEN=... PAGE_PARENT=<id de la page> node creer-bases-notion.js
//      L'id de page se lit dans son URL : les 32 caractères après le dernier tiret.
//   4. Recopier les identifiants affichés à la fin dans les variables
//      d'environnement du site Netlify.
//
// Mode simulation, pour voir ce qui serait créé sans rien écrire :
//   SIMULATION=1 NOTION_TOKEN=... PAGE_PARENT=... node creer-bases-notion.js
//
// ---------------------------------------------------------------------------
// DEUX PIÈGES, appris à nos dépens sur le premier club.
//
// 1. UNE RELATION DUALE SE CRÉE EN UNE SEULE INSTRUCTION. Déclarer la relation
//    d'un côté puis l'autre produit DEUX paires orphelines, non synchronisées,
//    sans que rien ne le signale : on coche d'un côté, l'autre reste vide. Ce
//    script crée donc chaque relation duale en une fois, via `dual_property`.
//
// 2. LA RELATION RÉFLEXIVE « Nourrit / Nourri par » NE PEUT PAS être créée en
//    même temps que la base : elle pointe vers la base elle-même, qui n'existe
//    pas encore. Elle est donc ajoutée dans un second temps, une fois la base
//    Thèmes créée. Le script s'en charge — c'est la raison de l'étape 5.
// ---------------------------------------------------------------------------

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const SIMULATION = process.env.SIMULATION === '1';
const PARENT = (process.env.PAGE_PARENT || '').replace(/-/g, '');

const titre = (t) => ({ title: [{ type: 'text', text: { content: t } }] });

// Les noms de propriétés ci-dessous sont CONTRACTUELS : ce sont ceux que
// referentiel-v2.js cherche. Ne les changer que si l'on change aussi le code.
const THEMES = {
  Name: { title: {} },
  Code: { rich_text: {} },
  DefinitionThematique: { rich_text: {} },
  // Les options de `Dimension` doivent correspondre EXACTEMENT aux `name` des
  // dimensions déclarées dans club.config.js.
  Dimension: { select: { options: [] } },
  'Position X': { number: { format: 'number' } },
  'Position Y': { number: { format: 'number' } },
  Ordre: { number: { format: 'number' } },
  // Surcharge facultative du seuil d'ouverture. Vide = calcul automatique,
  // min(4, max(1, floor(n/2))). Renseignée, c'est elle qui fait foi : elle sert aux
  // thématiques très denses, qu'un seuil calculé rendrait trop longues à ouvrir.
  Seuil: { number: { format: 'number' } },
  Actif: { checkbox: {} },
};

const COMPETENCES = (idThemes) => ({
  Name: { title: {} },
  Code: { rich_text: {} },
  Description: { rich_text: {} },
  'Énoncé N1': { rich_text: {} },
  'Énoncé N2': { rich_text: {} },
  'Énoncé N3': { rich_text: {} },
  // Les noms d'options doivent correspondre aux `nom` de DIFFICULTES dans
  // club.config.js. Renommer une option depuis l'interface Notion en
  // redéfinissant la liste EFFACE toutes les valeurs assignées : passer par
  // l'API et l'identifiant de l'option.
  'Difficulté': {
    select: {
      options: [
        { name: 'Accessible', color: 'green' },
        { name: 'Exigeant', color: 'orange' },
      ],
    },
  },
  Ordre: { number: { format: 'number' } },
  Actif: { checkbox: {} },
  // Relation duale, créée en UNE instruction — voir le piège 1.
  '📚 Thèmes': {
    relation: {
      data_source_id: idThemes,
      type: 'dual_property',
      dual_property: { synced_property_name: '⚒️ Compétences' },
    },
  },
});

const RESSOURCES = (idThemes, idCompetences) => ({
  Name: { title: {} },
  Type: { multi_select: { options: [] } },
  URL: { url: {} },
  Actif: { checkbox: {} },
  '📚 Thèmes': {
    relation: {
      data_source_id: idThemes,
      type: 'dual_property',
      dual_property: { synced_property_name: '📋 Ressources' },
    },
  },
  '⚒️ Compétences': {
    relation: {
      data_source_id: idCompetences,
      type: 'dual_property',
      dual_property: { synced_property_name: '📋 Ressources' },
    },
  },
});

// La base Clients n'est pas lue par l'application : elle sert au pilote du club
// à retrouver quel membre porte quel UUID, et à lui envoyer son lien.
// L'UUID doit être ALÉATOIRE : c'est le seul secret qui protège les données du
// membre. Jamais « membre-01 ».
const CLIENTS = {
  Name: { title: {} },
  UUID: { rich_text: {} },
  'Lien du sphérier': { url: {} },
  Actif: { checkbox: {} },
};

async function creerBase(nom) {
  if (SIMULATION) {
    console.log(`  [simulation] création de la base ${nom}`);
    return { id: `SIMULATION_${nom}`, dsId: `SIMULATION_DS_${nom}` };
  }
  const base = await notion.databases.create({
    parent: { type: 'page_id', page_id: PARENT },
    title: titre(nom).title,
  });
  const complet = await notion.databases.retrieve({ database_id: base.id });
  const dsId = complet.data_sources[0].id;
  console.log(`  ${nom} créée · database ${base.id}`);
  return { id: base.id, dsId };
}

// Les propriétés se posent sur la DATA SOURCE, jamais à la création de la base.
//
// Depuis l'API 2025-09-03, `databases.create` IGNORE le paramètre `properties` : le SDK
// le signale par un avertissement, pas par une erreur, et l'on se retrouve avec quatre
// bases ne portant que leur titre. C'est arrivé. Le seul chemin fiable est
// `dataSources.update`, et il est vérifié ci-dessous plutôt que supposé.
async function poserProprietes(dsId, proprietes, nom) {
  if (SIMULATION) {
    console.log(`  [simulation] ${nom} : ${Object.keys(proprietes).join(', ')}`);
    return;
  }
  await notion.dataSources.update({ data_source_id: dsId, properties: proprietes });
  const relu = await notion.dataSources.retrieve({ data_source_id: dsId });
  const manquantes = Object.keys(proprietes).filter((k) => !relu.properties[k]);
  if (manquantes.length) throw new Error(`${nom} : propriétés non posées — ${manquantes.join(', ')}`);
  console.log(`  ${nom} : ${Object.keys(relu.properties).length} propriétés posées`);
}

async function principal() {
  if (!process.env.NOTION_TOKEN) throw new Error('NOTION_TOKEN manquant');
  if (!PARENT) throw new Error('PAGE_PARENT manquant (id de la page qui accueille les bases)');

  console.log(SIMULATION ? '=== SIMULATION — aucune écriture ===\n' : '=== Création des bases ===\n');

  // 1. Les quatre bases, vides. L'ordre importe : les relations posées ensuite
  //    référencent les data sources des autres.
  const themes = await creerBase('📚 Thèmes');
  const competences = await creerBase('⚒️ Compétences');
  const ressources = await creerBase('📋 Ressources');
  const clients = await creerBase('Clients');

  console.log('');

  // 2. Les propriétés. Chaque relation duale est créée en UNE instruction : la créer
  //    en deux fois produit deux paires orphelines non synchronisées, sans signal.
  await poserProprietes(themes.dsId, THEMES, '📚 Thèmes');
  await poserProprietes(competences.dsId, COMPETENCES(themes.dsId), '⚒️ Compétences');
  await poserProprietes(ressources.dsId, RESSOURCES(themes.dsId, competences.dsId), '📋 Ressources');
  await poserProprietes(clients.dsId, CLIENTS, 'Clients');

  // 3. La relation réflexive de Thèmes, en dernier : elle pointe vers sa propre base.
  await poserProprietes(themes.dsId, {
    Nourrit: {
      relation: {
        data_source_id: themes.dsId,
        type: 'dual_property',
        dual_property: { synced_property_name: 'Nourri par' },
      },
    },
  }, '📚 Thèmes (Nourrit)');

  if (SIMULATION) return;

  console.log('\n=== À reporter dans les variables d\'environnement Netlify ===');
  console.log(`DB_THEMES=${themes.id}`);
  console.log(`DB_COMPETENCES=${competences.id}`);
  console.log(`DB_RESSOURCES=${ressources.id}`);
  console.log('\nEt à faire ensuite, à la main :');
  console.log('  1. Renseigner les options du select `Dimension` de la base Thèmes,');
  console.log('     avec EXACTEMENT les `name` déclarés dans club.config.js.');
  console.log('  2. Vérifier que les quatre bases sont bien partagées avec l\'intégration.');
  console.log('     Créées sous une page connectée, elles en héritent normalement.');
}

// Ce script CRÉE des bases : il ne doit partir que lancé explicitement, jamais parce
// qu'un outil l'a chargé. Un script à effet de bord qui s'exécute au `require` nous a
// déjà coûté une purge complète du référentiel.
if (require.main === module) {
  principal().catch((err) => {
    console.error('ÉCHEC :', err.message);
    process.exit(1);
  });
} else {
  console.error('creer-bases-notion.js chargé sans être lancé : rien n\'est exécuté.');
}

module.exports = { principal };
