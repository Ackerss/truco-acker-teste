const ORIGINAL_MP3 = [
    "acao_desfeita.mp3",
    "correu.mp3",
    "decidir_mao_11.mp3",
    "doze.mp3",
    "embaralha.mp3",
    "embaralhador.mp3",
    "equipe_as_patroa.mp3",
    "equipe_eles.mp3",
    "equipe_nos.mp3",
    "equipe_os_boca_aberta.mp3",
    "equipe_os_copo_furado.mp3",
    "equipe_os_cunhado.mp3",
    "equipe_os_freegues.mp3",
    "equipe_os_garganta.mp3",
    "equipe_os_manja_rola.mp3",
    "equipe_os_mao_de_alface.mp3",
    "equipe_os_marreco.mp3",
    "equipe_os_pato.mp3",
    "equipe_os_pe_de_cana.mp3",
    "equipe_os_queima_rosca.mp3",
    "equipe_os_treme_treme.mp3",
    "equipes_atualizadas.mp3",
    "escurinha.mp3",
    "ganharam_partida.mp3",
    "ganhou_partida.mp3",
    "historico_pronto.mp3",
    "jogador_1.mp3",
    "jogador_2.mp3",
    "jogador_3.mp3",
    "jogador_4.mp3",
    "jogo_aceito.mp3",
    "jogo_reiniciado.mp3",
    "mao_de_11.mp3",
    "modo_2_config.mp3",
    "modo_4_config.mp3",
    "modo_alterado_2.mp3",
    "modo_alterado_4.mp3",
    "nada_desfazer.mp3",
    "nao_desfazer_modo.mp3",
    "nomes_atualizados.mp3",
    "nove.mp3",
    "para.mp3",
    "placar_zerado.mp3",
    "proximo_embaralhar.mp3",
    "seis.mp3",
    "som_ativado.mp3",
    "truco.mp3",
    "um_ponto.mp3",
];
const nicknames = ['dieguito', 'zeu', 'zeus', 'galegao'];
const cues = ['um_ponto', 'truco', 'seis', 'nove', 'doze', 'embaralhador', 'proximo_embaralhar', 'ganhou_partida'];
const CACHE = 'truco-acker-teste-cache-v3.8';
const CORE = [
    './', './index.html', './styles.css', './app.js', './voice.js', './manifest.json',
    './icon-192.png', './icon-512.png', './audio/catalogo.js', './audio/nomes_francisca.mp3',
    ...nicknames.flatMap(name => cues.map(cue => './audio/apelidos/' + cue + '_' + name + '.mp3')),
    ...['jacson', 'jogador_1', 'jogador_2', 'jogador_3', 'jogador_4'].flatMap(name => [
        './audio/apelidos/embaralhador_' + name + '.mp3',
        './audio/apelidos/proximo_embaralhar_' + name + '.mp3',
    ]),
    './audio/vez_de_embaralhar.mp3', './audio/proxima_vez_de_embaralhar.mp3',
    ...ORIGINAL_MP3.map(file => './audio/' + file),
];
const scope = new URL(self.registration.scope);
const coreUrls = new Set(CORE.map(path => new URL(path, scope).href));
const index = new URL('./index.html', scope).href;

self.addEventListener('install', event => {
    event.waitUntil(caches.open(CACHE).then(cache =>
        cache.addAll(CORE.map(path => new Request(path, { cache: 'reload' }))),
    ));
});

self.addEventListener('activate', event => {
    event.waitUntil(caches.keys().then(keys => Promise.all(
        keys.filter(key => key.startsWith('truco-acker-teste-cache-') && key !== CACHE)
            .map(key => caches.delete(key)),
    )).then(() => self.clients.claim()));
});

self.addEventListener('message', event => {
    if (event.data === 'ACTIVATE_UPDATE') event.waitUntil(self.skipWaiting());
});

self.addEventListener('fetch', event => {
    const request = event.request;
    if (request.method !== 'GET' || request.headers.has('Range')) return;
    const url = new URL(request.url);
    if (url.origin !== scope.origin) return;

    let cachedUrl = url.href;
    if (request.mode === 'navigate' && (url.pathname === scope.pathname || url.pathname === new URL(index).pathname)) {
        cachedUrl = index;
    }
    if (!coreUrls.has(cachedUrl)) return;
    event.respondWith(caches.open(CACHE).then(async cache => {
        const cached = await cache.match(cachedUrl);
        return cached ?? fetch(request);
    }));
});
