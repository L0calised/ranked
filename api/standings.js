import { compactStandings } from '../src/standings-data.js';

export default async function handler(req, res) {
  const id = req.query?.contestId;
  if (req.method !== 'GET') return res.status(405).json({ error: 'Use GET.' });
  if (typeof id !== 'string' || !/^[1-9]\d{0,6}$/.test(id)) return res.status(400).json({ error: 'Invalid contest ID.' });
  try {
    // The public regular-contest endpoint permits exactly this one query parameter.
    const response = await fetch(`https://codeforces.com/api/contest.standings?contestId=${id}`, { signal: AbortSignal.timeout(25000) });
    if (!response.ok) throw new Error('Codeforces standings are unavailable.');
    const payload = await response.json();
    if (payload.status !== 'OK') throw new Error(payload.comment || 'Standings unavailable.');
    const data = compactStandings(payload.result);
    if (data.contest.id !== Number(id) || data.contest.phase !== 'FINISHED' || data.contest.frozen) throw new Error('Final public standings are required.');
    res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=3600');
    return res.status(200).json(data);
  } catch (error) { return res.status(502).json({ error: error.message || 'Could not load standings.' }); }
}
