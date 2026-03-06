/**
 * inerWeb TT 4.7 — Code.gs
 * API Google Apps Script — Backend unifié CCF + Stage + Élève
 * Auteur : F. Henninot — Campus Equatio, Marseille
 *
 * ═══ CHANGELOG v4.7 ═══
 * [ELEVE-1] verifyEleveToken() — Connexion élève avec token
 * [ELEVE-2] getEleveData() — Récupère progression + infos stage
 * [ELEVE-3] addJournalEntry() amélioré — Support photos base64
 * [ELEVE-4] getJournalForEleve() — Journal filtré pour élève
 * [CRIT-1]  Nouvel onglet CUSTOM_CRITERIA — Critères perso par élève
 * [CRIT-2]  getCustomCriteria() / saveCustomCriteria()
 * [ALERT-1] getAlertes() — Élèves sans activité journal
 *
 * RADIOGUIDAGE :
 * [A] Config & constantes
 * [B] Point d'entrée HTTP (doGet)
 * [C] Auth
 * [D] Élèves (CRUD)
 * [E] Validations EP2/EP3
 * [F] Notes
 * [G] Journal PFMP (avec photos)
 * [H] Évaluation tuteur
 * [I] Critères personnalisés
 * [J] Alertes
 * [K] Utilitaires Sheet
 * [L] Utilitaires généraux
 */

// ═══ [A] CONFIG ═══
const SHEET_ID = '1bmrZJKSg3eeo-tBhenK5KtErRFt1g8p-Uf_JVklpLfU';

const MASTER_KEY_LEGACY = 'IFCA-2026-PROF-FH13013';

const SH = {
  ELEVES:          'ELEVES',
  VALIDATIONS:     'VALIDATIONS',
  NOTES:           'NOTES',
  JOURNAL:         'PFMP_JOURNAL',
  EVAL_TUTEUR:     'PFMP_EVAL',
  CUSTOM_CRITERIA: 'CUSTOM_CRITERIA',
  CONFIG:          'CONFIG',
  LOG:             'LOG',
};

let _masterKeyCache = null;

function getMasterKey() {
  if (_masterKeyCache) return _masterKeyCache;
  try {
    const ss    = SpreadsheetApp.openById(SHEET_ID);
    const sheet = ss.getSheetByName(SH.CONFIG);
    if (sheet) {
      const rows = sheet.getDataRange().getValues();
      for (let i = 1; i < rows.length; i++) {
        if (rows[i][0] === 'master_key' && rows[i][1]) {
          _masterKeyCache = String(rows[i][1]).trim();
          return _masterKeyCache;
        }
      }
    }
  } catch (e) {
    Logger.log('[getMasterKey] Fallback legacy : ' + e.message);
  }
  _masterKeyCache = MASTER_KEY_LEGACY;
  return _masterKeyCache;
}

// ═══ [B] POINT D'ENTRÉE HTTP ═══
function doGet(e) {
  _masterKeyCache = null;

  const p   = e.parameter || {};
  const out = (data) => ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);

  try {
    const action = p.action || '';
    
    // Actions publiques (sans auth complète)
    if (action === 'verifyEleveToken') {
      return out(verifyEleveToken(p.token));
    }
    if (action === 'verifyTuteurToken') {
      return out(verifyTuteurToken(p.eleve, p.tuteur));
    }
    if (action === 'ping') {
      return out({ ok: true, version: 'TT-4.8', ts: new Date().toISOString() });
    }

    const role = auth(p);
    if (!role) return out({ error: 'Accès refusé', code: 403 });

    logAction(action, p.eleve || '', role.qui);

    switch (action) {

      // ═══ ÉLÈVES ═══
      case 'getDashboard':         return out(getDashboard());
      case 'getEleve':             return out(getEleve(p.eleve));
      case 'addEleve':             return out(addEleve(JSON.parse(p.data || '{}')));
      case 'updateEleve':          return out(updateEleve(p.eleve, JSON.parse(p.data || '{}')));
      case 'deleteEleve':          return out(deleteEleve(p.eleve));
      case 'getEleveData':         return out(getEleveData(p.eleve));

      // ═══ VALIDATIONS EP2/EP3 ═══
      case 'getValidations':       return out(getValidations(p.eleve));
      case 'saveValidation':       return out(saveValidation(p.eleve, JSON.parse(p.data || '{}')));
      case 'deleteValidation':     return out(deleteValidation(p.id));

      // ═══ NOTES ═══
      case 'getNotes':             return out(getNotes(p.eleve));
      case 'saveNote':             return out(saveNote(p.eleve, JSON.parse(p.data || '{}')));
      case 'cloturerEpreuve':      return out(cloturerEpreuve(p.eleve, JSON.parse(p.data || '{}')));
      case 'deverrouillerEpreuve': return out(deverrouillerEpreuve(p.eleve, JSON.parse(p.data || '{}')));

      // ═══ JOURNAL PFMP ═══
      case 'getJournal':           return out(getJournal(p.eleve));
      case 'addJournalEntry':      return out(addJournalEntry(p.eleve, JSON.parse(p.entry || p.data || '{}')));
      case 'deleteJournalEntry':   return out(deleteJournalEntry(p.id, role));

      // ═══ ÉVALUATION TUTEUR ═══
      case 'getEvalTuteur':        return out(getEvalTuteur(p.eleve, p.pfmp));
      case 'saveEvalTuteur':       return out(saveEvalTuteur(p.eleve, JSON.parse(p.data || '{}')));

      // ═══ CRITÈRES PERSONNALISÉS ═══
      case 'getCustomCriteria':    return out(getCustomCriteria(p.eleve));
      case 'saveCustomCriteria':   return out(saveCustomCriteria(p.eleve, JSON.parse(p.data || '{}')));

      // ═══ ALERTES ═══
      case 'getAlertes':           return out(getAlertes());

      default: return out({ error: 'Action inconnue : ' + action, code: 400 });
    }

  } catch (err) {
    Logger.log('ERREUR doGet : ' + err.message);
    return ContentService
      .createTextOutput(JSON.stringify({ error: err.message, code: 500 }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// ═══ [C] AUTH ═══
function auth(p) {
  const key = p.key || '';

  // Prof avec master key
  if (key === getMasterKey()) return { role: 'prof', qui: 'prof' };

  // Élève avec token
  if (p.token) {
    const eleve = findEleveByToken(p.token);
    if (eleve) return { role: 'eleve', qui: eleve.code };
  }

  // Élève avec code + token
  if (p.eleve && p.token) {
    const row = findEleve(p.eleve);
    if (row && row.token_eleve === p.token) return { role: 'eleve', qui: p.eleve };
  }

  // Tuteur avec token_tuteur
  if (p.eleve && p.tuteur) {
    const row = findEleve(p.eleve);
    if (row && row.token_tuteur === p.tuteur) return { role: 'tuteur', qui: 'tuteur-' + p.eleve };
  }

  return null;
}

// ═══ [ELEVE-1] VÉRIFICATION TOKEN ÉLÈVE ═══
function verifyEleveToken(token) {
  if (!token) return { success: false, error: 'Token manquant' };
  
  const eleve = findEleveByToken(token);
  if (!eleve) return { success: false, error: 'Token invalide' };
  
  // Récupérer les évaluations pour calculer la progression
  const validations = getValidations(eleve.code);
  const evals = { EP2: {}, EP3: {} };
  
  validations.forEach(v => {
    if (v.epreuve && v.competence && v.niveau && !v.critere) {
      evals[v.epreuve] = evals[v.epreuve] || {};
      evals[v.epreuve][v.competence] = v.niveau;
    }
  });
  
  // Récupérer le journal
  const journal = getJournal(eleve.code);
  
  return {
    success: true,
    eleve: {
      code: eleve.code,
      nom: eleve.nom,
      prenom: eleve.prenom,
      classe: eleve.classe,
      entreprise_nom: eleve.pfmp1_entreprise || eleve.pfmp2_entreprise || '',
      tuteur_nom: eleve.pfmp1_tuteur_nom || eleve.pfmp2_tuteur_nom || '',
      pfmp_debut: eleve.pfmp1_date_debut || eleve.pfmp2_date_debut || '',
      pfmp_fin: eleve.pfmp1_date_fin || eleve.pfmp2_date_fin || '',
    },
    evals: evals,
    journal: journal.map(j => ({
      id: j.id,
      date: j.date || j.timestamp,
      type: j.type || 'activite',
      text: j.description || j.activite || '',
      photos: j.photos ? (typeof j.photos === 'string' ? JSON.parse(j.photos) : j.photos) : [],
      synced: true
    }))
  };
}

function findEleveByToken(token) {
  const rows = getSheetData(SH.ELEVES);
  return rows.find(r => r.token_eleve === token) || null;
}

// ═══ [TUTEUR-1] VÉRIFICATION TOKEN TUTEUR ═══
function verifyTuteurToken(eleveCode, tuteurToken) {
  if (!eleveCode || !tuteurToken) {
    return { success: false, error: 'Paramètres manquants (eleve + tuteur requis)' };
  }
  
  const eleve = findEleve(eleveCode);
  if (!eleve) {
    return { success: false, error: 'Élève introuvable : ' + eleveCode };
  }
  
  // Vérifier le token tuteur
  if (eleve.token_tuteur !== tuteurToken) {
    return { success: false, error: 'Token tuteur invalide' };
  }
  
  // Token OK — renvoyer les infos élève (sans données sensibles)
  return {
    success: true,
    eleve: {
      code: eleve.code,
      nom: eleve.nom,
      prenom: eleve.prenom,
      classe: eleve.classe,
      entreprise_nom: eleve.pfmp1_entreprise || eleve.pfmp2_entreprise || '',
      tuteur_nom: eleve.pfmp1_tuteur_nom || eleve.pfmp2_tuteur_nom || '',
      pfmp_debut: eleve.pfmp1_date_debut || eleve.pfmp2_date_debut || '',
      pfmp_fin: eleve.pfmp1_date_fin || eleve.pfmp2_date_fin || '',
    },
    // Récupérer les évaluations tuteur existantes
    evalTuteur: getEvalTuteur(eleveCode)
  };
}

// ═══ [ELEVE-2] DONNÉES ÉLÈVE COMPLÈTES ═══
function getEleveData(code) {
  const eleve = findEleve(code);
  if (!eleve) return { error: 'Élève introuvable' };
  
  const validations = getValidations(code);
  const notes = getNotes(code);
  const journal = getJournal(code);
  const evalTuteur = getEvalTuteur(code);
  
  return {
    eleve,
    validations,
    notes,
    journal,
    evalTuteur
  };
}

// ═══ [D] ÉLÈVES ═══
function getDashboard() {
  const rows = getSheetData(SH.ELEVES);
  return rows.filter(r => r.statut !== 'archive').map(r => ({
    code:           r.code,
    nom:            r.nom,
    prenom:         r.prenom,
    classe:         r.classe,
    referentiel:    r.referentiel,
    statut:         r.statut,
    token_eleve:    r.token_eleve,
    token_tuteur:   r.token_tuteur,
    pfmp1_sem:      r.pfmp1_sem,
    pfmp2_sem:      r.pfmp2_sem,
    entreprise_nom: r.pfmp1_entreprise || r.pfmp2_entreprise || '',
    tuteur_nom:     r.pfmp1_tuteur_nom || r.pfmp2_tuteur_nom  || '',
    tuteur_email:   r.pfmp1_tuteur_email || '',
    derniere_eval:  r.derniere_eval || '',
    alerte:         r.alerte || '',
  }));
}

function getEleve(code) {
  const row = findEleve(code);
  if (!row) return { error: 'Élève introuvable : ' + code };
  return row;
}

function addEleve(data) {
  const ss    = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName(SH.ELEVES);
  const rows  = getSheetData(SH.ELEVES);

  const exists = rows.find(r => r.nom === data.nom && r.prenom === data.prenom);
  if (exists) return { error: 'Élève déjà existant', code: exists.code };

  const nums = rows.map(r => parseInt((r.code || '').replace('ELV-', '')) || 0);
  const next = (Math.max(0, ...nums) + 1).toString().padStart(3, '0');
  const code = 'ELV-' + next;

  const now = new Date().toISOString();
  const row = [
    code,
    (data.nom || '').toUpperCase(),
    data.prenom || '',
    data.classe || 'CAP IFCA 1',
    data.referentiel || 'CAP_IFCA',
    'actif',
    genToken(),  // token_eleve
    genToken(),  // token_tuteur
    data.pfmp1_sem || 3,
    data.pfmp2_sem || 3,
    data.pfmp1_entreprise || '', data.pfmp1_secteur || '',
    data.pfmp1_tuteur_nom || '', data.pfmp1_tuteur_fonction || '',
    data.pfmp1_tuteur_email || '', data.pfmp1_tuteur_tel || '',
    data.pfmp1_date_debut || '', data.pfmp1_date_fin || '',
    'non_envoye',
    data.pfmp2_entreprise || '', data.pfmp2_secteur || '',
    data.pfmp2_tuteur_nom || '', data.pfmp2_tuteur_fonction || '',
    data.pfmp2_tuteur_email || '', data.pfmp2_tuteur_tel || '',
    data.pfmp2_date_debut || '', data.pfmp2_date_fin || '',
    'non_envoye',
    '', '', now, now,
  ];

  sheet.appendRow(row);
  return { ok: true, code, token_eleve: row[6], token_tuteur: row[7] };
}

function updateEleve(code, data) {
  const ss      = SpreadsheetApp.openById(SHEET_ID);
  const sheet   = ss.getSheetByName(SH.ELEVES);
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const rows    = sheet.getDataRange().getValues();

  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === code) {
      Object.entries(data).forEach(([key, val]) => {
        const col = headers.indexOf(key);
        if (col >= 0) sheet.getRange(i + 1, col + 1).setValue(val);
      });
      const updCol = headers.indexOf('updated_at');
      if (updCol >= 0) sheet.getRange(i + 1, updCol + 1).setValue(new Date().toISOString());
      return { ok: true, code };
    }
  }
  return { error: 'Élève introuvable : ' + code };
}

function deleteEleve(code) {
  return updateEleve(code, { statut: 'archive' });
}

// ═══ [E] VALIDATIONS EP2/EP3 ═══
function getValidations(code) {
  const rows = getSheetData(SH.VALIDATIONS);
  return rows.filter(r => r.eleve === code);
}

function saveValidation(code, data) {
  const ss    = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName(SH.VALIDATIONS);
  const id    = data.id || uuid();
  const now   = data.timestamp || new Date().toISOString();

  sheet.appendRow([
    id, code,
    data.epreuve    || '',
    data.competence || '',
    data.critere    || '',
    data.niveau     || '',
    data.contexte   || '',
    data.phase      || 'formatif',
    data.evaluateur || '',
    now,
    data.session    || '2026',
    true,
  ]);

  updateEleve(code, { derniere_eval: now });
  return { ok: true, id };
}

function deleteValidation(id) {
  const ss    = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName(SH.VALIDATIONS);
  const rows  = sheet.getDataRange().getValues();

  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === id) {
      sheet.deleteRow(i + 1);
      return { ok: true };
    }
  }
  return { error: 'Validation introuvable : ' + id };
}

// ═══ [F] NOTES ═══
function getNotes(code) {
  const rows = getSheetData(SH.NOTES);
  return rows.filter(r => r.eleve === code);
}

function saveNote(code, data) {
  const ss    = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName(SH.NOTES);
  const rows  = sheet.getDataRange().getValues();
  const hdrs  = rows[0];
  const now   = new Date().toISOString();

  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === code && rows[i][1] === data.epreuve) {
      if (data.note_proposee !== undefined) sheet.getRange(i+1, hdrs.indexOf('note_proposee')+1).setValue(data.note_proposee);
      if (data.note_finale   !== undefined) sheet.getRange(i+1, hdrs.indexOf('note_finale')+1).setValue(data.note_finale);
      if (data.eligible      !== undefined) sheet.getRange(i+1, hdrs.indexOf('eligible')+1).setValue(data.eligible);
      sheet.getRange(i+1, hdrs.indexOf('timestamp')+1).setValue(now);
      return { ok: true, updated: true };
    }
  }

  sheet.appendRow([
    code, data.epreuve || '',
    data.note_proposee || '', data.note_finale || '',
    data.eligible || false, false, '', '',
    data.evaluateur || '', now,
  ]);
  return { ok: true, created: true };
}

function cloturerEpreuve(code, data) {
  const ss    = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName(SH.NOTES);
  const rows  = sheet.getDataRange().getValues();
  const hdrs  = rows[0];
  const now   = new Date().toISOString();

  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === code && rows[i][1] === data.epreuve) {
      sheet.getRange(i+1, hdrs.indexOf('cloture')+1).setValue(true);
      sheet.getRange(i+1, hdrs.indexOf('date_cloture')+1).setValue(now);
      sheet.getRange(i+1, hdrs.indexOf('evaluateur')+1).setValue(data.evaluateur || '');
      sheet.getRange(i+1, hdrs.indexOf('note_proposee')+1).setValue(data.note_proposee || '');
      sheet.getRange(i+1, hdrs.indexOf('eligible')+1).setValue(data.eligible || false);
      return { ok: true };
    }
  }
  sheet.appendRow([code, data.epreuve, data.note_proposee||'', '', data.eligible||false, true, now, '', data.evaluateur||'', now]);
  return { ok: true, created: true };
}

function deverrouillerEpreuve(code, data) {
  const ss    = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName(SH.NOTES);
  const rows  = sheet.getDataRange().getValues();
  const hdrs  = rows[0];

  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === code && rows[i][1] === data.epreuve) {
      sheet.getRange(i+1, hdrs.indexOf('cloture')+1).setValue(false);
      sheet.getRange(i+1, hdrs.indexOf('motif_devrouillage')+1).setValue(data.motif || '');
      return { ok: true };
    }
  }
  return { error: 'Note introuvable pour déverrouillage' };
}

// ═══ [G] JOURNAL PFMP (AVEC PHOTOS) ═══
function getJournal(code) {
  const rows = getSheetData(SH.JOURNAL);
  return rows.filter(r => r.eleve === code).map(r => ({
    id: r.id,
    eleve: r.eleve,
    pfmp: r.pfmp,
    date: r.date,
    type: r.type || 'activite',
    activite: r.activite,
    description: r.description,
    text: r.description || r.activite || '',
    competences: r.competences ? (typeof r.competences === 'string' ? JSON.parse(r.competences || '[]') : r.competences) : [],
    photos: r.photos ? (typeof r.photos === 'string' ? JSON.parse(r.photos || '[]') : r.photos) : [],
    humeur: r.humeur,
    valide_prof: r.valide_prof,
    timestamp: r.timestamp
  }));
}

function addJournalEntry(code, data) {
  const ss    = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName(SH.JOURNAL);
  const now   = new Date().toISOString();
  const id    = data.id || uuid();

  // Gérer les photos (array de base64)
  let photos = [];
  if (data.photos && Array.isArray(data.photos)) {
    photos = data.photos;
  }

  sheet.appendRow([
    id, 
    code,
    data.pfmp        || 1,
    data.date        || now.split('T')[0],
    data.type        || 'activite',
    data.activite    || data.text || '',
    data.description || data.text || '',
    JSON.stringify(data.competences || []),
    JSON.stringify(photos),  // Photos stockées en JSON
    data.humeur      || '',
    false, 
    now,
  ]);
  
  return { ok: true, id };
}

function deleteJournalEntry(id, role) {
  // Seul le prof peut supprimer
  if (role.role !== 'prof') return { error: 'Non autorisé' };
  
  const ss    = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName(SH.JOURNAL);
  const rows  = sheet.getDataRange().getValues();

  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === id) {
      sheet.deleteRow(i + 1);
      return { ok: true };
    }
  }
  return { error: 'Entrée introuvable : ' + id };
}

// ═══ [H] ÉVALUATION TUTEUR ═══
function getEvalTuteur(code, pfmp) {
  const rows = getSheetData(SH.EVAL_TUTEUR);
  return rows.filter(r => r.eleve === code && (!pfmp || String(r.pfmp) === String(pfmp)));
}

function saveEvalTuteur(code, data) {
  const ss    = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName(SH.EVAL_TUTEUR);
  const rows  = sheet.getDataRange().getValues();
  const hdrs  = rows[0];
  const now   = new Date().toISOString();

  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === code && String(rows[i][2]) === String(data.pfmp || 1)) {
      Object.entries(data).forEach(([key, val]) => {
        const col = hdrs.indexOf(key);
        if (col >= 0) sheet.getRange(i+1, col+1).setValue(typeof val === 'object' ? JSON.stringify(val) : val);
      });
      sheet.getRange(i+1, hdrs.indexOf('timestamp')+1).setValue(now);
      return { ok: true, updated: true };
    }
  }

  const newRow = hdrs.map(h => {
    if (h === 'id')        return uuid();
    if (h === 'eleve')     return code;
    if (h === 'timestamp') return now;
    const v = data[h];
    return v !== undefined ? (typeof v === 'object' ? JSON.stringify(v) : v) : '';
  });
  sheet.appendRow(newRow);

  const pfmpKey = 'pfmp' + (data.pfmp || 1) + '_statut_doc';
  updateEleve(code, { [pfmpKey]: data.doc_statut || 'soumis' });

  return { ok: true, created: true };
}

// ═══ [I] CRITÈRES PERSONNALISÉS ═══
function getCustomCriteria(code) {
  ensureSheet(SH.CUSTOM_CRITERIA, ['eleve', 'epreuve', 'competence', 'critere', 'timestamp']);
  const rows = getSheetData(SH.CUSTOM_CRITERIA);
  const result = {};
  
  rows.filter(r => r.eleve === code).forEach(r => {
    if (!result[r.epreuve]) result[r.epreuve] = {};
    if (!result[r.epreuve][r.competence]) result[r.epreuve][r.competence] = [];
    result[r.epreuve][r.competence].push(r.critere);
  });
  
  return result;
}

function saveCustomCriteria(code, data) {
  ensureSheet(SH.CUSTOM_CRITERIA, ['eleve', 'epreuve', 'competence', 'critere', 'timestamp']);
  const ss    = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName(SH.CUSTOM_CRITERIA);
  const now   = new Date().toISOString();
  
  // data = { EP2: { C3.1: ['critère1', 'critère2'] }, EP3: { ... } }
  Object.entries(data).forEach(([ep, comps]) => {
    Object.entries(comps).forEach(([comp, crits]) => {
      crits.forEach(crit => {
        // Vérifier si existe déjà
        const rows = getSheetData(SH.CUSTOM_CRITERIA);
        const exists = rows.find(r => r.eleve === code && r.epreuve === ep && r.competence === comp && r.critere === crit);
        if (!exists) {
          sheet.appendRow([code, ep, comp, crit, now]);
        }
      });
    });
  });
  
  return { ok: true };
}

// ═══ [J] ALERTES ═══
function getAlertes() {
  const eleves = getDashboard();
  const alertes = [];
  const now = new Date();
  
  eleves.forEach(e => {
    const journal = getJournal(e.code);
    
    if (journal.length === 0) {
      alertes.push({
        code: e.code,
        nom: e.nom,
        prenom: e.prenom,
        type: 'no_journal',
        message: 'Aucune entrée de journal',
        daysSince: null
      });
      return;
    }
    
    // Trouver la dernière entrée
    const sorted = journal.sort((a, b) => new Date(b.date || b.timestamp) - new Date(a.date || a.timestamp));
    const last = sorted[0];
    const lastDate = new Date(last.date || last.timestamp);
    const daysSince = Math.floor((now - lastDate) / (1000 * 60 * 60 * 24));
    
    if (daysSince >= 5) {
      alertes.push({
        code: e.code,
        nom: e.nom,
        prenom: e.prenom,
        type: 'inactive',
        message: `${daysSince} jours sans activité`,
        daysSince: daysSince
      });
    }
  });
  
  return alertes.sort((a, b) => (b.daysSince || 999) - (a.daysSince || 999));
}

// ═══ [K] UTILITAIRES SHEET ═══
function getSheetData(sheetName) {
  const ss    = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) return [];
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];
  const headers = data[0];
  return data.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = row[i]; });
    return obj;
  });
}

function findEleve(code) {
  const rows = getSheetData(SH.ELEVES);
  return rows.find(r => r.code === code) || null;
}

function ensureSheet(name, headers) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(headers);
  }
  return sheet;
}

function logAction(action, eleve, qui) {
  try {
    const ss    = SpreadsheetApp.openById(SHEET_ID);
    const sheet = ss.getSheetByName(SH.LOG);
    if (sheet) sheet.appendRow([new Date(), action, eleve, qui, '', '']);
  } catch(e) { /* Log non bloquant */ }
}

// ═══ [L] UTILITAIRES GÉNÉRAUX ═══
function genToken() {
  const chars = 'ABCDEFGHJKLMNPQRTUVWXYZ2346789';
  const pick  = () => chars[Math.floor(Math.random() * chars.length)];
  const seg   = (n) => Array.from({length: n}, pick).join('');
  return seg(4) + '-' + seg(4) + '-' + seg(4);
}

function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

// ═══ TESTS LOCAUX ═══
function testAPI() {
  const fakeE = { parameter: { key: getMasterKey(), action: 'getDashboard' } };
  Logger.log(doGet(fakeE).getContent());
}

function testPing() {
  const fakeE = { parameter: { key: getMasterKey(), action: 'ping' } };
  Logger.log(doGet(fakeE).getContent());
}

function testVerifyToken() {
  // Remplacer par un vrai token élève pour tester
  const fakeE = { parameter: { action: 'verifyEleveToken', token: 'XXXX-XXXX-XXXX' } };
  Logger.log(doGet(fakeE).getContent());
}
