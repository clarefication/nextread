const { getAuthenticatedUser } = require('./_supabase');
const { verifyBookExists } = require('./_helpers');

const TONE_LABELS = ['Very light', 'Light', 'Balanced', 'Heavy', 'Very heavy'];
const PACE_LABELS = ['Very fast-paced', 'Fast-paced', 'Balanced', 'Slow & reflective', 'Very slow & meditative'];

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const auth = await getAuthenticatedUser(req);
  if (auth.error) return res.status(401).json({ error: auth.error });

  const { supabase, user } = auth;
  const { queryText, filters = {}, searchMyList = false, excludeMyList = false, pastTitles = [] } = req.body;

  if (!queryText || typeof queryText !== 'string' || !queryText.trim()) {
    return res.status(400).json({ error: 'queryText is required' });
  }

  const { rating, pages, genres, tone, pace } = filters;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });

  // Fetch user preferences, history, and all interactions (for saved books + taste signals)
  const [prefsRes, historyRes, allInteractionsRes] = await Promise.all([
    supabase.from('preferences').select('*').eq('user_id', user.id).single(),
    supabase.from('search_history').select('results').eq('user_id', user.id).order('created_at', { ascending: false }).limit(10),
    supabase.from('book_interactions')
      .select('book_id, title, author, interaction_type')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false }),
  ]);

  // Dedupe interactions by book_id (latest wins) — mirrors saved-books.js logic
  const latestByBook = new Map();
  for (const row of allInteractionsRes.data || []) {
    if (!latestByBook.has(row.book_id)) latestByBook.set(row.book_id, row);
  }

  // Build saved books list from latest interactions only
  const savedRes = { data: [...latestByBook.values()].filter(r => r.interaction_type === 'save') };

  // For taste signals, use same deduped data (replaces interactionsRes)
  const interactionsRes = { data: [...latestByBook.values()].slice(0, 50) };

  const prefs = prefsRes.data;
  const personalized = !!(prefs?.likes_genres?.length || prefs?.dislikes_genres?.length || interactionsRes.data?.length);

  // Build exclusion list from recent search results
  const excludeBooks = [];
  if (historyRes.data) {
    for (const row of historyRes.data) {
      if (Array.isArray(row.results)) {
        for (const book of row.results) {
          if (book.title && book.author) {
            excludeBooks.push({ title: book.title, author: book.author });
          }
        }
      }
    }
  }

  // Build liked/disliked signals from interactions
  const likedBooks = [];
  const dislikedBooks = [];
  if (interactionsRes.data) {
    // Get latest interaction per book_id
    const latest = new Map();
    for (const row of interactionsRes.data) {
      if (!latest.has(row.book_id)) latest.set(row.book_id, row);
    }
    for (const row of latest.values()) {
      if (row.interaction_type === 'like' || row.interaction_type === 'save' || row.interaction_type === 'read') {
        likedBooks.push(`"${row.title}" by ${row.author}`);
      } else if (row.interaction_type === 'dislike' || row.interaction_type === 'read-dislike') {
        dislikedBooks.push(`"${row.title}" by ${row.author}`);
      }
    }
  }

  // Build prompt
  let prompt = `You are a discerning literary curator. Your job is to recommend real, published books that genuinely exist. Accuracy is paramount.

The reader is looking for: "${queryText.trim()}"

Additional preferences:`;

  if (rating) prompt += `\n- Minimum Goodreads rating: ${rating}+`;
  if (pages) prompt += `\n- Maximum page count: ${pages} pages`;
  if (Array.isArray(genres) && genres.length) prompt += `\n- Preferred genre(s): ${genres.join(', ')}`;
  if (tone >= 1 && tone <= 5) prompt += `\n- Tone: ${TONE_LABELS[tone - 1]}`;
  if (pace >= 1 && pace <= 5) prompt += `\n- Pace: ${PACE_LABELS[pace - 1]}`;

  // Personalization from preferences
  if (prefs?.likes_genres?.length) {
    prompt += `\n- Reader generally enjoys: ${prefs.likes_genres.join(', ')}`;
  }
  if (prefs?.dislikes_genres?.length) {
    prompt += `\n- Reader generally dislikes: ${prefs.dislikes_genres.join(', ')}`;
  }

  // Personalization from interaction history
  if (likedBooks.length) {
    prompt += `\n\nBooks this reader has liked previously (use as taste signal):\n${likedBooks.slice(0, 10).map(b => `- ${b}`).join('\n')}`;
  }
  if (dislikedBooks.length) {
    prompt += `\n\nBooks this reader has disliked (avoid similar):\n${dislikedBooks.slice(0, 5).map(b => `- ${b}`).join('\n')}`;
  }

  // Permanent blocklist — books Claude chronically defaults to
  const PERMANENT_BLOCKLIST = [
    { title: 'The Silent Patient', author: 'Alex Michaelides' },
    { title: 'Gone Girl', author: 'Gillian Flynn' },
    { title: 'The Girl on the Train', author: 'Paula Hawkins' },
    { title: 'Where the Crawdads Sing', author: 'Delia Owens' },
    { title: 'It Ends with Us', author: 'Colleen Hoover' },
    { title: 'Atomic Habits', author: 'James Clear' },
    { title: 'The Midnight Library', author: 'Matt Haig' },
    { title: 'Normal People', author: 'Sally Rooney' },
  ];

  // Exclusion list — permanent blocklist + server history + client localStorage list
  const allExclusions = [...PERMANENT_BLOCKLIST, ...excludeBooks];
  if (Array.isArray(pastTitles)) {
    for (const b of pastTitles) {
      if (b?.title && b?.author) allExclusions.push({ title: b.title, author: b.author });
    }
  }
  if (allExclusions.length) {
    prompt += `\n\nYou are STRICTLY FORBIDDEN from recommending any of these books — do not include them under any circumstances:\n`;
    const seen = new Set();
    for (const b of allExclusions) {
      const key = `${b.title.toLowerCase()}::${b.author.toLowerCase()}`;
      if (!seen.has(key)) {
        seen.add(key);
        prompt += `- "${b.title}" by ${b.author}\n`;
      }
    }
  }

  // Reading list: either search within it or exclude it
  const savedBooks = savedRes?.data?.length ? savedRes.data : [];

  if (excludeMyList && savedBooks.length) {
    const seen = new Set();
    const savedExclusions = [];
    for (const b of savedBooks) {
      const key = `${b.title.toLowerCase()}::${b.author.toLowerCase()}`;
      if (!seen.has(key)) {
        seen.add(key);
        savedExclusions.push(`- "${b.title}" by ${b.author}`);
      }
    }
    prompt += `\n\nDo NOT recommend any of these books (already on the reader's reading list):\n${savedExclusions.join('\n')}`;
  }

  // ── Branch: reading list search — separate prompt, returns index, we map back ──
  if (searchMyList && savedBooks.length) {
    const numberedList = savedBooks.map((b, i) => `${i + 1}. ${b.title} by ${b.author}`).join('\n');

    const listPrompt = `Here is a numbered reading list:

${numberedList}

The reader is in the mood for: "${queryText.trim()}"

Which ONE book from the list above best matches that mood? Reply with ONLY a JSON object like this, nothing else:
{"pick":1,"summary":"What the book is about in 1-2 sentences.","why":"Why it fits the mood.","vibes":["tag1","tag2","tag3"]}

The "pick" field must be the number from the list. Do not pick a book that is not on the list.`;

    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 512,
          messages: [{ role: 'user', content: listPrompt }],
        }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        return res.status(response.status).json({ error: err.error?.message || `API error ${response.status}` });
      }

      const data = await response.json();
      const text = data.content?.[0]?.text || '';
      console.log('[searchMyList] raw response:', text);

      const match = text.match(/\{[\s\S]*\}/);
      if (!match) return res.status(500).json({ error: 'Could not parse response' });

      let parsed;
      try { parsed = JSON.parse(match[0]); }
      catch { return res.status(500).json({ error: 'Could not parse response' }); }

      const idx = parsed.pick;
      if (!Number.isInteger(idx) || idx < 1 || idx > savedBooks.length) {
        console.log('[searchMyList] invalid pick index:', idx, 'list size:', savedBooks.length);
        return res.status(500).json({ error: 'Could not match a book from your list. Try a different mood.' });
      }

      const book = savedBooks[idx - 1];
      const recommendations = [{
        title: book.title,
        author: book.author,
        summary: parsed.summary || '',
        whyThisMatchesYou: parsed.why || '',
        vibeTags: parsed.vibes || [],
      }];

      supabase.from('search_history').insert({
        user_id: user.id,
        query_text: queryText.trim(),
        filters,
        results: recommendations,
      });

      return res.json({ recommendations, personalized });
    } catch (err) {
      return res.status(500).json({ error: err.message || 'Something went wrong' });
    }
  }

  // ── Normal search flow ──
  prompt += `

RULES (follow every single one exactly):
1. Return exactly 3 books. No more, no fewer.
2. ONLY recommend books you are 100% certain are real, published works. Use the exact title as it appears on the cover. Use the author's real, full name. If you are not completely sure a book exists, do NOT include it.
3. The "summary" field must be a factually accurate 1\u20132 sentence description of what the book is actually about. Do NOT invent plot details, characters, or settings. Only state facts you are certain of. If unsure of specifics, keep the summary high-level rather than risk inaccuracy.
4. Do NOT default to obvious, overexposed, or overhyped picks. Dig past the first tier — imagine a well-read independent bookseller making a thoughtful personal recommendation, not an algorithm surfacing the bestseller list. A lesser-known book that fits perfectly beats a famous one that merely fits adequately.
5. Every recommendation must feel intentional and personal, not algorithmic.
6. Each book must be a distinct, different recommendation. Never repeat authors across picks.

Respond with ONLY a valid JSON object \u2014 no markdown fences, no explanation text, just raw JSON:

{
  "books": [
    {
      "title": "Exact Book Title",
      "author": "Full Author Name",
      "summary": "Factually accurate 1\u20132 sentence description.",
      "whyThisMatchesYou": "1\u20132 sentences explaining precisely why this book fits what this reader described.",
      "vibeTags": ["tag1", "tag2", "tag3"]
    }
  ]
}

vibeTags must be evocative and specific (e.g. "melancholic", "darkly comic", "slow-burn", "lush prose", "unreliable narrator", "claustrophobic", "tender", "razor-sharp", "quiet dread"). 3\u20135 tags per book.`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 2048,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      return res.status(response.status).json({ error: err.error?.message || `API error ${response.status}` });
    }

    const data = await response.json();
    let text = data.content?.[0]?.text || '';

    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return res.status(500).json({ error: 'Could not parse response' });

    let parsed;
    try { parsed = JSON.parse(match[0]); }
    catch { return res.status(500).json({ error: 'Could not parse response' }); }

    if (!parsed.books?.length) return res.status(500).json({ error: 'No books returned' });

    // Verify books exist
    const checks = await Promise.all(
      parsed.books.map(b => verifyBookExists(b.title, b.author))
    );
    const verified = parsed.books.filter((_, i) => checks[i]);
    const recommendations = verified.length > 0 ? verified : parsed.books;

    // Persist to search_history (fire-and-forget — don't block the response)
    supabase.from('search_history').insert({
      user_id: user.id,
      query_text: queryText.trim(),
      filters,
      results: recommendations,
    });

    res.json({ recommendations, personalized });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Something went wrong' });
  }
};
