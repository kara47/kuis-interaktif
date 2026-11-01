/* Logika simpan dan ambil kuis. Dipisah dari kuis.mjs agar tidak bergantung pada Netlify. */
const MAX_BYTES = 200 * 1024, MAX_SOAL = 200, MAX_PER_HARI = 20;
const ABJAD = 'abcdefghjkmnpqrstuvwxyz23456789';
const ID_RE = /^[a-z0-9]{6,12}$/;

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers } });

async function sha256(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
function acak(panjang, abjad) {
  return [...crypto.getRandomValues(new Uint8Array(panjang))].map(b => abjad[b % abjad.length]).join('');
}
const teks = (v, max) => String(v == null ? '' : v).trim().slice(0, max);
const angka = (v, min, max, awal) => { const n = parseInt(v, 10); return Number.isNaN(n) ? awal : Math.max(min, Math.min(max, n)); };

/* hanya kolom yang dikenal yang disimpan; kembalikan null jika soal tidak layak */
export function bersihkan(d) {
  if (!d || typeof d !== 'object' || !Array.isArray(d.soal)) return null;
  if (!['galaksi', 'boss', 'pacman'].includes(d.game)) return null;
  if (!d.soal.length || d.soal.length > MAX_SOAL) return null;
  const soal = [];
  for (const s of d.soal) {
    if (!s || typeof s.q !== 'string' || !Array.isArray(s.o) || s.o.length < 2 || s.o.length > 4) return null;
    if (!Number.isInteger(s.k) || s.k < 0 || s.k >= s.o.length) return null;
    const o = s.o.map(x => teks(x, 1000));
    const q = teks(s.q, 4000);
    if (!q || o.some(x => !x)) return null;
    soal.push({ q, o, k: s.k });
  }
  const judul = teks(d.judul, 200), mapel = teks(d.mapel, 200);
  if (!judul || !mapel) return null;
  return {
    game: d.game, jenjang: d.jenjang === 'kampus' ? 'kampus' : 'sekolah',
    sekolah: teks(d.sekolah, 200), mapel, kelas: teks(d.kelas, 500), judul, guru: teks(d.guru, 200),
    waktu: angka(d.waktu, 8, 120, 40), kkm: angka(d.kkm, 0, 100, 75),
    acakSoal: !!d.acakSoal, acakOpsi: !!d.acakOpsi, tampilkanKunci: !!d.tampilkanKunci, izinkanUlang: !!d.izinkanUlang, soal,
  };
}

async function bacaBody(req) {
  const txt = await req.text();
  if (new TextEncoder().encode(txt).length > MAX_BYTES) return { error: json({ error: 'Kuis terlalu besar.' }, 413) };
  let d;
  try { d = JSON.parse(txt); } catch (e) { return { error: json({ error: 'Format data tidak dikenali.' }, 400) }; }
  const kuis = bersihkan(d);
  if (!kuis) return { error: json({ error: 'Isi kuis belum lengkap.' }, 400) };
  return { kuis };
}

/* batas pembuatan link per alamat IP per hari; IP hanya disimpan sebagai hash */
async function kuotaHabis(store, ip) {
  const hari = new Date().toISOString().slice(0, 10);
  const key = `batas/${hari}/${(await sha256(ip || 'tanpa-ip')).slice(0, 32)}`;
  const n = (await store.get(key, { type: 'json' })) || 0;
  if (n >= MAX_PER_HARI) return true;
  await store.setJSON(key, n + 1);
  return false;
}

export async function handle(req, { store, ip, id }) {
  if (id !== undefined && !ID_RE.test(id)) return json({ error: 'Kode kuis tidak dikenali.' }, 404);

  if (req.method === 'GET' && id) {
    const kuis = await store.get(`kuis/${id}`, { type: 'json' });
    if (!kuis) return json({ error: 'Kuis tidak ditemukan.' }, 404);
    return json(kuis, 200, { 'Cache-Control': 'public, max-age=60' });
  }

  if (req.method === 'POST' && !id) {
    const { kuis, error } = await bacaBody(req);
    if (error) return error;
    if (await kuotaHabis(store, ip)) return json({ error: `Batas ${MAX_PER_HARI} link baru per hari tercapai. Coba lagi besok.` }, 429);
    let baru = acak(7, ABJAD);
    while (await store.get(`kuis/${baru}`)) baru = acak(7, ABJAD);
    const editKey = acak(32, ABJAD);
    await store.setJSON(`edit/${baru}`, await sha256(editKey));
    await store.setJSON(`kuis/${baru}`, kuis);
    return json({ id: baru, editKey }, 201);
  }

  if (req.method === 'PUT' && id) {
    const simpanan = await store.get(`edit/${id}`, { type: 'json' });
    if (!simpanan) return json({ error: 'Kuis tidak ditemukan.' }, 404);
    if (simpanan !== await sha256(req.headers.get('x-edit-key') || '')) return json({ error: 'Kode edit tidak cocok.' }, 403);
    const { kuis, error } = await bacaBody(req);
    if (error) return error;
    await store.setJSON(`kuis/${id}`, kuis);
    return json({ id });
  }

  return json({ error: 'Permintaan tidak dikenali.' }, 405);
}
