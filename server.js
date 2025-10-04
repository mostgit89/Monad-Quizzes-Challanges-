// server.js
// Simple Express server that serves the quiz endpoint.
// No DB — questions are hardcoded in questions.js as requested.

const express = require('express');
const cors = require('cors');
const seedrandom = require('seedrandom');
const { questionsPool } = require('./questions');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5000;

/**
 * Utility: deterministic shuffle using seedrandom (Fisher-Yates with seeded RNG)
 * @param {Array} array
 * @param {string} seed
 */
function seededShuffle(array, seed) {
  const rng = seedrandom(seed);
  const arr = array.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Utility: group questions by difficulty for proportional pull
 * Returns object { Easy: [], Medium: [], Hard: [], ... }
 */
function groupByDifficulty(pool) {
  return pool.reduce((acc, q) => {
    if (!acc[q.difficulty]) acc[q.difficulty] = [];
    acc[q.difficulty].push(q);
    return acc;
  }, {});
}

/**
 * Build the 30-question daily set with difficulty progression.
 * The userId + date will later be used to shuffle uniquely per user.
 */
function buildDailySet(pool, dateSeed) {
  // Desired distribution (by positions in UI):
  // positions 1-4: Easy (4)
  // 5-9: Medium (5)
  // 10-14: Hard (5)
  // 15-19: Harder (5) -> we'll treat as Hard
  // 20-24: Advanced (5) -> treat as Hard or Medium depending on pool
  // 25-30: Expert (6) -> treat as Hard
  // To simplify with your tags (Easy/Medium/Hard), map the counts:
  const counts = {
    Easy: 4,
    Medium: 5,
    Hard: 21 // 5 + 5 +5 +6 => total remaining
  };

  const grouped = groupByDifficulty(pool);

  // Safeguard: if any group is insufficient, we'll fallback to sampling what we can and fill from others.
  const pickFromGroup = (groupName, n, seed) => {
    const arr = grouped[groupName] ? grouped[groupName].slice() : [];
    // deterministic pick order: shuffle by seed + groupName
    const shuffled = seededShuffle(arr, `${seed}-${groupName}`);
    return shuffled.slice(0, n);
  };

  const result = [];
  const daySeed = String(dateSeed);

  // Pull Easy
  result.push(...pickFromGroup('Easy', counts.Easy, daySeed));

  // Pull Medium
  result.push(...pickFromGroup('Medium', counts.Medium, daySeed));

  // Pull Hard (rest)
  result.push(...pickFromGroup('Hard', counts.Hard, daySeed));

  // If not enough total (possible if difficulty tags mis-sized), fill from entire pool
  if (result.length < 30) {
    const needed = 30 - result.length;
    const remainingPool = pool.filter(q => !result.some(r => r.id === q.id));
    const filler = seededShuffle(remainingPool, `${daySeed}-filler`).slice(0, needed);
    result.push(...filler);
  } else if (result.length > 30) {
    // Trim deterministic way
    result.splice(30);
  }

  // At this stage we have 30 items with approximate difficulty progression.
  // Final stable sort: We keep the order as pulled so positions roughly match progression.
  return result;
}

/**
 * GET /api/quiz?userId=<uuid>
 * Returns: JSON array of 30 questions: { id, text, options: {A..D}, correct, difficulty }
 */
app.get('/api/quiz', (req, res) => {
  try {
    const userId = req.query.userId || 'anonymous';
    // Use date string for daily sets — ensures daily difference.
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    // The "daySeed" logic you requested: e.g., new Date().getDate() % 3 for 3 unique sets.
    // We'll generate but also ensure full-date seed for determinism across days.
    const dayOfMonthMod3 = new Date().getDate() % 3; // 0,1,2
    const dateSeed = `${today}-${dayOfMonthMod3}`;

    // Build daily set (30 questions)
    const dailySet = buildDailySet(questionsPool, dateSeed);

    // Shuffle uniquely per user using hash userId + date
    const userSeed = `${userId}-${today}`;
    const shuffled = seededShuffle(dailySet, userSeed);

    // Map to the required structure (remove any unwanted fields)
    const payload = shuffled.map(q => ({
      id: q.id,
      text: q.text,
      options: q.options,
      correct: q.correct,
      difficulty: q.difficulty
    }));

    return res.json(payload);
  } catch (err) {
    console.error('Error generating quiz:', err);
    return res.status(500).json({ message: 'Failed to build quiz. Try again later.' });
  }
});

// Basic healthcheck
app.get('/', (req, res) => res.send('REAL NADS QUIZZES API is running.'));

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
