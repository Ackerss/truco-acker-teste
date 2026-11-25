import { NAME_LABELS, NAME_CLIPS } from './audio/catalogo.js';

export { NAME_LABELS };

const originalVoices = {
    'jogador 1': 'jogador_1',
    'jogador 2': 'jogador_2',
    'jogador 3': 'jogador_3',
    'jogador 4': 'jogador_4',
    'nos': 'equipe_nos',
    'eles': 'equipe_eles',
    'os pato': 'equipe_os_pato',
    'os marreco': 'equipe_os_marreco',
    'os fregues': 'equipe_os_freegues',
    'os mao de alface': 'equipe_os_mao_de_alface',
    'os boca aberta': 'equipe_os_boca_aberta',
    'os treme-treme': 'equipe_os_treme_treme',
    'os pe de cana': 'equipe_os_pe_de_cana',
    'os copo furado': 'equipe_os_copo_furado',
    'os garganta': 'equipe_os_garganta',
    'as patroa': 'equipe_as_patroa',
    'os cunhado': 'equipe_os_cunhado',
    'os manja rola': 'equipe_os_manja_rola',
    'os queima rosca': 'equipe_os_queima_rosca',
};
export const TEAM_LABELS = [
    'Nós', 'Eles', 'Os Pato', 'Os Marreco', 'Os Freguês', 'Os Mão de Alface',
    'Os Boca Aberta', 'Os Treme-Treme', 'Os Pé de Cana', 'Os Copo Furado',
    'Os Garganta', 'As Patroa', 'Os Cunhado', 'Os Manja Rola', 'Os Queima Rosca',
];

const decodedClips = new Map();
const playing = new Set();
const nameKey = value => value.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('pt-BR').trim().replace(/\s+/g, ' ');
let context;
let namePack;
let sequence = 0;

const recordedNicknames = new Set(['dieguito', 'zeu', 'zeus', 'galegao']);

export function nicknamePhrase(name, cue, fallback) {
    const key = nameKey(name);
    return recordedNicknames.has(key) ? ['apelidos/' + cue + '_' + key] : fallback;
}

export function localBrazilianVoice() {
    return window.speechSynthesis?.getVoices().find(voice =>
        voice.localService && voice.lang.replaceAll('_', '-').toLowerCase() === 'pt-br');
}

// Android populates this list asynchronously. Ask early, then check again on use.
window.speechSynthesis?.getVoices();

export function voiceFor(name, fallback) {
    const key = nameKey(name);
    if (Object.hasOwn(originalVoices, key)) return [originalVoices[key]];
    if (Object.hasOwn(NAME_CLIPS, key)) return ['nome:' + key];
    const parts = key.split(/[ -]+/);
    if (parts.length > 1 && parts.length <= 3 && parts.every(part => Object.hasOwn(NAME_CLIPS, part))) {
        return parts.map(part => 'nome:' + part);
    }
    try {
        // Preserve Francisca name recordings from the earlier release on this device.
        const oldAudio = localStorage.getItem('truco_teste_tts_cache_name_' + name.toLowerCase().trim());
        if (oldAudio && /^data:audio\/(?:mpeg|mp3);base64,[A-Za-z0-9+/=]+$/.test(oldAudio)) return [oldAudio];
    } catch {
        // Private browsing can restrict access to previous recordings.
    }
    return key && fallback ? [{ name: name.trim(), fallback }] : fallback ? [fallback] : [];
}

async function fetchAudio(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error('Áudio indisponível');
    return response.arrayBuffer();
}

async function clipBytes(clip) {
    if (!clip.startsWith('nome:')) {
        return fetchAudio(clip.startsWith('data:') ? clip : new URL('./audio/' + clip + '.mp3', import.meta.url));
    }
    namePack ??= fetchAudio(new URL('./audio/nomes_francisca.mp3', import.meta.url)).catch(error => {
        namePack = undefined;
        throw error;
    });
    const [offset, length] = NAME_CLIPS[clip.slice(5)];
    const audio = await namePack;
    if (offset + length > audio.byteLength) throw new Error('Gravação incompleta');
    return audio.slice(offset, offset + length);
}

// The indexed names include silence from the recording session. Keep a margin
// around the waveform so adjacent words join without cutting soft consonants.
function playbackRegion(buffer, isName) {
    if (!isName) return { buffer, offset: 0, duration: buffer.duration };
    const samples = buffer.getChannelData(0);
    let first = 0;
    let last = samples.length - 1;
    while (first < last && Math.abs(samples[first]) < 0.004) first++;
    while (last > first && Math.abs(samples[last]) < 0.004) last--;
    const offset = Math.max(0, first / buffer.sampleRate - 0.05);
    const end = Math.min(buffer.duration, (last + 1) / buffer.sampleRate + 0.09);
    return { buffer, offset, duration: end - offset };
}

async function decodeClip(clip) {
    if (!decodedClips.has(clip)) {
        const decoded = clipBytes(clip)
            .then(buffer => context.decodeAudioData(buffer))
            .then(buffer => playbackRegion(buffer, clip.startsWith('nome:') || clip.startsWith('apelidos/')))
            .catch(error => {
                decodedClips.delete(clip);
                throw error;
            });
        decodedClips.set(clip, decoded);
        if (decodedClips.size > 40) decodedClips.delete(decodedClips.keys().next().value);
    }
    return decodedClips.get(clip);
}

let speech = null;
let cancelSpeech = null;

export function stopAudio() {
    sequence++;
    if (speech) {
        cancelSpeech?.();
        window.speechSynthesis.cancel();
    }
    for (const clip of playing) {
        clip.stop();
        clip.disconnect();
    }
    playing.clear();
}

function speakLocally(text, voice) {
    return new Promise(resolve => {
        const line = new SpeechSynthesisUtterance(text);
        line.lang = 'pt-BR';
        line.voice = voice;
        let startup;
        const finish = ok => {
            clearTimeout(startup);
            if (speech !== line) return;
            speech = null;
            cancelSpeech = null;
            resolve(ok);
        };
        speech = line;
        cancelSpeech = () => finish(true);
        line.onstart = () => clearTimeout(startup);
        line.onend = () => finish(true);
        line.onerror = () => finish(false);
        startup = setTimeout(() => {
            if (speech !== line) return;
            finish(false);
            window.speechSynthesis.cancel();
        }, 1800);
        try { window.speechSynthesis.speak(line); } catch { finish(false); }
    });
}

export async function announce(keys, sentence) {
    stopAudio();
    if (!keys.length || document.visibilityState === 'hidden') return true;
    const turn = sequence;
    try {
        const hasCustomName = keys.some(key => typeof key === 'object');
        if (hasCustomName && sentence) {
            const voice = localBrazilianVoice();
            if (voice && await speakLocally(sentence, voice)) return true;
            if (turn !== sequence) return true;
        }
        context ??= new AudioContext();
        await context.resume();
        const clips = await Promise.all(keys.map(key => decodeClip(typeof key === 'string' ? key : key.fallback).catch(() => null)));
        if (turn !== sequence) return true;

        let when = context.currentTime + 0.02;
        for (const audio of clips) {
            if (!audio) continue;
            const clip = context.createBufferSource();
            clip.buffer = audio.buffer;
            clip.connect(context.destination);
            clip.onended = () => {
                if (playing.delete(clip)) clip.disconnect();
            };
            clip.start(when, audio.offset, audio.duration);
            playing.add(clip);
            when += audio.duration;
        }
        return clips.every(Boolean);
    } catch {
        return false;
    }
}
