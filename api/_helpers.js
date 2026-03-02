function timedFetch(url, ms = 5000, method = 'GET') {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { method, signal: ctrl.signal, redirect: 'follow' }).finally(() => clearTimeout(timer));
}

function fuzzyMatch(a, b) {
  const norm = s => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  return norm(a).includes(norm(b)) || norm(b).includes(norm(a));
}

function authorMatch(docAuthors, queryAuthor) {
  if (!docAuthors?.length || !queryAuthor) return false;
  const normQ = queryAuthor.toLowerCase().replace(/[^a-z]/g, '');
  const lastNameQ = queryAuthor.trim().split(/\s+/).pop().toLowerCase().replace(/[^a-z]/g, '');
  return docAuthors.some(a => {
    const normA = a.toLowerCase().replace(/[^a-z]/g, '');
    return normA.includes(normQ) || normQ.includes(normA) || normA.includes(lastNameQ);
  });
}

function isConfidentMatch(doc, title, author) {
  return doc.title && fuzzyMatch(doc.title, title) && authorMatch(doc.author_name, author);
}

function matchScore(doc, title) {
  if (!doc.title) return 0;
  const normDoc = doc.title.toLowerCase().replace(/[^a-z0-9]/g, '');
  const normQ   = title.toLowerCase().replace(/[^a-z0-9]/g, '');
  let score = 0;
  // Exact match is best
  if (normDoc === normQ) score += 100;
  // Shorter title distances are better (penalize compilations/box sets)
  else score += Math.max(0, 50 - Math.abs(normDoc.length - normQ.length));
  // Reward having a cover
  if (doc.cover_i) score += 30;
  // Reward having ISBNs
  if (doc.isbn && doc.isbn.length > 1) score += 20;
  // Reward having a rating
  if (doc.ratings_average) score += 10;
  return score;
}

function bestMatch(docs, title, author) {
  const confident = docs.filter(d => isConfidentMatch(d, title, author));
  if (confident.length > 0) {
    return confident.sort((a, b) => matchScore(b, title) - matchScore(a, title))[0];
  }
  const fuzzy = docs.filter(d => d.title && fuzzyMatch(d.title, title) && d.author_name?.length);
  if (fuzzy.length > 0) {
    return fuzzy.sort((a, b) => matchScore(b, title) - matchScore(a, title))[0];
  }
  return null;
}

async function verifyBookExists(title, author) {
  try {
    const q = encodeURIComponent(`${title} ${author}`);
    const data = await timedFetch(
      `https://openlibrary.org/search.json?q=${q}&limit=5&fields=title,author_name`, 5000
    ).then(r => r.ok ? r.json() : null);
    if (!data?.docs?.length) return false;
    return data.docs.some(d => isConfidentMatch(d, title, author));
  } catch { return false; }
}

async function isRealCover(url) {
  try {
    const res = await timedFetch(url, 4000, 'HEAD');
    if (!res.ok) return false;
    const len = Number(res.headers.get('content-length') || 0);
    if (len > 0 && len < 1000) return false;
    if (len === 0) {
      const full = await timedFetch(url, 4000);
      const buf = await full.arrayBuffer();
      return buf.byteLength > 1000;
    }
    return true;
  } catch { return false; }
}

async function findValidCover(candidates) {
  for (const url of candidates) {
    if (!url) continue;
    if (await isRealCover(url)) return url;
  }
  return null;
}

async function googleBooksCover(title, author) {
  try {
    const q = encodeURIComponent(`${title} ${author}`);
    const data = await timedFetch(
      `https://www.googleapis.com/books/v1/volumes?q=${q}&maxResults=1&fields=items(volumeInfo/imageLinks)`,
      4000
    ).then(r => r.ok ? r.json() : null);
    const link = data?.items?.[0]?.volumeInfo?.imageLinks;
    const raw = link?.thumbnail || link?.smallThumbnail || null;
    return raw ? raw.replace('&edge=curl', '').replace('zoom=5', 'zoom=1') : null;
  } catch { return null; }
}

async function lookupBook(title, author) {
  const empty = { olCover: null, olRating: null, isbn13: null, isbn10: null };

  const queries = [
    `q=${encodeURIComponent(title + ' ' + author)}&limit=5&lang=eng`,
    `title=${encodeURIComponent(title)}&author=${encodeURIComponent(author)}&limit=5&lang=eng`,
    `q=${encodeURIComponent(title + ' ' + author)}&limit=5`,
  ];

  for (const qs of queries) {
    try {
      const data = await timedFetch(
        `https://openlibrary.org/search.json?${qs}&fields=key,cover_i,isbn,ratings_average,title,author_name`
      ).then(r => r.ok ? r.json() : null);

      if (!data?.docs?.length) continue;

      const doc = bestMatch(data.docs, title, author);
      if (!doc) continue;

      const isbns  = doc.isbn || [];
      const isbn13 = isbns.find(i => /^97[89]\d{10}$/.test(i)) || null;
      const isbn10 = isbns.find(i => /^\d{9}[\dXx]$/.test(i)) || null;

      const coverCandidates = [
        doc.cover_i ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg` : null,
        isbn13      ? `https://covers.openlibrary.org/b/isbn/${isbn13}-M.jpg`    : null,
        isbn10      ? `https://covers.openlibrary.org/b/isbn/${isbn10}-M.jpg`    : null,
      ];

      let olCover = await findValidCover(coverCandidates);
      if (!olCover) olCover = await googleBooksCover(title, author);

      const olRating = doc.ratings_average
        ? Number(doc.ratings_average).toFixed(1)
        : null;

      if (olCover || isbn13 || isbn10) {
        return { olCover, olRating, isbn13, isbn10 };
      }
    } catch { /* try next query */ }
  }

  const fallbackCover = await googleBooksCover(title, author);
  if (fallbackCover) return { olCover: fallbackCover, olRating: null, isbn13: null, isbn10: null };

  return empty;
}

module.exports = { verifyBookExists, lookupBook };
