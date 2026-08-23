const success = /^(?:Terminé|Aucun nouveau pack trouvé|Collection vérifiée|Nettoyage terminé|Comptage osef terminé|Inventaire osef terminé|Souhaits synchronisés) · \d+ pack\(s\), \d+ carte\(s\)$/i;

module.exports = status => success.test(String(status || ''));
