const GOOGLE_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbxJwkpVXeXLq65OOZjHo4MD9ZMnjS_N_xerl6Nov8-DJEqqREtQ2uNcjYxJbI9yzTTN/exec";

let guests = [];
let currentMatch = null;

async function loadGuests() {
  const res = await fetch("guests.json", { cache: "no-store" });
  const data = await res.json();
  guests = data.map((g) => ({
    ...g,
    parts: getNameParts(g.name),
  }));
}

function norm(s) {
  return (s || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

// Lightweight Levenshtein for token similarity
function editDistance(a, b) {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }
  return dp[m][n];
}

function tokenSimilarity(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const dist = editDistance(a, b);
  const maxLen = Math.max(a.length, b.length) || 1;
  return 1 - dist / maxLen;
}

// Simple similarity score: exact match > token overlap > starts-with bonus
function score(a, b) {
  a = norm(a);
  b = norm(b);
  if (!a || !b) return 0;
  if (a === b) return 1;

  const A = new Set(a.split(" "));
  const B = new Set(b.split(" "));

  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;

  const union = new Set([...A, ...B]).size;
  const startBonus = (b.startsWith(a) || a.startsWith(b)) ? 0.15 : 0;

  // Token fuzz: reward close-but-typo tokens (e.g., "nizem" vs "nizam")
  const tokensA = [...A];
  const tokensB = [...B];
  const bestPerA = tokensA.map((ta) => {
    let best = 0;
    for (const tb of tokensB) best = Math.max(best, tokenSimilarity(ta, tb));
    return best;
  });
  const bestPerB = tokensB.map((tb) => {
    let best = 0;
    for (const ta of tokensA) best = Math.max(best, tokenSimilarity(tb, ta));
    return best;
  });
  const avgBest =
    (bestPerA.reduce((s, v) => s + v, 0) + bestPerB.reduce((s, v) => s + v, 0)) /
    Math.max(bestPerA.length + bestPerB.length, 1);

  return (inter / union) + startBonus + 0.35 * avgBest;
}

function getNameParts(name) {
  const tokens = norm(name).split(" ").filter(Boolean);
  if (!tokens.length) return { first: "", middle: "", last: "" };

  const first = tokens[0];
  const last = tokens[tokens.length - 1];
  const middle = tokens.slice(1, -1).join(" ");
  return { first, middle, last };
}

function findBestMatch(query) {
  const q = norm(query);
  let best = null;
  let bestScore = -1;

  for (const g of guests) {
    const s = score(q, g.name);
    if (s > bestScore) {
      bestScore = s;
      best = g;
    }
  }
  return { best, bestScore };
}

function setText(id, msg) {
  document.getElementById(id).textContent = msg || "";
}

function setStatus(id, msg, isError = false, color = "") {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = msg || "";
  if (isError) {
    el.classList.add("error");
    el.style.color = "#c02c1d";
    el.style.fontWeight = "650";
  } else {
    el.classList.remove("error");
    el.style.color = color || "";
    el.style.fontWeight = color ? "650" : "";
  }
}

function showMatch(match) {
  currentMatch = match;

  document.getElementById("optionsBox").classList.add("hidden");
  document.getElementById("matchedName").textContent = match.name;
  document.getElementById("maxGuests").textContent = String(match.max_guests);

  const guestCount = document.getElementById("guestCount");
  guestCount.min = "1";
  guestCount.max = String(match.max_guests);
  guestCount.value = "1";
  document.getElementById("email").value = "";

  setText("guestHint", `You can RSVP for up to ${match.max_guests} guest(s) including you.`);
  document.getElementById("matchBox").classList.remove("hidden");
}

function showOptions(matches) {
  currentMatch = null;
  document.getElementById("matchBox").classList.add("hidden");

  const list = document.getElementById("optionsList");
  list.innerHTML = "";

  matches.forEach((m) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "optionBtn";
    btn.textContent = m.name;
    btn.addEventListener("click", () => {
      setText("status", "");
      showMatch(m);
    });
    list.appendChild(btn);
  });

  document.getElementById("optionsBox").classList.remove("hidden");
  setText("status", "Please pick your exact name.");
}

function clampGuestCount(opts = {}) {
  // Keep guest count between 1 and the current guest's max
  // allowEmpty=true lets the user clear the field while typing
  const allowEmpty = opts.allowEmpty === true;
  if (!currentMatch) return;

  const input = document.getElementById("guestCount");
  const raw = input.value;

  if (allowEmpty && raw.trim() === "") {
    return;
  }

  const max = Number(currentMatch.max_guests);
  let val = Number(raw);

  if (!Number.isFinite(val) || val < 1) val = 1;
  if (val > max) val = max;

  input.value = String(val);
}

async function submitRSVP() {
  if (!currentMatch) return;

  const attending = document.querySelector('input[name="attending"]:checked')?.value || "yes";
  const email = document.getElementById("email").value.trim();

  const maxGuests = Number(currentMatch.max_guests);
  const guestCountVal = Number(document.getElementById("guestCount").value);

  // If not attending, guest count will be 0
  const guestCount = attending === "yes" ? guestCountVal : 0;

  if (attending === "yes") {
    if (!Number.isFinite(guestCount) || guestCount < 1 || guestCount > maxGuests) {
      setStatus("submitStatus", `Guest count must be between 1 and ${maxGuests}.`, true);
      return;
    }
  }

  if (!email) {
    setStatus("submitStatus", "Please enter your email.", true);
    return;
  }
  const simpleEmail = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
  if (!simpleEmail.test(email)) {
    setStatus("submitStatus", "Please enter a valid email address.", true);
    return;
  }

  const notes = document.getElementById("notes").value.trim();

  const payload = {
    name: currentMatch.name,
    attending,
    guestCount,
    email,
    notes,
  };

  setStatus("submitStatus", "Submitting...");

  try {
    await fetch(GOOGLE_SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload),
    });

    setStatus("submitStatus", "✅ RSVP submitted. Thank you!", false, "#1c7c3a");
  } catch (e) {
    console.error(e);
    setStatus("submitStatus", "Submit failed. Please try again.", true);
  }
}

async function main() {
  setText("status", "Loading guest list...");
  await loadGuests();
  setText("status", "");

  document.getElementById("searchBtn").addEventListener("click", () => {
    const q = document.getElementById("nameInput").value;
    if (!q.trim()) {
      setText("status", "Please enter your name.");
      return;
    }
    const wordCount = norm(q).split(" ").filter(Boolean).length;
    if (wordCount < 2) {
      setText("status", "Please enter your full name (first and last).");
      document.getElementById("matchBox").classList.add("hidden");
      currentMatch = null;
      return;
    }

    const parts = getNameParts(q);
    const hasFirstLast = parts.first && parts.last;
    const hasMiddle = !!parts.middle;

    if (hasFirstLast && !hasMiddle) {
      const sameFirstLast = guests.filter(
        (g) => g.parts.first === parts.first && g.parts.last === parts.last
      );

      if (sameFirstLast.length > 1) {
        showOptions(sameFirstLast);
        return;
      }
    }

    document.getElementById("optionsBox").classList.add("hidden");

    const { best, bestScore } = findBestMatch(q);

    // Threshold prevents nonsense matches
    if (!best || bestScore < 0.2) {
      setText("status", "No close match found. Please try your full name.");
      document.getElementById("matchBox").classList.add("hidden");
      document.getElementById("optionsBox").classList.add("hidden");
      currentMatch = null;
      return;
    }

    setText("status", "");
    showMatch(best);
  });

  const guestCountInput = document.getElementById("guestCount");
  guestCountInput.addEventListener("input", () => clampGuestCount({ allowEmpty: true }));
  guestCountInput.addEventListener("change", clampGuestCount);

  document.getElementById("submitBtn").addEventListener("click", submitRSVP);
}

window.addEventListener("DOMContentLoaded", main);
