const clean = value => String(value ?? '').replace(/[\r\n]+/g, ' ').trim();

const stageLine = (current, total, label) => `[${current}/${total}] ${clean(label)}`;
const infoLine = (label, value = '') => `  • ${clean(label)}${value === '' || value === null || value === undefined ? '' : ` : ${clean(value)}`}`;
const doneLine = (label, seconds) => `  ✓ ${clean(label)}${Number.isFinite(seconds) ? ` · ${seconds} s` : ''}`;

const progressLine = (label, processed, total, title = '') => {
  const percent = total ? Math.min(100, Math.round(processed * 100 / total)) : 0;
  return `  ${clean(label)}  ${processed}/${total} (${percent} %)${title ? ` · ${clean(title)}` : ''}`;
};

const progressBucket = (processed, total) => total ? Math.min(20, Math.floor(processed * 20 / total)) : 0;

const fullStages = [
  'Préparation',
  'Connexion à WikiMasters',
  'Ouverture des boosters',
  'Étiquetage des cartes sans étiquette',
  'Nettoyage de l’étiquette « à trier »'
];

const stagesFor = ({ wishlistOnly = false, wishlistSync = false, apply = false } = {}) => {
  const stages = wishlistOnly ? fullStages.slice(0, 2) : [...fullStages];
  if (wishlistOnly || wishlistSync) stages.push('Analyse des cartes #Osef', `${apply ? 'Application' : 'Audit'} et rapport`);
  return stages;
};

module.exports = { stageLine, infoLine, doneLine, progressLine, progressBucket, fullStages, stagesFor };
