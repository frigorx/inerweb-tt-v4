/**
 * inerWeb TT 4.0 — Phase0_rotation.gs
 * Script de rotation sécurité — À exécuter UNE SEULE FOIS
 * Auteur : F. Henninot — Campus Equatio, Marseille
 *
 * ══════════════════════════════════════════════════════
 *  CE QUE FAIT CE SCRIPT
 * ══════════════════════════════════════════════════════
 *  1. Génère une nouvelle clé maître forte (format IFCA4-XXXX-XXXX-XXXX)
 *  2. L'écrit dans CONFIG sheet (colonne 'master_key')
 *  3. Régénère les tokens de TOUS les élèves (anciens DEMO* invalidés)
 *  4. Consigne la rotation dans le LOG (avec timestamp + ancien format masqué)
 *  5. Affiche la nouvelle clé maître à copier dans un endroit sûr
 *
 * ══════════════════════════════════════════════════════
 *  INSTRUCTIONS
 * ══════════════════════════════════════════════════════
 *  1. Ouvrir Apps Script du Google Sheet
 *  2. Ajouter ce fichier comme nouveau script
 *  3. Exécuter rotateAllKeys()
 *  4. NOTER la nouvelle clé maître affichée dans le Logger
 *  5. Mettre à jour ?key= dans l'URL de l'app prof
 *  6. Distribuer les nouveaux tokens aux élèves/tuteurs
 *
 * ══════════════════════════════════════════════════════
 *  SÉCURITÉ
 * ══════════════════════════════════════════════════════
 *  - Ce script peut être supprimé après exécution
 *  - La clé maître n'est JAMAIS visible dans Code.gs
 *  - Les anciens tokens DEMO* ne fonctionnent plus dès l'exécution
 */

const SHEET_ID_ROTATION = '1bmrZJKSg3eeo-tBhenK5KtErRFt1g8p-Uf_JVklpLfU';

// ═══════════════════════════════════════════════════
//  POINT D'ENTRÉE PRINCIPAL — lancer une seule fois
// ═══════════════════════════════════════════════════
function rotateAllKeys() {
  const ss  = SpreadsheetApp.openById(SHEET_ID_ROTATION);
  const now = new Date().toISOString();

  Logger.log('══════════════════════════════════════');
  Logger.log('▶ Phase 0 — Rotation des clés inerWeb TT 4.0');
  Logger.log('   ' + now);
  Logger.log('══════════════════════════════════════');

  // 1. Nouvelle clé maître
  const newMasterKey = generateMasterKey();
  Logger.log('');
  Logger.log('🔑 NOUVELLE CLÉ MAÎTRE GÉNÉRÉE');
  Logger.log('   ' + newMasterKey);
  Logger.log('   ⚠️  NOTER CETTE CLÉ — elle ne sera plus affichée');

  // 2. Mise à jour CONFIG sheet
  const cfgResult = updateConfigKey(ss, newMasterKey, now);
  Logger.log('');
  Logger.log('📋 CONFIG sheet : ' + cfgResult);

  // 3. Régénération tokens élèves
  const tokenResults = rotateStudentTokens(ss, now);
  Logger.log('');
  Logger.log('👨‍🎓 Tokens élèves régénérés : ' + tokenResults.length + ' élèves');
  tokenResults.forEach(r => {
    Logger.log('   ' + r.code + ' — ' + r.nom + ' ' + r.prenom);
    Logger.log('     Token élève  : ' + r.token_eleve);
    Logger.log('     Token tuteur : ' + r.token_tuteur);
  });

  // 4. Log d'audit
  logRotationAudit(ss, tokenResults.length, now);

  // 5. Résumé final
  Logger.log('');
  Logger.log('══════════════════════════════════════');
  Logger.log('✅ Phase 0 TERMINÉE — ' + now);
  Logger.log('');
  Logger.log('📋 RÉCAPITULATIF À CONSERVER :');
  Logger.log('   Clé maître  : ' + newMasterKey);
  Logger.log('   Nb élèves   : ' + tokenResults.length);
  Logger.log('   Date        : ' + now);
  Logger.log('══════════════════════════════════════');

  // Alerte UI avec la nouvelle clé
  const summary = tokenResults.map(r =>
    r.code + ' ' + r.nom + '\n  Élève : ' + r.token_eleve + '\n  Tuteur: ' + r.token_tuteur
  ).join('\n\n');

  SpreadsheetApp.getUi().alert(
    '✅ Phase 0 — Rotation terminée\n\n' +
    '🔑 CLÉ MAÎTRE (copier maintenant) :\n' +
    newMasterKey + '\n\n' +
    '👨‍🎓 Nouveaux tokens (' + tokenResults.length + ' élèves) :\n\n' +
    summary
  );
}

// ═══════════════════════════════════════════════════
//  [1] Génération de la nouvelle clé maître
// ═══════════════════════════════════════════════════
function generateMasterKey() {
  const chars = 'ABCDEFGHJKLMNPQRTUVWXYZ2346789';
  const seg   = (n) => Array.from({length: n}, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  // Format : IFCA4-XXXX-XXXX-XXXX (préfixe fixe pour identification)
  return 'IFCA4-' + seg(4) + '-' + seg(4) + '-' + seg(4);
}

// ═══════════════════════════════════════════════════
//  [2] Mise à jour onglet CONFIG
// ═══════════════════════════════════════════════════
function updateConfigKey(ss, newKey, now) {
  const sheet = ss.getSheetByName('CONFIG');
  if (!sheet) return 'ERREUR — Onglet CONFIG introuvable';

  const rows = sheet.getDataRange().getValues();
  let found  = false;

  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === 'master_key') {
      // Sauvegarde ancienne valeur masquée dans colonne C
      sheet.getRange(i + 1, 3).setValue('ROTATED-' + now.substring(0, 10));
      // Nouvelle valeur
      sheet.getRange(i + 1, 2).setValue(newKey);
      found = true;
      Logger.log('   Clé master_key mise à jour (ligne ' + (i + 1) + ')');
      break;
    }
  }

  if (!found) {
    // La clé n'existe pas encore dans CONFIG — on l'ajoute
    const lastRow = sheet.getLastRow() + 1;
    sheet.getRange(lastRow, 1).setValue('master_key');
    sheet.getRange(lastRow, 2).setValue(newKey);
    sheet.getRange(lastRow, 3).setValue('Ajouté Phase0 — ' + now.substring(0, 10));
    Logger.log('   Clé master_key AJOUTÉE (ligne ' + lastRow + ')');
  }

  // Mise à jour de la version
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === 'version') {
      sheet.getRange(i + 1, 2).setValue('TT-4.0');
      break;
    }
  }

  return 'OK';
}

// ═══════════════════════════════════════════════════
//  [3] Rotation des tokens de tous les élèves actifs
// ═══════════════════════════════════════════════════
function rotateStudentTokens(ss, now) {
  const sheet   = ss.getSheetByName('ELEVES');
  if (!sheet) {
    Logger.log('ERREUR — Onglet ELEVES introuvable');
    return [];
  }

  const rows    = sheet.getDataRange().getValues();
  const headers = rows[0];
  const iCode   = headers.indexOf('code');
  const iNom    = headers.indexOf('nom');
  const iPrenom = headers.indexOf('prenom');
  const iStatut = headers.indexOf('statut');
  const iTokE   = headers.indexOf('token_eleve');
  const iTokT   = headers.indexOf('token_tuteur');
  const iUpd    = headers.indexOf('updated_at');

  if (iTokE < 0 || iTokT < 0) {
    Logger.log('ERREUR — Colonnes token_eleve / token_tuteur introuvables');
    return [];
  }

  const results = [];

  for (let i = 1; i < rows.length; i++) {
    const statut = rows[i][iStatut] || '';
    const code   = rows[i][iCode]   || '';

    // On régénère pour actifs ET archivés (pour invalider les anciens tokens)
    if (!code) continue;

    const newTokE = generateToken();
    const newTokT = generateToken();

    sheet.getRange(i + 1, iTokE + 1).setValue(newTokE);
    sheet.getRange(i + 1, iTokT + 1).setValue(newTokT);
    if (iUpd >= 0) sheet.getRange(i + 1, iUpd + 1).setValue(now);

    results.push({
      code:         code,
      nom:          rows[i][iNom]    || '',
      prenom:       rows[i][iPrenom] || '',
      statut:       statut,
      token_eleve:  newTokE,
      token_tuteur: newTokT,
    });
  }

  return results;
}

// ═══════════════════════════════════════════════════
//  [4] Log d'audit de la rotation
// ═══════════════════════════════════════════════════
function logRotationAudit(ss, nbEleves, now) {
  const sheet = ss.getSheetByName('LOG');
  if (!sheet) return;

  sheet.appendRow([
    now,
    'ROTATION_SECURITE_PHASE0',
    'TOUS',
    'F. Henninot',
    'Rotation clé maître + ' + nbEleves + ' tokens élèves/tuteurs — Anciens tokens DEMO* invalidés',
    '',
  ]);
  Logger.log('   Log audit enregistré dans LOG sheet');
}

// ═══════════════════════════════════════════════════
//  UTILITAIRE — Génération token fort (même algo que Code.gs Phase 0)
// ═══════════════════════════════════════════════════
function generateToken() {
  const chars = 'ABCDEFGHJKLMNPQRTUVWXYZ2346789';
  const pick  = () => chars[Math.floor(Math.random() * chars.length)];
  const seg   = (n) => Array.from({length: n}, pick).join('');
  return seg(4) + '-' + seg(4) + '-' + seg(4);
}

// ═══════════════════════════════════════════════════
//  VÉRIFICATION — Peut être relancé sans danger
// ═══════════════════════════════════════════════════
function checkPhase0() {
  const ss    = SpreadsheetApp.openById(SHEET_ID_ROTATION);
  const sheet = ss.getSheetByName('CONFIG');
  if (!sheet) { Logger.log('CONFIG introuvable'); return; }

  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === 'master_key') {
      const key = rows[i][1];
      const isRotated = key && key.startsWith('IFCA4-');
      Logger.log(isRotated
        ? '✅ Phase 0 déjà effectuée — clé au format TT4 détectée'
        : '⚠️  Phase 0 NON effectuée — ancienne clé ou absente'
      );
      Logger.log('   Valeur actuelle : ' + (key ? key.substring(0, 8) + '...' : 'VIDE'));
      return;
    }
  }
  Logger.log('⚠️  Clé master_key absente de CONFIG — Phase 0 requise');
}
