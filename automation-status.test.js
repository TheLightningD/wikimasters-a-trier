const assert = require('node:assert/strict');
const isSuccessfulAutomationStatus = require('./automation-status');

for (const status of [
  'Terminé · 2 pack(s), 6 carte(s)',
  'Collection vérifiée · 0 pack(s), 2 carte(s)',
  'Nettoyage terminé · 0 pack(s), 1 carte(s)',
  'Souhaits synchronisés · 0 pack(s), 10 carte(s)'
]) assert.equal(isSuccessfulAutomationStatus(status), true, status);

for (const status of [
  'Bouton « Terminé » introuvable après l’étiquetage',
  'Terminé · échec',
  'Collection vérifiée · erreur',
  'Pack étiqueté, mais bouton de fin introuvable',
  'La carte suivante du pack ne charge pas'
]) assert.equal(isSuccessfulAutomationStatus(status), false, status);

console.log('automation status: ok');
