import { announce, stopAudio, voiceFor, nicknamePhrase, localBrazilianVoice, NAME_LABELS, TEAM_LABELS } from './voice.js';

const SESSION_KEY = 'truco_acker_teste_session_v3';
const POINTS_AUDIO = { 1: 'um_ponto', 3: 'truco', 6: 'seis', 9: 'nove', 12: 'doze' };
const MAX_SCORE = 12;
const $ = id => document.getElementById(id);
const scoreButtons = [...document.querySelectorAll('.controls button')];
const scoreGroups = [...document.querySelectorAll('[data-team-controls]')];
const teamTitles = [$('team-name-nos'), $('team-name-eles')];
const scores = [$('score-nos'), $('score-eles')];
const matchWins = [$('match-wins-nos'), $('match-wins-eles')];
const defaultTeams = ['Nós', 'Eles'];
const defaults = count => Array.from({ length: count }, (_, index) => 'Jogador ' + (index + 1));

function newRound(dealer = 0) {
    return { score: [0, 0], previous: null, dealer, started: null, ended: null, winner: null, accepted: false, waitingForNextHand: false };
}

function initialState() {
    return {
        version: 3, settings: { theme: 'dark', sound: true, largeText: false },
        mode: 4, teams: [...defaultTeams], players: { 2: defaults(2), 4: defaults(4) },
        round: newRound(), wins: [0, 0], history: [], undo: null, setupDone: false,
    };
}

function readStored(key) {
    try {
        const raw = localStorage.getItem(key);
        return raw === null ? null : JSON.parse(raw);
    } catch {
        return null;
    }
}

function loadLegacy() {
    const legacy = field => readStored('truco_acker_' + field + '_v2');
    const number = value => Number.isSafeInteger(value) && value >= 0 ? value : 0;
    const text = (value, fallback) => typeof value === 'string' && value.trim() ? value.trim() : fallback;
    const data = initialState();
    data.mode = legacy('gameMode') === 2 ? 2 : 4;
    data.settings.theme = legacy('theme') === 'light' ? 'light' : 'dark';
    data.settings.sound = legacy('soundOn') !== false;
    data.teams = [text(legacy('teamNameNos'), defaultTeams[0]), text(legacy('teamNameEles'), defaultTeams[1])];
    const players = legacy('playerNames');
    if (Array.isArray(players) && players.length === data.mode) {
        data.players[data.mode] = defaults(data.mode).map((name, index) => text(players[index], name));
        data.setupDone = true;
    }
    const entries = legacy('durationHistory');
    if (Array.isArray(entries)) {
        data.history = entries.filter(entry => entry && (entry.winner === 'nos' || entry.winner === 'eles'))
            .map(entry => ({
                winner: entry.winner === 'nos' ? 0 : 1,
                name: entry.mode === 2
                    ? text(entry.playerNames?.[entry.winner === 'nos' ? 0 : 1], entry.winner === 'nos' ? 'Jogador 1' : 'Jogador 2')
                    : text(entry.winner === 'nos' ? entry.teamNameNos : entry.teamNameEles, entry.winner === 'nos' ? 'Nós' : 'Eles'),
                mode: entry.mode === 2 ? 2 : 4,
                duration: number(entry.duration),
            }));
    }
    data.wins = [number(legacy('matchesNos')), number(legacy('matchesEles'))];
    data.round.score = [Math.min(MAX_SCORE, number(legacy('scoreNos'))), Math.min(MAX_SCORE, number(legacy('scoreEles')))];
    if (legacy('isInitial') === false) {
        data.round.previous = [number(legacy('prevScoreNos')), number(legacy('prevScoreEles'))];
    }
    data.round.dealer = number(legacy('dealerIndex')) % data.mode;
    const winner = data.round.score.findIndex(score => score >= MAX_SCORE);
    data.round.winner = winner === -1 ? null : winner;
    return data;
}

function loadState() {
    const stored = readStored(SESSION_KEY);
    return stored?.version === 3 && stored.round && stored.settings && stored.players ? stored : initialState();
}

let state = loadState();
let canSync = true;
let wakeLock = null;
let wakeRequest = false;
let installPrompt = null;
let updateWorker = null;
let reloadForUpdate = false;
let nameEdit = null;

function syncState() {
    if (canSync) {
        const stored = readStored(SESSION_KEY);
        if (stored?.version === 3 && stored.round && stored.settings && stored.players) state = stored;
    }
}

function saveState() {
    try {
        localStorage.setItem(SESSION_KEY, JSON.stringify(state));
        canSync = true;
    } catch {
        canSync = false;
    }
    $('storage-message').hidden = canSync;
}

function teamName(team) {
    return state.mode === 4 ? state.teams[team] : state.players[2][team];
}

function currentRule() {
    if (state.round.winner !== null) return { type: 'finished', team: state.round.winner };
    const onEleven = state.round.score.map(score => score === 11);
    if (state.round.waitingForNextHand) return { type: 'between-hands', dark: onEleven.every(Boolean) };
    if (onEleven.every(Boolean)) return { type: 'dark' };
    if (onEleven.some(Boolean)) return { type: state.round.accepted ? 'accepted' : 'decision', team: onEleven.indexOf(true) };
    return { type: 'normal' };
}

function pointVisible(rule, amount) {
    if (rule === 'dark') return amount === 1;
    if (rule === 'accepted') return amount === 3;
    return rule === 'normal';
}

function roundDuration(round, now = Date.now()) {
    return round.started === null ? 0 : Math.max(0, (round.ended ?? now) - round.started);
}

function formatTime(ms) {
    const seconds = Math.floor(ms / 1000);
    const parts = [Math.floor(seconds / 60), seconds % 60];
    return parts.map(value => String(value).padStart(2, '0')).join(':');
}

function tick() {
    const value = formatTime(roundDuration(state.round));
    const timer = $('current-timer-display');
    if (timer.textContent !== value) timer.textContent = value;
}

function render() {
    const { score, previous, dealer, winner } = state.round;
    for (let team = 0; team < 2; team++) {
        teamTitles[team].textContent = teamName(team);
        scores[team].textContent = score[team];
        matchWins[team].textContent = state.wins[team];
    }
    $('match-wins-display').setAttribute('aria-label', teamName(0) + ' ' + state.wins[0] + ', ' + teamName(1) + ' ' + state.wins[1]);
    $('current-dealer-name').textContent = state.players[state.mode][dealer];
    $('undo-button').disabled = state.undo === null;
    $('new-game-btn').hidden = winner === null;
    $('prev-score-display').textContent = previous ? previous.join(' × ') : '—';
    $('edit-teams-btn').hidden = state.mode === 2;
    $('change-game-mode-btn').textContent = 'Trocar para ' + (state.mode === 4 ? '2' : '4') + ' jogadores';
    renderRules();
    renderHistory();
    renderSettings();
    tick();
    syncWakeLock();
}

function renderRules() {
    const rule = currentRule();
    $('rule-banner').hidden = rule.type === 'normal';
    $('hand-decision').hidden = rule.type !== 'decision';
    $('next-hand-btn').hidden = rule.type !== 'between-hands';
    $('next-dealer-btn').disabled = ['finished', 'between-hands', 'accepted'].includes(rule.type);
    const title = $('rule-title');
    const description = $('rule-description');
    if (rule.type === 'finished') {
        title.textContent = 'Vitória · ' + teamName(rule.team);
        description.textContent = 'Confira o placar ou inicie a próxima partida.';
    } else if (rule.type === 'dark') {
        title.textContent = 'Escurinha';
        description.textContent = '11 a 11. A mão vale um ponto, sem truco.';
    } else if (rule.type === 'between-hands') {
        title.textContent = rule.dark ? 'Escurinha · 11 a 11' : 'Mão de 11 encerrada';
        description.textContent = 'Placar atualizado. Toque em Próxima mão para continuar.';
    } else if (rule.type === 'accepted') {
        title.textContent = 'Mão de 11 aceita';
        description.textContent = 'Marque três pontos para quem vencer a mão.';
    } else if (rule.type === 'decision') {
        title.textContent = 'Mão de 11 · ' + teamName(rule.team);
        description.textContent = 'Se correr, ' + teamName(1 - rule.team) + ' ganha um ponto.';
    }
    for (const group of scoreGroups) {
        group.dataset.single = String(rule.type === 'dark' || rule.type === 'accepted');
        group.hidden = ['decision', 'finished', 'between-hands'].includes(rule.type);
    }
    for (const button of scoreButtons) {
        const team = Number(button.dataset.team);
        const amount = Number(button.dataset.amount);
        button.hidden = !pointVisible(rule.type, amount);
        button.disabled = amount < 0 && state.round.score[team] === 0;
        button.setAttribute('aria-label', (amount < 0 ? 'Tirar 1 ponto de ' : 'Dar ' + amount + (amount === 1 ? ' ponto para ' : ' pontos para ')) + teamName(team));
    }
}

function matchScore(entry) {
    return entry.sides.map(({ name }, index) => name + ' ' + entry.score[index]).join(' × ');
}

function currentSides() {
    const players = state.players[state.mode];
    return [0, 1].map(team => ({
        name: teamName(team),
        players: players.filter((_name, index) => index % 2 === team),
    }));
}

function renderHistory() {
    const list = $('duration-history-list');
    if (list.dataset.historyCount === String(state.history.length) && list.dataset.latest === JSON.stringify(state.history.at(-1))) return;
    list.dataset.historyCount = state.history.length;
    list.dataset.latest = JSON.stringify(state.history.at(-1));
    $('history-count').textContent = state.history.length ? '· ' + state.history.length : '';
    $('empty-history').hidden = state.history.length > 0;
    const entries = document.createDocumentFragment();
    for (const entry of [...state.history].reverse()) {
        const item = document.createElement('li');
        const result = document.createElement('strong');
        result.textContent = entry.score && entry.sides ? matchScore(entry) : entry.name + ' venceu';
        const details = document.createElement('span');
        details.className = 'muted';
        details.textContent = [
            entry.score && entry.sides ? 'Vitória de ' + entry.name : 'Placar final indisponível',
            formatTime(entry.duration), entry.mode + ' jogadores',
        ].join(' · ');
        item.append(result, details);
        entries.append(item);
    }
    list.replaceChildren(entries);
}

function renderSettings() {
    const { theme, sound, largeText } = state.settings;
    document.body.classList.toggle('light-theme', theme === 'light');
    document.documentElement.dataset.largeText = String(largeText);
    $('theme-color-meta').content = theme === 'light' ? '#edf1f6' : '#10161d';
    $('sound-toggle-btn').setAttribute('aria-pressed', String(sound));
    $('theme-toggle-btn').textContent = theme === 'dark' ? 'Tema claro' : 'Tema escuro';
    $('size-toggle-btn').setAttribute('aria-pressed', String(largeText));
    $('size-toggle-btn').lastChild.textContent = largeText ? ' Voltar ao texto padrão' : ' Texto maior';
}

function postStatus(message) {
    const hint = $('rule-banner').hidden || currentRule().type === 'finished'
        ? '' : ' ' + $('rule-title').textContent + '. ' + $('rule-description').textContent;
    $('game-message').textContent = message + ' Placar ' + state.round.score.join(' a ') + '.' + hint;
}

function commit(message, audio = [], sentence = message) {
    const trigger = document.activeElement;
    saveState();
    render();
    if (trigger?.matches('.controls button, #hand-decision button, #next-hand-btn') &&
        (trigger.disabled || !trigger.getClientRects().length)) {
        const rule = currentRule();
        if (rule.type === 'finished') $('new-game-btn').focus();
        else if (rule.type === 'between-hands') $('next-hand-btn').focus();
        else if (rule.type === 'decision') $('accept-hand').focus();
        else scoreButtons.find(button => !button.disabled && !button.hidden)?.focus();
    }
    postStatus(message);
    if (state.settings.sound) void announce(audio, sentence);
}

function snapshot() {
    state.undo = {
        round: { ...state.round },
        wins: [...state.wins],
        historyLength: state.history.length,
    };
}

function nextDealer() {
    state.round.dealer = (state.round.dealer + 1) % state.mode;
}

function dealerAudio(manual = false) {
    const index = state.round.dealer;
    const name = state.players[state.mode][index];
    const cue = manual ? 'proximo_embaralhar' : 'embaralhador';
    const ending = manual ? 'proxima_vez_de_embaralhar' : 'vez_de_embaralhar';
    return nicknamePhrase(name, cue, [...voiceFor(name, 'jogador_' + (index + 1)), ending]);
}

function teamAudio(team) {
    const fallback = state.mode === 4 ? (team === 0 ? 'equipe_nos' : 'equipe_eles') : 'jogador_' + (team + 1);
    return voiceFor(teamName(team), fallback);
}

function scorePoint(team, amount, ran = false) {
    const round = state.round;
    const now = Date.now();
    if (amount > 0 && round.started === null) round.started = now;
    round.previous = round.score;
    round.score = round.score.map((value, index) => index === team ? Math.min(MAX_SCORE, value + amount) : value);
    round.waitingForNextHand = (ran || round.accepted) && round.score[team] < MAX_SCORE;
    round.accepted = false;
    if (amount > 0) nextDealer();
    let audio = ran ? ['correu'] : [];
    if (!ran && amount > 0) {
        const cue = POINTS_AUDIO[amount];
        audio = nicknamePhrase(teamName(team), cue, [cue, 'para', ...teamAudio(team)]);
    }
    if (round.score[team] === MAX_SCORE) {
        round.winner = team;
        round.ended = now;
        state.wins[team]++;
        state.history.push({
            winner: team, name: teamName(team), mode: state.mode, duration: roundDuration(round, now),
            score: [...round.score], sides: currentSides(),
        });
        const victory = state.mode === 4 ? 'ganharam_partida' : 'ganhou_partida';
        commit('Vitória de ' + teamName(team) + '.', nicknamePhrase(teamName(team), 'ganhou_partida', [...teamAudio(team), victory]));
        return;
    }
    const rule = currentRule();
    if (rule.type === 'dark') audio.push('escurinha');
    else if (rule.type === 'decision') audio.push('mao_de_11', ...teamAudio(rule.team), 'decidir_mao_11');
    else if (!ran && amount > 0) audio = [...audio, ...dealerAudio()];
    const message = ran ? teamName(team) + ' ganhou um ponto porque o adversário correu.' : 'Placar atualizado.';
    const points = amount === 1 ? 'Um ponto' : amount + ' pontos';
    const action = ran ? message : points + ' para ' + teamName(team) + '.';
    const next = rule.type === 'decision' ? 'Mão de onze. ' + teamName(rule.team) + ' decide se aceita ou corre.'
        : rule.type === 'dark' ? 'Escurinha.' : state.players[state.mode][round.dealer] + ' é quem embaralha.';
    commit(message, audio, action + ' ' + next);
}

function changeScore(team, amount) {
    syncState();
    if (!pointVisible(currentRule().type, amount) || state.round.score[team] + amount < 0) return;
    snapshot();
    scorePoint(team, amount);
}

function decideHand(accept) {
    syncState();
    const rule = currentRule();
    if (rule.type !== 'decision') return;
    snapshot();
    if (accept) {
        state.round.accepted = true;
        commit('Mão de onze aceita. A mão vale três pontos.', ['jogo_aceito']);
        scoreGroups[rule.team].querySelector('[data-amount="3"]').focus();
    } else {
        scorePoint(1 - rule.team, 1, true);
    }
}

function startNextHand() {
    syncState();
    if (currentRule().type !== 'between-hands') return;
    state.round.waitingForNextHand = false;
    const rule = currentRule();
    if (rule.type === 'dark') {
        commit('Próxima mão. Escurinha.', ['escurinha']);
    } else {
        const name = teamName(rule.team);
        commit('Próxima mão.', ['mao_de_11', ...teamAudio(rule.team), 'decidir_mao_11'],
            'Mão de onze. ' + name + ' decide se aceita ou corre.');
    }
}

function undo() {
    syncState();
    if (!state.undo) return;
    const { round, wins, historyLength } = state.undo;
    state.round = round;
    state.wins = wins;
    state.history.length = historyLength;
    state.undo = null;
    commit('Ação desfeita.', ['acao_desfeita']);
    if (currentRule().type === 'decision') $('accept-hand').focus();
    else scoreButtons.find(button => !button.hidden && !button.disabled)?.focus();
}

function nextGame() {
    syncState();
    if (state.round.winner === null) return;
    state.round = newRound(state.round.dealer);
    state.undo = null;
    commit('Nova partida. Placar zerado.');
    scoreButtons[0].focus();
}

async function syncWakeLock() {
    if (!('wakeLock' in navigator)) return;
    const active = state.round.started !== null && state.round.winner === null && document.visibilityState === 'visible';
    if (!active && wakeLock) {
        void wakeLock.release().catch(() => {});
        wakeLock = null;
    } else if (active && !wakeLock && !wakeRequest) {
        wakeRequest = true;
        try {
            const lock = await navigator.wakeLock.request('screen');
            if (state.round.started === null || state.round.winner !== null || document.visibilityState !== 'visible') {
                await lock.release();
            } else {
                wakeLock = lock;
                lock.addEventListener('release', () => { if (wakeLock === lock) wakeLock = null; }, { once: true });
            }
        } catch {
            // O placar funciona em navegadores que não permitem manter a tela ativa.
        } finally {
            wakeRequest = false;
        }
    }
}

function setNotice(id, message) {
    const notice = $(id);
    notice.textContent = message;
    notice.hidden = !message;
}

const normalize = name => name.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('pt-BR').trim();

function nameField(value, label, fallback, options) {
    const field = document.createElement('div');
    field.className = 'name-field';
    const input = document.createElement('input');
    input.id = 'edit-name-' + fallback;
    input.name = fallback;
    input.type = 'text';
    input.maxLength = 48;
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.value = value;
    const caption = document.createElement('label');
    caption.htmlFor = input.id;
    caption.textContent = label;
    const row = document.createElement('div');
    row.className = 'name-input-row';
    const preview = document.createElement('button');
    preview.type = 'button';
    preview.textContent = 'Ouvir';
    preview.setAttribute('aria-label', 'Ouvir nome de ' + label.toLowerCase());
    preview.addEventListener('click', async () => {
        const spoken = fallback.startsWith('jogador') ? label : fallback === 'nos' ? 'Nós' : 'Eles';
        const name = input.value.trim() || spoken;
        const keys = voiceFor(name, voiceFor(spoken)[0]);
        const custom = typeof keys[0] === 'object';
        const notice = localBrazilianVoice() ? 'Este nome usa a voz brasileira do aparelho.'
            : 'Sem gravação ou voz brasileira local. A Francisca diz “' + spoken + '”.';
        setNotice('name-message', custom ? notice : '');
        if (!await announce(keys, name)) {
            setNotice('name-message', 'Áudio indisponível. Abra uma vez com internet para preparar a voz.');
        }
    });
    row.append(input, preview);
    const suggestions = document.createElement('div');
    suggestions.className = 'suggestions';
    suggestions.hidden = true;
    const noMatch = document.createElement('p');
    noMatch.className = 'notice';
    noMatch.textContent = 'Sem sugestões. Você pode salvar o nome digitado.';
    noMatch.hidden = true;
    function updateSuggestions(showDefaults) {
        const query = normalize(input.value);
        const hits = [[], [], []];
        for (const name of options) {
            const option = normalize(name);
            if (option === query) hits[0].push(name);
            else if (option.startsWith(query)) hits[1].push(name);
            else if (query.length >= 3 && option.includes(query)) hits[2].push(name);
        }
        const matches = (showDefaults ? options : hits.flat()).slice(0, 6);
        const buttons = matches.map(name => {
            const option = document.createElement('button');
            option.type = 'button';
            option.textContent = name;
            option.addEventListener('click', () => {
                input.value = name;
                input.focus();
                suggestions.hidden = true;
                noMatch.hidden = true;
                setNotice('name-message', '');
            });
            return option;
        });
        suggestions.replaceChildren(...buttons);
        suggestions.hidden = !buttons.length;
        noMatch.hidden = !query || buttons.length > 0;
    }
    input.addEventListener('focus', () => {
        // Collapsing on blur moves Save between pointerdown and click.
        for (const previous of $('name-fields').querySelectorAll('.suggestions, .notice')) {
            if (!field.contains(previous)) previous.hidden = true;
        }
        const isDefault = /^Jogador [1-4]$/.test(input.value) || defaultTeams.includes(input.value);
        if (isDefault) input.select();
        updateSuggestions(isDefault);
    });
    input.addEventListener('input', () => {
        updateSuggestions(false);
        setNotice('name-message', '');
    });
    field.append(caption, row, suggestions, noMatch);
    return field;
}

function openNames(teams, firstUse = false) {
    syncState();
    if (teams && state.mode !== 4) return;
    nameEdit = { teams, mode: state.mode, firstUse };
    $('names-title').textContent = firstUse ? 'Quem vai jogar?' : teams ? 'Editar equipes' : 'Editar jogadores';
    $('names-title').toggleAttribute('autofocus', firstUse);
    $('names-close').hidden = firstUse;
    $('names-cancel').hidden = firstUse;
    $('names-submit').textContent = firstUse ? 'Começar partida' : 'Salvar';
    $('names-help').textContent = teams
        ? 'Escolha um nome com voz ou digite o apelido da dupla.'
        : firstUse ? 'Digite para buscar um nome. Você também pode começar com os nomes preenchidos.'
        : 'Digite para buscar um nome com gravação ou escreva um nome novo.';
    setNotice('name-message', '');
    const fields = teams
        ? state.teams.map((name, index) => nameField(name, 'Equipe ' + (index + 1), index === 0 ? 'nos' : 'eles', TEAM_LABELS))
        : state.players[state.mode].map((name, index) => {
            const field = nameField(name, 'Jogador ' + (index + 1), 'jogador' + (index + 1), NAME_LABELS);
            if (state.mode === 4) field.querySelector('label').append(' · ' + state.teams[index % 2]);
            return field;
        });
    $('name-fields').replaceChildren(...fields);
    $('names-dialog').returnValue = '';
    $('names-dialog').showModal();
}

function saveNames(event) {
    event.preventDefault();
    syncState();
    if (state.mode !== nameEdit.mode) {
        $('names-dialog').close();
        setNotice('options-message', 'O modo mudou em outra aba. Abra a edição novamente.');
        return;
    }
    const fallback = nameEdit.teams ? defaultTeams : defaults(state.mode);
    const names = [...$('name-fields').querySelectorAll('input')].map((input, index) => input.value.trim() || fallback[index]);
    if (nameEdit.teams) state.teams = names;
    else state.players[state.mode] = names;
    state.setupDone = true;
    const audio = nameEdit.firstUse ? [] : [nameEdit.teams ? 'equipes_atualizadas' : 'nomes_atualizados'];
    stopAudio();
    $('names-dialog').close('saved');
    commit(nameEdit.firstUse ? 'Partida pronta para começar.' : 'Nomes atualizados.', audio);
    $('options-dialog').close();
    $('options-btn').focus();
}

function restartMatch() {
    if (!confirm('Reiniciar esta partida? As vitórias e o histórico serão mantidos.')) return;
    syncState();
    state.round = newRound(state.round.dealer);
    state.undo = null;
    commit('Partida reiniciada.', ['jogo_reiniciado']);
    $('options-dialog').close();
}

function resetAll() {
    if (!confirm('Zerar pontos, vitórias e histórico deste aparelho? Os nomes e as opções serão mantidos.')) return;
    syncState();
    state.round = newRound();
    state.wins = [0, 0];
    state.history = [];
    state.undo = null;
    commit('Placar e histórico zerados.');
    $('options-dialog').close();
}

function changeMode() {
    syncState();
    const nextMode = state.mode === 4 ? 2 : 4;
    if (!confirm('Jogar com ' + nextMode + ' jogadores? A partida atual e as vitórias serão zeradas. O histórico será mantido.')) return;
    syncState();
    if (state.mode === nextMode) return;
    state.mode = nextMode;
    state.round = newRound();
    state.wins = [0, 0];
    state.undo = null;
    commit('Modo de ' + nextMode + ' jogadores.');
    $('options-dialog').close();
}

function historyText(limit, forWhatsApp = false) {
    syncState();
    const bold = value => forWhatsApp ? '*' + value.replaceAll('*', '∗') + '*' : value;
    const first = Math.max(0, state.history.length - limit);
    const entries = state.history.slice(first);
    const sides = currentSides();
    const lineup = teams => teams.map(({ name, players }) => bold(name) + ' — ' + players.join(' e '));
    const wins = sides.map(({ name }, index) => name + ' ' + state.wins[index]).join(' × ');
    const lines = [bold('Truco Acker'), '', bold('Partidas ganhas'), wins];
    if (state.round.winner === null && state.round.started !== null) {
        lines.push('', bold('Placar em andamento'), matchScore({ sides, score: state.round.score }));
    }
    if (state.mode === 4) lines.push('', bold('Duplas atuais'), ...lineup(sides));
    if (entries.length) {
        lines.push('', bold(first ? 'Últimas ' + entries.length + ' partidas' : 'Partidas concluídas'));
        for (const [index, entry] of entries.entries()) {
            lines.push('', bold('Partida ' + (first + index + 1)));
            if (entry.score && entry.sides) lines.push(bold(matchScore(entry)));
            lines.push(entry.name + ' venceu · ' + formatTime(entry.duration) + ' · ' + entry.mode + ' jogadores');
            if (!entry.score) lines.push('Placar final indisponível');
            if (entry.mode === 4 && entry.sides) lines.push(...lineup(entry.sides));
        }
    }
    return lines.join('\n');
}

function openInfo(title, ...children) {
    $('info-title').textContent = title;
    const content = $('info-content');
    content.replaceChildren();
    for (const child of children) {
        if (typeof child === 'string') {
            const paragraph = document.createElement('p');
            paragraph.textContent = child;
            content.append(paragraph);
        } else {
            content.append(child);
        }
    }
    $('info-dialog').showModal();
}

async function copyText(text, messageId, success) {
    try {
        await navigator.clipboard.writeText(text);
        setNotice(messageId, success);
    } catch {
        const field = document.createElement('textarea');
        field.value = text;
        field.readOnly = true;
        field.rows = 6;
        field.setAttribute('aria-label', 'Texto para copiar');
        openInfo('Copiar', 'Selecione e copie o texto.', field);
        field.focus();
        field.select();
    }
}

async function shareApp() {
    const url = new URL('.', location.href).href;
    if (navigator.share) {
        try {
            await navigator.share({ title: 'Truco Acker', url });
            return;
        } catch (error) {
            if (error.name === 'AbortError') return;
        }
    }
    await copyText(url, 'options-message', 'Link do Truco Acker copiado.');
}

async function installApp() {
    if (installPrompt) {
        const prompt = installPrompt;
        installPrompt = null;
        await prompt.prompt();
        return;
    }
    openInfo('Instalar o Truco Acker',
        'No Android, abra no Chrome e use o menu ⋮ para instalar ou adicionar à tela inicial.',
        'No iPhone, abra no Safari e escolha Compartilhar → Adicionar à Tela de Início → Abrir como App da Web.',
        'Abra uma vez com internet para preparar o placar e as vozes para jogar offline.');
}

document.querySelector('.teams').addEventListener('click', event => {
    const button = event.target.closest('button[data-amount]');
    if (button) changeScore(Number(button.dataset.team), Number(button.dataset.amount));
});

for (const button of document.querySelectorAll('.close-dialog')) {
    button.addEventListener('click', () => button.closest('dialog').close());
}
$('names-dialog').addEventListener('close', event => {
    if (event.currentTarget.returnValue !== 'saved') stopAudio();
});
$('names-dialog').addEventListener('cancel', event => {
    if (nameEdit?.firstUse) event.preventDefault();
});
$('options-btn').addEventListener('click', () => {
    setNotice('options-message', '');
    $('options-dialog').showModal();
});
$('accept-hand').addEventListener('click', () => decideHand(true));
$('decline-hand').addEventListener('click', () => decideHand(false));
$('next-hand-btn').addEventListener('click', startNextHand);
// A held Enter must not activate the next button after the focus moves.
document.querySelector('.scoreboard').addEventListener('keydown', event => {
    if (event.repeat && event.key === 'Enter' &&
        event.target.matches('.controls button, .decision-actions button, .game-actions button')) {
        event.preventDefault();
    }
});
$('undo-button').addEventListener('click', undo);
$('new-game-btn').addEventListener('click', nextGame);
$('next-dealer-btn').addEventListener('click', () => {
    syncState();
    if (['finished', 'between-hands', 'accepted'].includes(currentRule().type)) return;
    snapshot();
    nextDealer();
    commit(state.players[state.mode][state.round.dealer] + ' é o próximo embaralhador.', dealerAudio(true));
});
$('edit-players-btn').addEventListener('click', () => openNames(false));
$('edit-teams-btn').addEventListener('click', () => openNames(true));
$('names-form').addEventListener('submit', saveNames);
$('change-game-mode-btn').addEventListener('click', changeMode);
$('reset-game-btn').addEventListener('click', restartMatch);
$('reset-all-btn').addEventListener('click', resetAll);
$('rules-toggle-btn').addEventListener('click', () => $('rulesModal').showModal());
$('theme-toggle-btn').addEventListener('click', () => {
    syncState();
    state.settings.theme = state.settings.theme === 'dark' ? 'light' : 'dark';
    saveState();
    renderSettings();
});
$('size-toggle-btn').addEventListener('click', () => {
    syncState();
    state.settings.largeText = !state.settings.largeText;
    saveState();
    renderSettings();
});
$('sound-toggle-btn').addEventListener('click', () => {
    syncState();
    state.settings.sound = !state.settings.sound;
    saveState();
    renderSettings();
    if (state.settings.sound) void announce(['som_ativado']);
    else stopAudio();
});
$('copy-history-btn').addEventListener('click', () => copyText(historyText(Infinity), 'history-message', 'Resumo copiado.'));
$('export-history-btn').addEventListener('click', () => {
    window.open('https://wa.me/?text=' + encodeURIComponent(historyText(10, true)), '_blank', 'noopener,noreferrer');
});
$('share-app-btn').addEventListener('click', shareApp);
$('install-btn').addEventListener('click', installApp);
$('update-btn').addEventListener('click', () => {
    if (!updateWorker) return;
    if (!canSync) {
        setNotice('options-message', 'O placar está só na memória. Copie o histórico antes de fechar o app.');
        return;
    }
    reloadForUpdate = true;
    updateWorker.postMessage('ACTIVATE_UPDATE');
});
$('privacy-btn').addEventListener('click', () => {
    openInfo('Privacidade',
        'Placar, nomes e histórico ficam neste navegador. Os nomes usam gravações do app ou uma voz pt-BR que o aparelho identifica como local. Sem essa voz, você ouve a equipe ou o jogador numerado.',
        'Ao escolher WhatsApp, você abre o resumo no WhatsApp para decidir se quer enviar. Você pode apagar o histórico nas opções e remover todos os dados pelo navegador.');
});

window.addEventListener('storage', event => {
    if (event.key !== SESSION_KEY && event.key !== null) return;
    state = loadState();
    stopAudio();
    render();
});
window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    installPrompt = event;
});
window.addEventListener('appinstalled', () => {
    installPrompt = null;
    $('install-btn').hidden = true;
});
function resumeGame() {
    syncState();
    render();
}
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') resumeGame();
    else {
        stopAudio();
        void syncWakeLock();
    }
});
window.addEventListener('pagehide', stopAudio);
window.addEventListener('pageshow', event => { if (event.persisted) resumeGame(); });
if (matchMedia('(display-mode: standalone)').matches || navigator.standalone) $('install-btn').hidden = true;
render();
if (!state.setupDone) openNames(false, true);
setInterval(tick, 250);
if (!('serviceWorker' in navigator)) $('offline-status').textContent = 'Este navegador não oferece o preparo offline.';
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (reloadForUpdate) location.reload();
    });
    window.addEventListener('load', async () => {
        try {
            const registration = await navigator.serviceWorker.register('sw.js');
            const checkUpdate = () => {
                const active = !!registration.active;
                $('offline-status').textContent = active ? 'Placar e vozes disponíveis offline.'
                    : registration.installing ? 'Preparando o placar e as vozes para jogar offline…'
                    : 'Preparo offline incompleto. Reabra com internet para tentar novamente.';
                updateWorker = navigator.serviceWorker.controller ? registration.waiting : null;
                $('update-btn').hidden = !updateWorker;
            };
            const observeInstall = () => {
                registration.installing?.addEventListener('statechange', checkUpdate);
                checkUpdate();
            };
            registration.addEventListener('updatefound', observeInstall);
            observeInstall();
            void navigator.serviceWorker.ready.then(checkUpdate);
        } catch (error) {
            $('offline-status').textContent = 'Preparo offline indisponível. Reabra com internet para tentar novamente.';
            console.warn('Modo offline indisponível.', error);
        }
    });
}
